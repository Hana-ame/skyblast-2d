// net/transport/Peer.ts —— 真实 P2P 传输：PeerJS DataConnection + WebRTC 自定义 KCP 协议栈 → Transport 抽象
// 升级：
//   1. 底层基于 WebRTC DataChannel 无序不可靠模式（ordered: false, maxRetransmits: 0，模拟 UDP 数据报）挂载自定义 KCP 协议栈（KcpBlock）；
//   2. 默认启用极速模式（nodelay=1, interval=10ms, resend=2, nc=1），结合 SkyBlast 2D 私有二进制协议（SB2B/SB2C）；
//   3. 关键控制包/意图流/欢迎包走 KCP 可靠 ARQ（PUSH/ACK + FastResend=2 快速重传），高频快照广播支持 KCP 24B 帧封装与零拷贝广播；
//   4. 自动嗅探解包：同时兼容 KCP 报文、Uint8Array / ArrayBuffer / "\x00SB2:" 紧凑帧 / 旧版 JSON 字符串。
import type { ClientMsg, ClientTransport, ServerMsg, ServerTransport } from './types.ts'
import {
  encodeServerMsgBinary, decodeServerMsgBinary,
  encodeClientMsgBinary, decodeClientMsgBinary,
  frameStringToBytes, BINARY_STR_PREFIX,
} from '../protocol/BinaryCodec.ts'
import { KcpBlock, isKcpPacket, DEFAULT_KCP_CONV } from './Kcp.ts'
import type { KcpOptions, KcpStats } from './Kcp.ts'

/** PeerJS `DataConnection` 的最小可用子集（兼容真实 PeerJS DataConnection 与测试假连接） */
export interface PeerConnLike {
  send(data: unknown): void
  on(event: 'data', cb: (data: unknown) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'open' | 'error', cb: (err?: unknown) => void): void
  close(): void
  /** 真实 PeerJS DataConnection 暴露的底层 WebRTC DataChannel 与 PeerConnection */
  dataChannel?: RTCDataChannel
  peerConnection?: RTCPeerConnection
  reliable?: boolean
  serialization?: string
}

/** 扩展的 ServerTransport：支持直接发送预编码二进制帧与读取 KCP 状态 */
export interface FastServerTransport extends ServerTransport {
  sendRawFrame?(frame: Uint8Array | string): void
  kcp?: KcpBlock
  getKcpStats?(): KcpStats
  tickKcp?(nowMs?: number): void
}

/** 扩展的 ClientTransport：支持读取 KCP 状态与驱动 KCP 时钟 */
export interface FastClientTransport extends ClientTransport {
  kcp?: KcpBlock
  getKcpStats?(): KcpStats
  tickKcp?(nowMs?: number): void
}

export function encodeServerWireFrame(m: ServerMsg): Uint8Array {
  return encodeServerMsgBinary(m)
}

export function encodeClientWireFrame(m: ClientMsg): Uint8Array {
  return encodeClientMsgBinary(m)
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? Math.floor(performance.now()) : Date.now()
}

function toUint8Array(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  if (typeof raw === 'string' && raw.startsWith(BINARY_STR_PREFIX)) {
    return frameStringToBytes(raw)
  }
  return null
}

function parseServerMsg(raw: unknown): ServerMsg | null {
  if (raw instanceof Uint8Array) return decodeServerMsgBinary(raw)
  if (raw instanceof ArrayBuffer) return decodeServerMsgBinary(new Uint8Array(raw))
  if (typeof raw === 'string') {
    if (raw.startsWith(BINARY_STR_PREFIX)) {
      return decodeServerMsgBinary(frameStringToBytes(raw))
    }
    try { return JSON.parse(raw) as ServerMsg } catch { return null }
  }
  if (raw && typeof raw === 'object') return raw as ServerMsg
  return null
}

