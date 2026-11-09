// net/transport/Kcp.ts —— 自定义 KCP 低延迟可靠/半可靠 ARQ 协议栈（适配 WebRTC Unordered/Unreliable DataChannel）
// 设计目标：
//   1. WebRTC 默认 DataChannel 采用 SCTP 可靠有序流（TCP 语义），丢包时会发生队头阻塞（Head-of-Line Blocking）；
//   2. 本模块基于 WebRTC 无序不可靠通道（ordered: false, maxRetransmits: 0，模拟底层 UDP 数据报）实现完整 KCP 协议：
//      - 标准 24 字节 KCP 报文头：conv(4B) | cmd(1B) | frg(1B) | wnd(2B) | ts(4B) | sn(4B) | una(4B) | len(4B)
//      - 极速模式默认开启：nodelay=1（RTO 1.5x 线性增长而非 2x 翻倍）、interval=10ms、resend=2（跨越 2 次 ACK 立即快速重传）、nc=1（关闭拥塞慢启动）
//      - UNA（此编号前所有包已收）+ 选择性 ACK 双重确认机制，大幅减少重传开销
//      - 支持可靠有序流（PUSH/ACK，用于欢迎包、关键事件、输入意图与增量帧）与无阻塞直通帧（UNRELIABLE，用于可丢弃高频状态）

export const IKCP_RTO_NDL = 30        // nodelay 最小 RTO (ms)
export const IKCP_RTO_MIN = 100       // 常规最小 RTO (ms)
export const IKCP_RTO_DEF = 200       // 默认初始 RTO (ms)
export const IKCP_RTO_MAX = 60000     // 最大 RTO (ms)

export const IKCP_CMD_PUSH = 81       // 数据推送包 (可靠 ARQ)
export const IKCP_CMD_ACK = 82        // 确认包 (选择性 ACK)
export const IKCP_CMD_WASK = 83       // 窗口探测请求
export const IKCP_CMD_WINS = 84       // 窗口大小告知
export const IKCP_CMD_UNRELIABLE = 85 // 低延迟无序直通包（无需重传的瞬态快照）
export const IKCP_CMD_PING = 86       // 轻量心跳与 RTT 测量
export const IKCP_CMD_PONG = 87       // 心跳应答

export const IKCP_OVERHEAD = 24       // KCP 标准帧头长度 24 字节
export const IKCP_MTU_DEF = 1200      // 适配 WebRTC SCTP/DTLS 安全 MTU

// KCP 报文魔数标识（嵌入 conv 高位或校验，默认会话 ID）
export const DEFAULT_KCP_CONV = 0x53424b43 // 'SBKC'

export interface KcpOptions {
  conv?: number
  mtu?: number
  sndWnd?: number
  rcvWnd?: number
  nodelay?: number      // 0=关闭, 1=开启极速模式
  interval?: number     // 内部刷新间隔 ms（默认 10ms）
  resend?: number       // 快速重传触发跨越次数（默认 2）
  nc?: number           // 0=正常拥塞控制, 1=关闭拥塞控制（默认 1）
}

export interface KcpSegment {
  conv: number
  cmd: number
  frg: number
  wnd: number
  ts: number
  sn: number
  una: number
  data: Uint8Array
  // 发送端 ARQ 追踪元数据
  resendts: number
  rto: number
  fastack: number
  xmit: number
}

export interface KcpStats {
  conv: number
  srtt: number
  rttVar: number
  rto: number
  txPackets: number
  rxPackets: number
  txBytes: number
  rxBytes: number
  fastRetransmits: number
  timeoutRetransmits: number
  inFlight: number
}

function timeDiff(later: number, earlier: number): number {
  return (later | 0) - (earlier | 0)
}

/**
 * KcpBlock —— 核心 KCP ARQ 状态机（纯 Uint8Array 零 IO 协议引擎，可在浏览器 WebRTC 与 Node 测试中无缝运行）
 */
export class KcpBlock {
  readonly conv: number
  mtu: number
  mss: number
  sndUna = 0
  sndNxt = 0
  rcvNxt = 0
   rxSrtt = 0
  rxRttval = 0
  rxRto = IKCP_RTO_DEF
  rxMinrto = IKCP_RTO_NDL
  sndWnd: number
  rcvWnd: number
  rmtWnd = 128
  cwnd = 128
  nodelay = 1
  interval = 10
  tsFlush = 0
  fastresend = 2
  nocwnd = 1
  current = 0

