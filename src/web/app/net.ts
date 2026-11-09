// web/app/net.ts —— PeerJS 联机编排 & WebRTC DataChannel (ordered:false, maxRetransmits:0) 自定义 KCP 低延迟同步管理
import { world, localPlayer, bots, mode } from './context.ts'
import { applyIntents } from '../../net/ServerSim.ts'
import { ClientSession } from '../../net/ClientSession.ts'
import { StateSync } from '../../net/StateSync.ts'
import { InputMapper } from '../../input/InputMapper.ts'
import { createPeerClient, createPeerServer, encodeServerWireFrame } from '../../net/transport/Peer.ts'
import type { PeerConnLike, FastClientTransport, FastServerTransport } from '../../net/transport/Peer.ts'
import { handleEvents } from './events.ts'
import { updateTeamCountUI, updateScoreboardUI, updateHudUI } from './hud.ts'
import { showToast } from './toast.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput, TeamId, WorldEvent } from '../../core/types.ts'
import type { WorldSnapshot } from '../../core/snap.ts'

export interface HostGuestSlot {
  playerId: number
  transport: FastServerTransport
  input: WorldInput
  lastAckSeq: number
}

export interface NetOrchestratorState {
  role: 'offline' | 'host' | 'client'
  roomId: string
  peerCount: number
  clientSession: ClientSession | null
  stateSync: StateSync | null
  hostGuests: Map<number, HostGuestSlot>
  clientTransport: FastClientTransport | null
  mapper: InputMapper
  cleanupFns: (() => void)[]
  channelMode: string
  lastPingMs: number
}

export const netState: NetOrchestratorState = {
  role: 'offline',
  roomId: '',
  peerCount: 0,
  clientSession: null,
  stateSync: null,
  hostGuests: new Map(),
  clientTransport: null,
  mapper: new InputMapper(),
  cleanupFns: [],
  channelMode: 'Unordered/UDP',
  lastPingMs: 0,
}

interface PeerConstructorLike {
  new (id?: string, opts?: Record<string, unknown>): {
    id: string
    on(event: string, cb: (...args: any[]) => void): void
    connect(id: string, opts?: Record<string, unknown>): PeerConnLike
    destroy(): void
  }
}