function parseClientMsg(raw: unknown): ClientMsg | null {
  if (raw instanceof Uint8Array) return decodeClientMsgBinary(raw)
  if (raw instanceof ArrayBuffer) return decodeClientMsgBinary(new Uint8Array(raw))
  if (typeof raw === 'string') {
    if (raw.startsWith(BINARY_STR_PREFIX)) {
      return decodeClientMsgBinary(frameStringToBytes(raw))
    }
    try { return JSON.parse(raw) as ClientMsg } catch { return null }
  }
  if (raw && typeof raw === 'object') return raw as ClientMsg
  return null
}

/**
 * 为真实 WebRTC PeerConnection / PeerJS DataConnection 配置底层无序不可靠 DataChannel（UDP 语义），
 * 使上层自定义 KCP 协议完全接管 ARQ 重传、UNA 确认与乱序重组，消除 SCTP 队头阻塞。
 */
export function configureWebRtcUnreliableChannel(
  conn: PeerConnLike,
  onUnreliableFrame: (bytes: Uint8Array) => void,
): { sendDatagram: (pkt: Uint8Array) => void; isCustomDataChannel: () => boolean } {
  let customDc: RTCDataChannel | null = null

  const bindDc = (dc: RTCDataChannel): void => {
    dc.binaryType = 'arraybuffer'
    dc.onmessage = (ev: MessageEvent) => {
      const bytes = toUint8Array(ev.data)
      if (bytes) onUnreliableFrame(bytes)
    }
  }

  if (conn.dataChannel) {
    try { conn.dataChannel.binaryType = 'arraybuffer' } catch { /* ignore */ }
  }

  const pc = conn.peerConnection
  if (pc && typeof pc.createDataChannel === 'function') {
    try {
      // 监听对端创建的 skyblast-kcp 低延迟无序不可靠通道
      const prevOnDc = pc.ondatachannel
      pc.ondatachannel = (ev: RTCDataChannelEvent) => {
        if (ev.channel && ev.channel.label === 'skyblast-kcp') {
          customDc = ev.channel
          bindDc(customDc)
        } else if (prevOnDc) {
          prevOnDc.call(pc, ev)
        }
      }
      // 主动创建 ordered: false, maxRetransmits: 0 的 UDP 语义 DataChannel
      const created = pc.createDataChannel('skyblast-kcp', {
        ordered: false,
        maxRetransmits: 0,
      })
      if (created.readyState === 'open') customDc = created
      created.onopen = () => {
        customDc = created
      }
      bindDc(created)
    } catch {
      // 回退到 PeerJS 默认 DataConnection
    }
  }

  return {
    sendDatagram(pkt: Uint8Array) {
      if (customDc && customDc.readyState === 'open') {
        try {
          // RTCDataChannel.send 的类型不接受 SharedArrayBuffer 视图 → 复制成标准 ArrayBuffer
          customDc.send(pkt.slice().buffer as ArrayBuffer)
          return
        } catch {
          // 回退到主通道
        }
      }
      conn.send(pkt)
    },
    isCustomDataChannel() {
      return customDc !== null && customDc.readyState === 'open'
    },
  }
}