  private sndQueue: KcpSegment[] = []
  private rcvQueue: KcpSegment[] = []
  private sndBuf: KcpSegment[] = []
  private rcvBuf: KcpSegment[] = []
  private ackList: { sn: number; ts: number }[] = []
  private unreliableQueue: Uint8Array[] = []
  private output: (buf: Uint8Array) => void

  // 统计遥测
  txPackets = 0
  rxPackets = 0
  txBytes = 0
  rxBytes = 0
  fastRetransmits = 0
  timeoutRetransmits = 0

  constructor(conv = DEFAULT_KCP_CONV, output: (buf: Uint8Array) => void, opts: KcpOptions = {}) {
    this.conv = conv >>> 0
    this.output = output
    this.mtu = Math.max(256, opts.mtu ?? IKCP_MTU_DEF)
    this.mss = this.mtu - IKCP_OVERHEAD
    this.sndWnd = Math.max(16, opts.sndWnd ?? 128)
    this.rcvWnd = Math.max(16, opts.rcvWnd ?? 128)
    this.rmtWnd = this.rcvWnd
    this.setNoDelay(
      opts.nodelay ?? 1,
      opts.interval ?? 10,
      opts.resend ?? 2,
      opts.nc ?? 1,
    )
  }

  /** 配置 KCP 极速参数（默认 nodelay=1, interval=10ms, resend=2, nc=1） */
  setNoDelay(nodelay: number, interval: number, resend: number, nc: number): void {
    this.nodelay = nodelay
    this.rxMinrto = nodelay > 0 ? IKCP_RTO_NDL : IKCP_RTO_MIN
    this.interval = Math.max(5, Math.min(5000, interval))
    this.fastresend = Math.max(0, resend)
    this.nocwnd = nc
  }

  /** 发送可靠有序消息（支持自动按 MSS 分片与重组） */
  send(payload: Uint8Array): number {
    if (payload.byteLength === 0) return -1
    const count = payload.byteLength <= this.mss ? 1 : Math.ceil(payload.byteLength / this.mss)
    if (count > 255) return -2
    let offset = 0
    for (let i = 0; i < count; i++) {
      const size = Math.min(this.mss, payload.byteLength - offset)
      const slice = payload.subarray(offset, offset + size)
      const copy = new Uint8Array(size)
      copy.set(slice)
      this.sndQueue.push({
        conv: this.conv,
        cmd: IKCP_CMD_PUSH,
        frg: count - i - 1,
        wnd: 0,
        ts: 0,
        sn: 0,
        una: 0,
        data: copy,
        resendts: 0,
        rto: this.rxRto,
        fastack: 0,
        xmit: 0,
      })
      offset += size
    }
    return 0
  }

  /** 发送低延迟不可靠直通帧（封装 24B KCP 头，顺带捎带最新 una，不进重传缓冲） */
  sendUnreliable(payload: Uint8Array): void {
    const pkt = new Uint8Array(IKCP_OVERHEAD + payload.byteLength)
    const view = new DataView(pkt.buffer)
    view.setUint32(0, this.conv, true)
    view.setUint8(4, IKCP_CMD_UNRELIABLE)
    view.setUint8(5, 0)
    view.setUint16(6, this.wndUnused(), true)
    view.setUint32(8, this.current >>> 0, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, this.rcvNxt >>> 0, true)
    view.setUint32(20, payload.byteLength >>> 0, true)
    pkt.set(payload, IKCP_OVERHEAD)
    this.emitPacket(pkt)
  }

  /** 发送心跳探测包以持续刷新 RTT */
  sendPing(nowMs = this.current): void {
    this.current = nowMs >>> 0
    const pkt = new Uint8Array(IKCP_OVERHEAD)
    const view = new DataView(pkt.buffer)
    view.setUint32(0, this.conv, true)
    view.setUint8(4, IKCP_CMD_PING)
    view.setUint8(5, 0)
    view.setUint16(6, this.wndUnused(), true)
    view.setUint32(8, this.current >>> 0, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, this.rcvNxt >>> 0, true)
    view.setUint32(20, 0, true)
    this.emitPacket(pkt)
  }