function getGlobalPeer(): PeerConstructorLike | null {
  const w = window as unknown as { Peer?: PeerConstructorLike }
  return typeof w.Peer === 'function' ? w.Peer : null
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

export function updateNetStatusUI(): void {
  const dot = document.getElementById('netStatusDot')
  const txt = document.getElementById('netStatusText')
  const badge = document.getElementById('peerCountBadge')
  const rttBadge = document.getElementById('kcpRttBadge')
  const roleBadge = document.getElementById('peerRoleBadge')
  const leaveBtn = document.getElementById('peerLeaveBtn')

  let srtt = 0
  let tx = 0
  let rx = 0
  let fast = 0

  if (netState.role === 'host') {
    for (const slot of netState.hostGuests.values()) {
      const st = slot.transport.getKcpStats?.()
      if (st) {
        if (st.srtt > 0) srtt = st.srtt
        tx += st.txPackets
        rx += st.rxPackets
        fast += st.fastRetransmits
      }
    }
  } else if (netState.role === 'client' && netState.clientTransport) {
    const st = netState.clientTransport.getKcpStats?.()
    if (st) {
      srtt = st.srtt
      tx = st.txPackets
      rx = st.rxPackets
      fast = st.fastRetransmits
    }
  }

  if (netState.role === 'offline') {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400'
    if (txt) txt.textContent = '本地权威'
    if (badge) badge.textContent = `单机/${bots.length}AI`
    if (rttBadge) rttBadge.classList.add('hidden')
    if (roleBadge) {
      roleBadge.textContent = '本地单机'
      roleBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700'
    }
    if (leaveBtn) leaveBtn.classList.add('hidden')
  } else if (netState.role === 'host') {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-cyan-400 animate-pulse'
    if (txt) txt.textContent = `KCP房主(${netState.roomId})`
    if (badge) badge.textContent = `${netState.peerCount + 1}人在线`
    if (rttBadge) {
      rttBadge.classList.remove('hidden')
      rttBadge.textContent = `KCP ${srtt || 1}ms`
    }
    if (roleBadge) {
      roleBadge.textContent = `👑 KCP 房主 (${netState.peerCount} 客机)`
      roleBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/50'
    }
    if (leaveBtn) leaveBtn.classList.remove('hidden')
  } else {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-sky-400 animate-pulse'
    if (txt) txt.textContent = `KCP客机(${netState.roomId})`
    if (badge) badge.textContent = '已连KCP'
    if (rttBadge) {
      rttBadge.classList.remove('hidden')
      rttBadge.textContent = `KCP ${srtt || 1}ms`
    }
    if (roleBadge) {
      roleBadge.textContent = '🚀 KCP 客机已连接'
      roleBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/50'
    }
    if (leaveBtn) leaveBtn.classList.remove('hidden')
  }

  setText('kcpStatChannel', netState.channelMode)
  setText('kcpStatRtt', `${srtt || (netState.role === 'offline' ? 0 : 1)} ms`)
  setText('kcpStatPkts', `${tx} / ${rx} (${fast})`)
}

/** 将 WebRTC RTCDataChannel (ordered:false, maxRetransmits:0) 封装为 PeerConnLike 供 KCP 协议栈驱动 */
export function wrapRtcDataChannelAsPeerConn(dc: RTCDataChannel, pc?: RTCPeerConnection): PeerConnLike {
  let onDataCb: ((data: unknown) => void) | null = null
  let onCloseCb: (() => void) | null = null
  dc.binaryType = 'arraybuffer'
  dc.onmessage = (ev: MessageEvent) => {
    onDataCb?.(ev.data)
  }
  dc.onclose = () => {
    onCloseCb?.()
  }
  return {
    dataChannel: dc,
    peerConnection: pc,
    reliable: false,
    serialization: 'raw',
    send(data: unknown) {
      if (dc.readyState !== 'open') return
      try {
        if (data instanceof Uint8Array) {
          // RTCDataChannel.send 类型不接受 SharedArrayBuffer 视图 → 复制成标准 ArrayBuffer
          dc.send(data.slice().buffer as ArrayBuffer)
        } else if (data instanceof ArrayBuffer) {
          dc.send(data)
        } else if (typeof data === 'string') {
          dc.send(data)
        }
      } catch {
        // 忽略瞬时缓冲区满
      }
    },
    on: ((event: 'data' | 'close', cb: ((d: unknown) => void) | (() => void)) => {
      if (event === 'data') onDataCb = cb as (d: unknown) => void
      else if (event === 'close') onCloseCb = cb as () => void
    }) as PeerConnLike['on'],
    close() {
      try { dc.close() } catch { /* ignore */ }
      try { pc?.close() } catch { /* ignore */ }
    },
  }
}

/** 房主侧接入一条已建立的 PeerConnLike（PeerJS DataConnection 或原生 WebRTC DataChannel） */
function acceptIncomingKcpGuest(conn: PeerConnLike, label = 'KCP-Guest'): number {
  const srvTransport = createPeerServer(conn, {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
  })
  const team: TeamId = mode.current === 'ffa'
    ? 'ffa'
    : (world.players.filter(p => p.team === 'blue').length <= world.players.filter(p => p.team === 'red').length ? 'blue' : 'red')
  const guestPlayer = world.addPlayer(label, team)
  guestPlayer.deployed = true
  guestPlayer.alive = true

  const slot: HostGuestSlot = {
    playerId: guestPlayer.id,
    transport: srvTransport,
    input: defaultWorldInput(),
    lastAckSeq: 0,
  }
  srvTransport.onClient((msg) => {
    if (typeof msg.seq === 'number' && msg.seq > slot.lastAckSeq) {
      slot.lastAckSeq = msg.seq
    }
    slot.input = applyIntents(slot.input, msg.intents)
  })

  netState.hostGuests.set(guestPlayer.id, slot)
  netState.peerCount = netState.hostGuests.size

  // 发送 KCP 可靠欢迎包 + 初始全量快照
  srvTransport.send({
    snap: world.snapshot(),
    welcome: { playerId: guestPlayer.id, name: guestPlayer.name, team: guestPlayer.team },
  })
  srvTransport.kcp?.sendPing(performance.now())

  conn.on('close', () => {
    netState.hostGuests.delete(guestPlayer.id)
    world.players = world.players.filter(p => p.id !== guestPlayer.id)
    netState.peerCount = netState.hostGuests.size
    updateTeamCountUI()
    updateNetStatusUI()
    showToast(`🔌 客机 ${guestPlayer.name} 已断开 KCP 连接`)
  })

  updateTeamCountUI()
  updateNetStatusUI()
  setText('peerStatusLog', `✅ 已接入客机 ${guestPlayer.name} (#${guestPlayer.id}) · WebRTC Unordered DataChannel + KCP (nodelay=1, interval=10ms)`)
  showToast(`⚡ 客机 ${guestPlayer.name} 已通过 WebRTC KCP 接入房间！`)
  return guestPlayer.id
}

/** 客机侧绑定一条已打开的 PeerConnLike */
function attachClientKcpSession(conn: PeerConnLike, roomId: string): void {
  const cliTransport = createPeerClient(conn, {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
  })
  const sync = new StateSync(world.terrain, 0)
  const session = new ClientSession(cliTransport, 0, sync)

  netState.role = 'client'
  netState.roomId = roomId
  netState.clientTransport = cliTransport
  netState.stateSync = sync
  netState.clientSession = session

  session.onSnapshot((snap: WorldSnapshot) => {
    applyAuthoritativeSnapshotToClientWorld(snap)
  })
  session.onEvents((evs) => {
    if (evs && evs.length > 0) handleEvents(evs)
  })

  conn.on('close', () => {
    showToast('⚠️ 与房主的 KCP 连接已断开，已切回单机权威模式')
    leaveMultiplayerRoom()
  })

  updateNetStatusUI()
  setText('peerStatusLog', `🚀 已连入房主 [${roomId}] · WebRTC KCP 极速同步激活（0 RTT 预测 + KCP 快重传）`)
  showToast(`🚀 已通过 WebRTC KCP 连入房间 ${roomId}`)
}

function applyAuthoritativeSnapshotToClientWorld(snap: WorldSnapshot): void {
  const interp = netState.stateSync?.interpolated() ?? snap
  world.tick = interp.tick
  world.scores = { ...interp.scores }
  world.players = interp.players
  world.projectiles = interp.projectiles
  world.grenades = interp.grenades
  world.landmines = interp.landmines
  world.airstrikes = interp.airstrikes
  world.obstacles = interp.obstacles
  world.capturePoints = interp.capturePoints
  world.ammoPacks = interp.ammoPacks
  world.supplyCrates = interp.supplyCrates
  world.mortars = interp.mortars

  const myId = netState.clientSession?.playerId ?? localPlayer.id
  const meInSnap = interp.players.find(p => p.id === myId)
  if (meInSnap) {
    Object.assign(localPlayer, meInSnap)
  }
  updateScoreboardUI()
  updateHudUI()
}

/** 启动同源 BroadcastChannel + 原生 RTCPeerConnection(ordered:false, maxRetransmits:0) KCP 信令通道 */
function setupBroadcastChannelWebRtcHost(roomId: string): void {
  if (typeof BroadcastChannel === 'undefined' || typeof RTCPeerConnection === 'undefined') return
  const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`)
  const pcs = new Map<string, RTCPeerConnection>()

  bc.onmessage = async (ev: MessageEvent) => {
    const msg = ev.data
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'join-offer' && msg.clientId && msg.sdp) {
      const pc = new RTCPeerConnection()
      pcs.set(msg.clientId, pc)
      pc.onicecandidate = (ice) => {
        if (ice.candidate) {
          bc.postMessage({ type: 'host-ice', clientId: msg.clientId, candidate: ice.candidate.toJSON() })
        }
      }
      pc.ondatachannel = (dcEv) => {
        const dc = dcEv.channel
        dc.onopen = () => {
          netState.channelMode = `WebRTC UDP(ordered:${dc.ordered},rtx:${dc.maxRetransmits ?? 0})+KCP`
          const wrapped = wrapRtcDataChannelAsPeerConn(dc, pc)
          acceptIncomingKcpGuest(wrapped, msg.playerName || 'KCP-Ranger')
        }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      bc.postMessage({ type: 'host-answer', clientId: msg.clientId, sdp: pc.localDescription?.toJSON() })
    } else if (msg.type === 'client-ice' && msg.clientId && msg.candidate) {
      const pc = pcs.get(msg.clientId)
      if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch { /* ignore */ }
      }
    }
  }

  netState.cleanupFns.push(() => {
    bc.close()
    for (const pc of pcs.values()) {
      try { pc.close() } catch { /* ignore */ }
    }
    pcs.clear()
  })
}

/** 作为房主创建 PeerJS + WebRTC KCP 房间 */
export function startHostRoom(): void {
  leaveMultiplayerRoom()
  const roomCode = 'SB2-' + Math.random().toString(36).substring(2, 7).toUpperCase()
  netState.role = 'host'
  netState.roomId = roomCode
  netState.channelMode = 'WebRTC UDP+KCP'

  const idInput = document.getElementById('peerLocalIdInput') as HTMLInputElement | null
  if (idInput) idInput.value = roomCode

  // 1. 启动本地 WebRTC RTCPeerConnection (ordered:false, maxRetransmits:0) 信令监听
  setupBroadcastChannelWebRtcHost(roomCode)

  // 2. 若加载了 PeerJS，同步注册公网 PeerJS 节点并配置 raw/unreliable WebRTC DataChannel
  const PeerCtor = getGlobalPeer()
  if (PeerCtor) {
    try {
      const peer = new PeerCtor(roomCode, { debug: 0 })
      peer.on('open', (id: string) => {
        netState.roomId = id
        if (idInput) idInput.value = id
        setText('peerStatusLog', `👑 KCP 房间已就绪 [${id}] · 等待客机通过 PeerJS / WebRTC KCP 接入`)
        updateNetStatusUI()
      })
      peer.on('connection', (conn: PeerConnLike) => {
        if (conn.on) {
          conn.on('open', () => {
            acceptIncomingKcpGuest(conn, 'Peer-Agent')
          })
        } else {
          acceptIncomingKcpGuest(conn, 'Peer-Agent')
        }
      })
      peer.on('error', () => {
        setText('peerStatusLog', `👑 KCP 房间 [${roomCode}] 已在本地 WebRTC KCP 通道就绪（可跨标签页或点击「双端KCP实测」验证）`)
      })
      netState.cleanupFns.push(() => {
        try { peer.destroy() } catch { /* ignore */ }
      })
    } catch {
      // 离线环境自动使用本地 WebRTC BroadcastChannel 信令
    }
  }

  setText('peerStatusLog', `👑 KCP 房主已创建 [${roomCode}] · WebRTC DataChannel (ordered:false, maxRetransmits:0) + KCP (nodelay=1)`)
  updateNetStatusUI()
  showToast(`👑 已创建 KCP 房间：${roomCode}`)
}

/** 作为客机加入指定房主房间（同时尝试原生 WebRTC Unordered DataChannel 与 PeerJS） */
export async function joinHostRoom(rawRoomId: string): Promise<void> {
  const roomId = rawRoomId.trim()
  if (!roomId) {
    showToast('⚠️ 请先输入房主房间码 (Peer ID)')
    return
  }
  leaveMultiplayerRoom()
  setText('peerStatusLog', `⏳ 正在向房间 [${roomId}] 发起 WebRTC 无序不可靠 DataChannel + KCP 握手...`)

  let connected = false

  // 1. 尝试同源 BroadcastChannel + 原生 RTCPeerConnection(ordered:false, maxRetransmits:0) 直连
  if (typeof BroadcastChannel !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
    const clientId = 'cli-' + Math.random().toString(36).slice(2, 8)
    const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`)
    const pc = new RTCPeerConnection()
    // 创建无序、0重传的底层 WebRTC DataChannel（UDP 语义），交由上层自定义 KCP 协议控制重传
    const dc = pc.createDataChannel('skyblast-kcp', {
      ordered: false,
      maxRetransmits: 0,
    })

    pc.onicecandidate = (ice) => {
      if (ice.candidate) {
        bc.postMessage({ type: 'client-ice', clientId, candidate: ice.candidate.toJSON() })
      }
    }

    dc.onopen = () => {
      if (connected) return
      connected = true
      netState.channelMode = `WebRTC UDP(ordered:${dc.ordered},rtx:${dc.maxRetransmits ?? 0})+KCP`
      const wrapped = wrapRtcDataChannelAsPeerConn(dc, pc)
      attachClientKcpSession(wrapped, roomId)
    }

    bc.onmessage = async (ev: MessageEvent) => {
      const msg = ev.data
      if (!msg || msg.clientId !== clientId) return
      if (msg.type === 'host-answer' && msg.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
      } else if (msg.type === 'host-ice' && msg.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch { /* ignore */ }
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    bc.postMessage({
      type: 'join-offer',
      clientId,
      playerName: localPlayer.name,
      sdp: pc.localDescription?.toJSON(),
    })

    netState.cleanupFns.push(() => {
      bc.close()
      try { dc.close() } catch { /* ignore */ }
      try { pc.close() } catch { /* ignore */ }
    })
  }

  // 2. 同时尝试公网 PeerJS 连接（serialization: 'raw', reliable: false）
  const PeerCtor = getGlobalPeer()
  if (PeerCtor) {
    try {
      const peer = new PeerCtor(undefined, { debug: 0 })
      peer.on('open', () => {
        if (connected) return
        const conn = peer.connect(roomId, {
          serialization: 'raw',
          reliable: false,
        })
        conn.on?.('open', () => {
          if (connected) return
          connected = true
          netState.channelMode = 'PeerJS(reliable:false)+KCP'
          attachClientKcpSession(conn, roomId)
        })
      })
      netState.cleanupFns.push(() => {
        try { peer.destroy() } catch { /* ignore */ }
      })
    } catch {
      // 忽略公网信令异常
    }
  }
}

/** 断开当前 PeerJS / WebRTC KCP 联机，恢复本地单机权威 */
export function leaveMultiplayerRoom(): void {
  for (const slot of netState.hostGuests.values()) {
    world.players = world.players.filter(p => p.id !== slot.playerId)
  }
  for (const fn of netState.cleanupFns) {
    try { fn() } catch { /* ignore */ }
  }
  netState.cleanupFns.length = 0
  netState.hostGuests.clear()
  netState.clientTransport = null
  netState.clientSession = null
  netState.stateSync = null
  netState.role = 'offline'
  netState.roomId = ''
  netState.peerCount = 0
  netState.channelMode = 'Unordered/UDP'
  updateTeamCountUI()
  updateNetStatusUI()
  setText('peerStatusLog', '已切回本地单机权威模式。随时可创建或加入 WebRTC KCP 联机房间。')
}

/**
 * 一键在当前页面建立真实双端 RTCPeerConnection + RTCDataChannel(ordered:false, maxRetransmits:0) + 自定义 KCP 回路自测
 */
export async function runDualWebRtcKcpSelfTest(): Promise<void> {
  if (typeof RTCPeerConnection === 'undefined') {
    showToast('⚠️ 当前环境不支持 RTCPeerConnection')
    return
  }
  if (netState.role !== 'host') {
    startHostRoom()
  }

  const pcHost = new RTCPeerConnection()
  const pcGuest = new RTCPeerConnection()

  pcHost.onicecandidate = (e) => { if (e.candidate) pcGuest.addIceCandidate(e.candidate).catch(() => {}) }
  pcGuest.onicecandidate = (e) => { if (e.candidate) pcHost.addIceCandidate(e.candidate).catch(() => {}) }

  // Guest 创建 ordered: false, maxRetransmits: 0 的 UDP 语义 DataChannel
  const guestDc = pcGuest.createDataChannel('skyblast-kcp', {
    ordered: false,
    maxRetransmits: 0,
  })

  let guestPlayerId = 0
  let guestClientSession: ClientSession | null = null
  let guestClientTransport: FastClientTransport | null = null

  pcHost.ondatachannel = (ev) => {
    const hostDc = ev.channel
    hostDc.onopen = () => {
      netState.channelMode = `WebRTC UDP(ordered:${hostDc.ordered},rtx:${hostDc.maxRetransmits ?? 0})+KCP`
      const hostConn = wrapRtcDataChannelAsPeerConn(hostDc, pcHost)
      guestPlayerId = acceptIncomingKcpGuest(hostConn, 'KCP-Phantom')
    }
  }

  guestDc.onopen = () => {
    const guestConn = wrapRtcDataChannelAsPeerConn(guestDc, pcGuest)
    guestClientTransport = createPeerClient(guestConn, {
      nodelay: 1,
      interval: 10,
      resend: 2,
      nc: 1,
    })
    const guestSync = new StateSync(world.terrain, 0)
    guestClientSession = new ClientSession(guestClientTransport, 0, guestSync)
  }

  const offer = await pcGuest.createOffer()
  await pcGuest.setLocalDescription(offer)
  await pcHost.setRemoteDescription(offer)
  const answer = await pcHost.createAnswer()
  await pcHost.setLocalDescription(answer)
  await pcGuest.setRemoteDescription(answer)

  const timer = window.setInterval(() => {
    if (!guestClientSession || guestPlayerId <= 0) return
    const t = performance.now() * 0.001
    const moveX = Math.sin(t * 1.7) > 0 ? 1 : -1
    const aimAngle = Math.atan2(
      localPlayer.pos.y - 2400,
      localPlayer.pos.x - 6600,
    )
    guestClientSession.sendIntents(
      netState.mapper.map({
        moveX,
        aimAngle,
        fire: Math.floor(t * 4) % 3 === 0,
        jump: false,
        jetpack: Math.sin(t * 3) > 0.3,
        reload: false,
      }),
      1 / 60,
    )
    guestClientTransport?.tickKcp?.(performance.now())
  }, 33)

  netState.cleanupFns.push(() => {
    window.clearInterval(timer)
    try { guestDc.close() } catch { /* ignore */ }
    try { pcGuest.close() } catch { /* ignore */ }
    try { pcHost.close() } catch { /* ignore */ }
  })
}

/** 每物理帧推进联机层（Host 端汇总 KCP 客机输入 + 维护 KCP 时钟；Client 端通过 KCP 发送本地意图并推进预测插值） */
export function stepNetworkFrame(dt: number, localInput: WorldInput, allInputs: Map<number, WorldInput>): boolean {
  const now = performance.now()

  if (netState.role === 'client' && netState.clientSession) {
    const intents = netState.mapper.map({
      moveX: localInput.move,
      aimAngle: localInput.aim,
      fire: localInput.fire,
      jump: localInput.jump,
      jetpack: localInput.jetpack,
      dive: localInput.dive,
      reload: localInput.reload,
      interact: localInput.interact,
      secondary: localInput.secondary
        ? { kind: localInput.secondary.type, targetX: localInput.secondary.targetX, targetY: localInput.secondary.targetY }
        : undefined,
      switchWeapon: localInput.switchWeapon ?? undefined,
    })
    netState.clientSession.sendIntents(intents, dt)
    netState.clientTransport?.tickKcp?.(now)
    netState.stateSync?.advance(dt, 1 / 30)
    if (now - netState.lastPingMs > 400) {
      netState.lastPingMs = now
      netState.clientTransport?.kcp?.sendPing(now)
      updateNetStatusUI()
    }
    return true
  }

  if (netState.role === 'host') {
    for (const slot of netState.hostGuests.values()) {
      allInputs.set(slot.playerId, {
        ...slot.input,
        secondary: slot.input.secondary ? { ...slot.input.secondary } : null,
      })
      slot.input.jump = false
      slot.input.interact = false
      slot.input.secondary = null
      slot.input.switchWeapon = null
      slot.input.reload = false
      slot.transport.tickKcp?.(now)
    }
    if (now - netState.lastPingMs > 400) {
      netState.lastPingMs = now
      for (const slot of netState.hostGuests.values()) {
        slot.transport.kcp?.sendPing(now)
      }
      updateNetStatusUI()
    }
  }

  return false
}

/** 房主模式下在 world.step 之后向全部 KCP 客机广播最新权威快照与事件（附带 ackSeqs 支撑客机回滚重放） */
export function broadcastHostKcpSnapshot(events: WorldEvent[]): void {
  if (netState.role !== 'host' || netState.hostGuests.size === 0) return
  const snap = world.snapshot()
  const ackSeqs: Record<number, number> = {}
  for (const slot of netState.hostGuests.values()) {
    ackSeqs[slot.playerId] = slot.lastAckSeq
  }
  snap.ackSeqs = ackSeqs
  const sharedFrame = encodeServerWireFrame({ snap, events })
  for (const slot of netState.hostGuests.values()) {
    if (slot.transport.sendRawFrame) {
      slot.transport.sendRawFrame(sharedFrame)
    } else {
      slot.transport.send({ snap, events })
    }
  }
}