/** 客户端侧：把一条 DataConnection 包装成带自定义 KCP 协议栈的 FastClientTransport */
export function createPeerClient(conn: PeerConnLike, kcpOpts: KcpOptions = {}): FastClientTransport {
  let onServer: ((m: ServerMsg) => void) | null = null
  const conv = kcpOpts.conv ?? DEFAULT_KCP_CONV

  const handleIncomingBytes = (bytes: Uint8Array): void => {
    if (isKcpPacket(bytes, conv)) {
      const t = nowMs()
      kcp.input(bytes, t)
      let payload: Uint8Array | null
      while ((payload = kcp.recv()) !== null) {
        const m = parseServerMsg(payload)
        if (m && 'snap' in m) onServer?.(m)
      }
      kcp.flush(t)
      return
    }
    const m = parseServerMsg(bytes)
    if (m && 'snap' in m) onServer?.(m)
  }

  const dcBridge = configureWebRtcUnreliableChannel(conn, handleIncomingBytes)
  const kcp = new KcpBlock(conv, (pkt) => dcBridge.sendDatagram(pkt), {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
    ...kcpOpts,
  })

  conn.on('data', (raw) => {
    const bytes = toUint8Array(raw)
    if (bytes) {
      handleIncomingBytes(bytes)
      return
    }
    const m = parseServerMsg(raw)
    if (m && 'snap' in m) onServer?.(m)
  })

  return {
    kcp,
    send(m: ClientMsg) {
      const t = nowMs()
      const wire = encodeClientWireFrame(m)
      kcp.send(wire)
      kcp.flush(t)
    },
    onServer(cb) { onServer = cb },
    getKcpStats() { return kcp.getStats() },
    tickKcp(t = nowMs()) { kcp.update(t) },
  }
}

/** 服务端（主机）侧：把一条 DataConnection 包装成带自定义 KCP 协议栈的 FastServerTransport */
export function createPeerServer(conn: PeerConnLike, kcpOpts: KcpOptions = {}): FastServerTransport {
  let onClient: ((m: ClientMsg) => void) | null = null
  const conv = kcpOpts.conv ?? DEFAULT_KCP_CONV

  const handleIncomingBytes = (bytes: Uint8Array): void => {
    if (isKcpPacket(bytes, conv)) {
      const t = nowMs()
      kcp.input(bytes, t)
      let payload: Uint8Array | null
      while ((payload = kcp.recv()) !== null) {
        const m = parseClientMsg(payload)
        if (m && 'intents' in m) onClient?.(m)
      }
      kcp.flush(t)
      return
    }
    const m = parseClientMsg(bytes)
    if (m && 'intents' in m) onClient?.(m)
  }

  const dcBridge = configureWebRtcUnreliableChannel(conn, handleIncomingBytes)
  const kcp = new KcpBlock(conv, (pkt) => dcBridge.sendDatagram(pkt), {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
    ...kcpOpts,
  })

  conn.on('data', (raw) => {
    const bytes = toUint8Array(raw)
    if (bytes) {
      handleIncomingBytes(bytes)
      return
    }
    const m = parseClientMsg(raw)
    if (m && 'intents' in m) onClient?.(m)
  })

  return {
    kcp,
    send(m: ServerMsg) {
      const t = nowMs()
      const wire = encodeServerWireFrame(m)
      // 含 welcome 的握手包或小体积包走 KCP 可靠 ARQ（支持分片与快速重传）
      if (m.welcome || wire.byteLength <= kcp.mss * 32) {
        kcp.send(wire)
        kcp.flush(t)
      } else {
        kcp.sendUnreliable(wire)
      }
    },
    sendRawFrame(frame: Uint8Array | string) {
      const t = nowMs()
      if (frame instanceof Uint8Array) {
        // 高频世界快照采用 KCP 24B 低延迟无阻塞帧封装（同时冲刷待发 ACK 与重传队列）
        kcp.flush(t)
        kcp.sendUnreliable(frame)
      } else {
        conn.send(frame)
      }
    },
    onClient(cb) { onClient = cb },
    getKcpStats() { return kcp.getStats() },
    tickKcp(t = nowMs()) { kcp.update(t) },
  }
}

/** 一条连接的双向端点（主机持 server 端、客户端持 client 端） */
export interface PeerPair {
  client: FastClientTransport
  server: FastServerTransport
}

/** 用一对 `PeerConnLike` 组装出主机/客户端两侧（浏览器与假连接测试共用） */
export function createPeerPair(hostConn: PeerConnLike, guestConn: PeerConnLike, kcpOpts: KcpOptions = {}): PeerPair {
  return {
    client: createPeerClient(guestConn, kcpOpts),
    server: createPeerServer(hostConn, kcpOpts),
  }
}