  /** 从接收队列提取一条完整应用层报文（自动处理分片重组与直通帧） */
  recv(): Uint8Array | null {
    if (this.unreliableQueue.length > 0) {
      return this.unreliableQueue.shift()!
    }
    if (this.rcvQueue.length === 0) return null
    const first = this.rcvQueue[0]
    if (first.frg === 0) {
      this.rcvQueue.shift()
      this.moveRcvBufToQueue()
      return first.data
    }
    if (this.rcvQueue.length < first.frg + 1) {
      return null // 分片尚未收齐
    }
    let totalLen = 0
    const segCount = first.frg + 1
    for (let i = 0; i < segCount; i++) {
      totalLen += this.rcvQueue[i].data.byteLength
    }
    const out = new Uint8Array(totalLen)
    let offset = 0
    for (let i = 0; i < segCount; i++) {
      const seg = this.rcvQueue.shift()!
      out.set(seg.data, offset)
      offset += seg.data.byteLength
    }
    this.moveRcvBufToQueue()
    return out
  }

  /** 输入底层 WebRTC DataChannel 收到的原始二进制数据包 */
  input(data: Uint8Array, nowMs = this.current): number {
    this.current = nowMs >>> 0
    if (!data || data.byteLength < IKCP_OVERHEAD) return -1
    this.rxPackets++
    this.rxBytes += data.byteLength

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0
    let maxAck = -1

    while (offset + IKCP_OVERHEAD <= data.byteLength) {
      const conv = view.getUint32(offset, true)
      if (conv !== this.conv) return -2
      const cmd = view.getUint8(offset + 4)
      const frg = view.getUint8(offset + 5)
      const wnd = view.getUint16(offset + 6, true)
      const ts = view.getUint32(offset + 8, true)
      const sn = view.getUint32(offset + 12, true)
      const una = view.getUint32(offset + 16, true)
      const len = view.getUint32(offset + 20, true)
      offset += IKCP_OVERHEAD
      if (offset + len > data.byteLength) return -3

      this.rmtWnd = wnd
      this.parseUna(una)
      this.shrinkBuf()

      if (cmd === IKCP_CMD_ACK) {
        const rtt = timeDiff(this.current, ts)
        if (rtt >= 0) this.updateAck(rtt)
        this.parseAck(sn)
        this.shrinkBuf()
        this.parseFastack(sn)
        if (maxAck < 0 || sn > maxAck) maxAck = sn
      } else if (cmd === IKCP_CMD_PUSH) {
        if (sn < this.rcvNxt + this.rcvWnd) {
          this.ackList.push({ sn, ts })
          if (sn >= this.rcvNxt) {
            const payload = new Uint8Array(len)
            payload.set(data.subarray(offset, offset + len))
            this.parseData({
              conv, cmd, frg, wnd, ts, sn, una, data: payload,
              resendts: 0, rto: 0, fastack: 0, xmit: 0,
            })
          }
        }
      } else if (cmd === IKCP_CMD_UNRELIABLE) {
        const payload = new Uint8Array(len)
        payload.set(data.subarray(offset, offset + len))
        this.unreliableQueue.push(payload)
      } else if (cmd === IKCP_CMD_PING) {
        // 立即回传 PONG
        const pong = new Uint8Array(IKCP_OVERHEAD)
        const pv = new DataView(pong.buffer)
        pv.setUint32(0, this.conv, true)
        pv.setUint8(4, IKCP_CMD_PONG)
        pv.setUint8(5, 0)
        pv.setUint16(6, this.wndUnused(), true)
        pv.setUint32(8, ts, true)
        pv.setUint32(12, 0, true)
        pv.setUint32(16, this.rcvNxt >>> 0, true)
        pv.setUint32(20, 0, true)
        this.emitPacket(pong)
      } else if (cmd === IKCP_CMD_PONG) {
        const rtt = timeDiff(this.current, ts)
        if (rtt >= 0) this.updateAck(rtt)
      } else if (cmd !== IKCP_CMD_WASK && cmd !== IKCP_CMD_WINS) {
        return -4
      }

      offset += len
    }


    return 0
  }

  /** KCP 定时时钟驱动（建议每 10ms 或每帧调用） */
  update(currentMs: number): void {
    this.current = currentMs >>> 0
    if (this.tsFlush === 0) {
      this.tsFlush = this.current
    }
    const slap = timeDiff(this.current, this.tsFlush)
    if (slap >= 10000 || slap < -10000) {
      this.tsFlush = this.current
    } else if (slap >= 0) {
      this.tsFlush = (this.tsFlush + this.interval) >>> 0
      if (timeDiff(this.current, this.tsFlush) >= 0) {
        this.tsFlush = (this.current + this.interval) >>> 0
      }
      this.flush()
    }
  }

  /** 立即冲刷发送队列、ACK 列表与超时/快速重传段（低延迟模式下每次 send 后可立即调用） */
  flush(nowMs = this.current): void {
    this.current = nowMs >>> 0
    const wnd = this.wndUnused()
    const buffer = new Uint8Array(this.mtu * 2)
    const view = new DataView(buffer.buffer)
    let offset = 0

    const flushBuffer = (): void => {
      if (offset > 0) {
        const out = buffer.slice(0, offset)
        this.emitPacket(out)
        offset = 0
      }
    }

    const writeHeader = (cmd: number, frg: number, segWnd: number, ts: number, sn: number, una: number, len: number): void => {
      view.setUint32(offset, this.conv, true)
      view.setUint8(offset + 4, cmd)
      view.setUint8(offset + 5, frg)
      view.setUint16(offset + 6, segWnd, true)
      view.setUint32(offset + 8, ts >>> 0, true)
      view.setUint32(12 + offset, sn >>> 0, true)
      view.setUint32(16 + offset, una >>> 0, true)
      view.setUint32(20 + offset, len >>> 0, true)
      offset += IKCP_OVERHEAD
    }

    // 1. 冲刷所有待发 ACK
    for (let i = 0; i < this.ackList.length; i++) {
      if (offset + IKCP_OVERHEAD > this.mtu) flushBuffer()
      const ack = this.ackList[i]
      writeHeader(IKCP_CMD_ACK, 0, wnd, ack.ts, ack.sn, this.rcvNxt, 0)
    }
    this.ackList.length = 0

    // 2. 将发送队列移动到发送滑动窗口 sndBuf
    const cwndLimit = this.nocwnd ? Math.min(this.sndWnd, this.rmtWnd) : Math.min(this.sndWnd, this.rmtWnd, this.cwnd)
    while (this.sndNxt < this.sndUna + cwndLimit && this.sndQueue.length > 0) {
      const seg = this.sndQueue.shift()!
      seg.conv = this.conv
      seg.cmd = IKCP_CMD_PUSH
      seg.wnd = wnd
      seg.ts = this.current
      seg.sn = this.sndNxt++
      seg.una = this.rcvNxt
      seg.resendts = this.current
      seg.rto = this.rxRto
      seg.fastack = 0
      seg.xmit = 0
      this.sndBuf.push(seg)
    }

    // 3. 遍历 sndBuf：处理首次发送、RTO 超时重传与 FastResend 快速重传
    const resent = this.fastresend > 0 ? this.fastresend : 0xffffffff
    const rtomin = this.nodelay === 0 ? (this.rxRto >>> 3) : 0

    for (let i = 0; i < this.sndBuf.length; i++) {
      const seg = this.sndBuf[i]
      let needSend = false
      if (seg.xmit === 0) {
        needSend = true
        seg.xmit++
        seg.rto = this.rxRto
        seg.resendts = (this.current + seg.rto + rtomin) >>> 0
      } else if (timeDiff(this.current, seg.resendts) >= 0) {
        needSend = true
        seg.xmit++
        this.timeoutRetransmits++
        if (this.nodelay === 0) {
          seg.rto += Math.max(seg.rto, this.rxRto)
        } else {
          const step = this.nodelay < 2 ? seg.rto : this.rxRto
          seg.rto += Math.floor(step / 2) // 1.5x 极速退避
        }
        seg.resendts = (this.current + seg.rto) >>> 0
      } else if (seg.fastack >= resent) {
        needSend = true
        seg.xmit++
        seg.fastack = 0
        seg.resendts = (this.current + seg.rto) >>> 0
        this.fastRetransmits++
      }

      if (needSend) {
        seg.ts = this.current
        seg.wnd = wnd
        seg.una = this.rcvNxt
        const needBytes = IKCP_OVERHEAD + seg.data.byteLength
        if (offset + needBytes > this.mtu) flushBuffer()
        writeHeader(seg.cmd, seg.frg, seg.wnd, seg.ts, seg.sn, seg.una, seg.data.byteLength)
        buffer.set(seg.data, offset)
        offset += seg.data.byteLength
      }
    }

    flushBuffer()
  }

  getStats(): KcpStats {
    return {
      conv: this.conv,
      srtt: this.rxSrtt,
      rttVar: this.rxRttval,
      rto: this.rxRto,
      txPackets: this.txPackets,
      rxPackets: this.rxPackets,
      txBytes: this.txBytes,
      rxBytes: this.rxBytes,
      fastRetransmits: this.fastRetransmits,
      timeoutRetransmits: this.timeoutRetransmits,
      inFlight: this.sndBuf.length,
    }
  }

  private emitPacket(pkt: Uint8Array): void {
    this.txPackets++
    this.txBytes += pkt.byteLength
    this.output(pkt)
  }

  private wndUnused(): number {
    if (this.rcvQueue.length < this.rcvWnd) {
      return this.rcvWnd - this.rcvQueue.length
    }
    return 0
  }

  private updateAck(rtt: number): void {
    if (this.rxSrtt === 0) {
      this.rxSrtt = rtt
      this.rxRttval = Math.max(1, rtt >> 1)
    } else {
      const delta = Math.abs(rtt - this.rxSrtt)
      this.rxRttval = (3 * this.rxRttval + delta) >> 2
      this.rxSrtt = Math.max(1, (7 * this.rxSrtt + rtt) >> 3)
    }
    const rto = this.rxSrtt + Math.max(this.interval, 4 * this.rxRttval)
    this.rxRto = Math.max(this.rxMinrto, Math.min(IKCP_RTO_MAX, rto))
  }

  private shrinkBuf(): void {
    this.sndUna = this.sndBuf.length > 0 ? this.sndBuf[0].sn : this.sndNxt
  }

  private parseAck(sn: number): void {
    if (sn < this.sndUna || sn >= this.sndNxt) return
    for (let i = 0; i < this.sndBuf.length; i++) {
      if (this.sndBuf[i].sn === sn) {
        this.sndBuf.splice(i, 1)
        break
      }
      if (this.sndBuf[i].sn > sn) break
    }
  }

  private parseUna(una: number): void {
    let removeCount = 0
    while (removeCount < this.sndBuf.length && this.sndBuf[removeCount].sn < una) {
      removeCount++
    }
    if (removeCount > 0) {
      this.sndBuf.splice(0, removeCount)
    }
  }

  private parseFastack(sn: number): void {
    if (sn < this.sndUna || sn >= this.sndNxt) return
    for (let i = 0; i < this.sndBuf.length; i++) {
      const seg = this.sndBuf[i]
      if (seg.sn < sn) {
        seg.fastack++
      } else {
        break
      }
    }
  }

  private parseData(newseg: KcpSegment): void {
    const sn = newseg.sn
    if (sn >= this.rcvNxt + this.rcvWnd || sn < this.rcvNxt) return

    let repeat = false
    let insertIdx = this.rcvBuf.length
    for (let i = this.rcvBuf.length - 1; i >= 0; i--) {
      const seg = this.rcvBuf[i]
      if (seg.sn === sn) {
        repeat = true
        break
      }
      if (sn > seg.sn) {
        insertIdx = i + 1
        break
      }
      insertIdx = i
    }

    if (!repeat) {
      this.rcvBuf.splice(insertIdx, 0, newseg)
    }
    this.moveRcvBufToQueue()
  }

  private moveRcvBufToQueue(): void {
    while (this.rcvBuf.length > 0) {
      const seg = this.rcvBuf[0]
      if (seg.sn === this.rcvNxt && this.rcvQueue.length < this.rcvWnd) {
        this.rcvBuf.shift()
        this.rcvQueue.push(seg)
        this.rcvNxt++
      } else {
        break
      }
    }
  }
}

/** 判断二进制包是否为 KCP 协议报文（检查前 4 字节 conv 与第 5 字节 cmd） */
export function isKcpPacket(bytes: Uint8Array, expectedConv = DEFAULT_KCP_CONV): boolean {
  if (bytes.byteLength < IKCP_OVERHEAD) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const conv = view.getUint32(0, true)
  const cmd = view.getUint8(4)
  return (
    conv === (expectedConv >>> 0) &&
    cmd >= IKCP_CMD_PUSH &&
    cmd <= IKCP_CMD_PONG
  )
}
