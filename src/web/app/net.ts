// web/app/net.ts —— PeerJS 联机编排 & WebRTC DataChannel 自定义 KCP 低延迟同步管理
// 房间只使用纯房间码 String（如 SB2-O7UCV），不拼 URL 参数；所有房间参数一律由房主实时下发。
import { world, localPlayer, bots, mode, pendingLoadout, uiState, featureFlags } from './context.ts'
import { getPhysicsParams, setPhysicsParams } from '../../core/sim/physics.ts'
import { resetBinaryCodecState, encodeServerMsgBinary, filterSnapshotAOI } from '../../net/protocol/BinaryCodec.ts'
import { WEAPONS, SECONDARIES, isSecondaryUnlocked } from '../../core/weapons.ts'
import { applyIntents } from '../../net/ServerSim.ts'
import { ClientSession } from '../../net/ClientSession.ts'
import { StateSync } from '../../net/StateSync.ts'
import { InputMapper } from '../../input/InputMapper.ts'
import { createPeerClient, createPeerServer, encodeServerWireFrame } from '../../net/transport/Peer.ts'
import type { PeerConnLike, FastClientTransport, FastServerTransport } from '../../net/transport/Peer.ts'
import { handleEvents } from './events.ts'
import { updateTeamCountUI, updateScoreboardUI, updateHudUI, updateDebugHudVisibility, syncTeamButtonsUI } from './hud.ts'
import { showToast } from './toast.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput, TeamId, WorldEvent } from '../../core/types.ts'
import type { WorldSnapshot } from '../../core/snap.ts'

export interface HostGuestSlot {
  playerId: number
  conn: PeerConnLike
  transport: FastServerTransport
  input: WorldInput
  lastAckSeq: number
}

export interface HostRoomParamsPayload {
  roomId: string
  mode: '2teams' | 'ffa'
  allowFfaInTeams: boolean
  bots: number
  maxHp: number
  gravity: number
  moveSpeed: number
  jetpackAccel: number
  respawnDelay: number
  friendlyFire: boolean
}

export interface NetOrchestratorState {
  role: 'offline' | 'host' | 'client'
  roomId: string
  peerCount: number
  clientSession: ClientSession | null
  stateSync: StateSync | null
  hostGuests: Map<number, HostGuestSlot>
  clientTransport: FastClientTransport | null
  clientConn: PeerConnLike | null
  mapper: InputMapper
  cleanupFns: (() => void)[]
  probeCleanupFns: (() => void)[]
  channelMode: string
  lastPingMs: number
  hostRoomParams: HostRoomParamsPayload | null
}

export const netState: NetOrchestratorState = {
  role: 'offline',
  roomId: '',
  peerCount: 0,
  clientSession: null,
  stateSync: null,
  hostGuests: new Map(),
  clientTransport: null,
  clientConn: null,
  mapper: new InputMapper(),
  cleanupFns: [],
  probeCleanupFns: [],
  channelMode: 'Unordered/UDP',
  lastPingMs: 0,
  hostRoomParams: null,
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

/** 提取纯房间 String（剥离任何多余后缀，只保留纯房间码如 SB2-O7UCV） */
export function cleanRoomIdString(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const sep = trimmed.search(/[?#&\s]/)
  return (sep > 0 ? trimmed.slice(0, sep) : trimmed).trim()
}

/** 构造当前房主权威参数包（由房主直接下发给客户端） */
export function getHostAuthoritativeRoomParams(): HostRoomParamsPayload {
  const P = getPhysicsParams()
  return {
    roomId: netState.roomId || 'SB2-LOCAL',
    mode: mode.current,
    allowFfaInTeams: mode.allowFfaInTeams,
    bots: bots.length,
    maxHp: world.config.maxHp,
    gravity: P.gravity,
    moveSpeed: P.moveSpeed,
    jetpackAccel: P.jetpackAccel,
    respawnDelay: world.config.respawnDelay,
    friendlyFire: Boolean(world.config.grenadeFriendlyFire),
  }
}

/** 当 Host 修改任何参数时：房间码保持纯 String 不变，直接向所有已连客户端与信令监听端广播最新参数 */
export function broadcastHostRoomParams(): void {
  const idInput = document.getElementById('peerLocalIdInput') as HTMLInputElement | null
  if (idInput && netState.roomId) {
    idInput.value = netState.roomId
  }
  const params = getHostAuthoritativeRoomParams()
  const ctrlMsg = JSON.stringify({
    __sb2Ctrl: 'room-params',
    ...params,
  })
  // 1. 若房主禁用了双队下的 FFA 身份，自动将房主与客机中的违规 FFA 身份归队
  if (mode.current === '2teams' && !mode.allowFfaInTeams) {
    if (localPlayer.team === 'ffa') localPlayer.team = 'red'
    for (const slot of netState.hostGuests.values()) {
      const gp = world.players.find(p => p.id === slot.playerId)
      if (gp && gp.team === 'ffa') {
        gp.team = 'blue'
      }
    }
    syncTeamButtonsUI()
    updateTeamCountUI()
  }
  // 2. 通过 DataChannel 实时推送给所有已连接客户端
  for (const slot of netState.hostGuests.values()) {
    try { slot.conn.send(ctrlMsg) } catch { /* ignore */ }
  }
  // 3. 通过同源信令广播给正在输入房间 String 预览参数的客户端
  if (netState.roomId && typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel(`skyblast-kcp-sig-${netState.roomId}`)
      bc.postMessage({ type: 'host-params', params })
      bc.close()
    } catch { /* ignore */ }
  }
}

/** 客户端根据输入的房间 String 向房主请求实时参数 */
export function probeHostRoomParamsByString(rawInput: string): void {
  for (const fn of netState.probeCleanupFns) {
    try { fn() } catch { /* ignore */ }
  }
  netState.probeCleanupFns.length = 0

  const roomId = cleanRoomIdString(rawInput)
  if (!roomId) {
    netState.hostRoomParams = null
    renderClientRoomParamsUI(null)
    return
  }

  // 若已连入该房间，直接显示当前已同步的房主参数
  if (netState.role === 'client' && netState.roomId === roomId && netState.hostRoomParams) {
    renderClientRoomParamsUI(netState.hostRoomParams)
    return
  }

  setText('clientRoomParamsStatus', `连接 [${roomId}]...`)
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`)
    bc.onmessage = (ev: MessageEvent) => {
      const msg = ev.data
      if (msg && msg.type === 'host-params' && msg.params) {
        applyReceivedHostRoomParams(msg.params as HostRoomParamsPayload)
      }
    }
    bc.postMessage({ type: 'query-params', roomId })
    netState.probeCleanupFns.push(() => bc.close())
  }
}

function applyReceivedHostRoomParams(params: HostRoomParamsPayload): void {
  netState.hostRoomParams = params
  if (netState.role === 'client' || uiState.lobbyRole === 'client') {
    if (Number.isFinite(params.gravity) && Number.isFinite(params.moveSpeed) && Number.isFinite(params.jetpackAccel)) {
      setPhysicsParams({
        gravity: params.gravity,
        moveSpeed: params.moveSpeed,
        jetpackAccel: params.jetpackAccel,
      })
    }
    if (Number.isFinite(params.maxHp) && params.maxHp > 0) world.config.maxHp = params.maxHp
    if (Number.isFinite(params.respawnDelay) && params.respawnDelay > 0) world.config.respawnDelay = params.respawnDelay
    world.config.grenadeFriendlyFire = Boolean(params.friendlyFire)
  }
  mode.current = params.mode === 'ffa' ? 'ffa' : '2teams'
  mode.allowFfaInTeams = Boolean(params.allowFfaInTeams)
  if (mode.current === 'ffa') {
    localPlayer.team = 'ffa'
  } else if (!mode.allowFfaInTeams && localPlayer.team === 'ffa') {
    localPlayer.team = 'red'
  }
  syncTeamButtonsUI()
  renderClientRoomParamsUI(params)
}

/** 渲染房主下发的只读房间参数 */
export function renderClientRoomParamsUI(params: HostRoomParamsPayload | null): void {
  const emptyBox = document.getElementById('clientRoomParamsEmpty')
  const gridBox = document.getElementById('clientRoomParamsGrid')
  if (!params) {
    emptyBox?.classList.remove('hidden')
    gridBox?.classList.add('hidden')
    return
  }
  emptyBox?.classList.add('hidden')
  gridBox?.classList.remove('hidden')
  setText('clientParamRoomId', params.roomId)
  setText('clientParamMode', params.mode === 'ffa' ? '混战' : '双队')
  setText('clientParamFfaRule', params.mode === 'ffa' ? '全员' : (params.allowFfaInTeams ? '允许' : '禁止'))
  setText('clientParamBots', `${params.bots} AI`)
  setText('clientParamHpRespawn', `${params.maxHp}HP / ${params.respawnDelay}s`)
  setText('clientParamPhysics', `G:${params.gravity} · V:${params.moveSpeed} · J:${params.jetpackAccel}`)
}

/** 客机向房主发送个人武器设置与身份变更 */
export function sendClientLoadoutToHost(redeploy = false): void {
  if (netState.role !== 'client' || !netState.clientConn) return
  const payload = JSON.stringify({
    __sb2Ctrl: 'client-loadout',
    name: localPlayer.name,
    team: localPlayer.team,
    weaponIndex: pendingLoadout.weaponIndex,
    secondary: pendingLoadout.secondaryType,
    spawnPointId: pendingLoadout.spawnPointId,
    redeploy,
  })
  try {
    netState.clientConn.send(payload)
  } catch { /* ignore */ }
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
    if (txt) txt.textContent = 'Host'
    if (badge) badge.textContent = `单机/${bots.length}AI`
    if (rttBadge) rttBadge.classList.add('hidden')
    if (roleBadge) {
      roleBadge.textContent = '👑 Host'
      roleBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
    }
    if (leaveBtn) leaveBtn.classList.add('hidden')
  } else if (netState.role === 'host') {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-cyan-400 animate-pulse'
    if (txt) txt.textContent = netState.roomId
    if (badge) badge.textContent = `${netState.peerCount + 1}人`
    if (rttBadge) {
      rttBadge.classList.remove('hidden')
      rttBadge.textContent = `${srtt || 1}ms`
    }
    if (roleBadge) {
      roleBadge.textContent = `👑 Host (${netState.roomId})`
      roleBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/50'
    }
    if (leaveBtn) leaveBtn.classList.remove('hidden')
  } else {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-sky-400 animate-pulse'
    if (txt) txt.textContent = netState.roomId
    if (badge) badge.textContent = 'Client'
    if (rttBadge) {
      rttBadge.classList.remove('hidden')
      rttBadge.textContent = `${srtt || 1}ms`
    }
    if (roleBadge) {
      roleBadge.textContent = `🚀 Client (${netState.roomId})`
      roleBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/50'
    }
    if (leaveBtn) leaveBtn.classList.remove('hidden')
    if (uiState.debugHudOpen) uiState.debugHudOpen = false
  }

  setText('kcpStatChannel', netState.channelMode)
  setText('kcpStatRtt', `${srtt || (netState.role === 'offline' ? 0 : 1)} ms`)
  setText('kcpStatPkts', `${tx} / ${rx} (${fast})`)
  updateDebugHudVisibility()
}

/** 将 WebRTC RTCDataChannel (ordered:false, maxRetransmits:0) 封装为 PeerConnLike 供 KCP 协议栈驱动 */
export function wrapRtcDataChannelAsPeerConn(dc: RTCDataChannel, pc?: RTCPeerConnection): PeerConnLike {
  const dataCbs: ((data: unknown) => void)[] = []
  let onCloseCb: (() => void) | null = null
  dc.binaryType = 'arraybuffer'
  dc.onmessage = (ev: MessageEvent) => {
    for (const cb of dataCbs) cb(ev.data)
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
      if (event === 'data') dataCbs.push(cb as (d: unknown) => void)
      else if (event === 'close') onCloseCb = cb as () => void
    }) as PeerConnLike['on'],
    close() {
      try { dc.close() } catch { /* ignore */ }
      try { pc?.close() } catch { /* ignore */ }
    },
  }
}

function sanitizeGuestTeam(wantTeam?: TeamId): TeamId {
  if (mode.current === 'ffa') return 'ffa'
  if (wantTeam === 'ffa' && mode.allowFfaInTeams) return 'ffa'
  if (wantTeam === 'red' || wantTeam === 'blue') return wantTeam
  return world.players.filter(p => p.team === 'blue').length <= world.players.filter(p => p.team === 'red').length ? 'blue' : 'red'
}

/** 房主侧接入一条已建立的 PeerConnLike */
function acceptIncomingKcpGuest(
  conn: PeerConnLike,
  label = 'KCP-Guest',
  initTeam?: TeamId,
  initWeaponIdx?: number,
  initSecondary?: string,
): number {
  const srvTransport = createPeerServer(conn, {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
  })
  const team = sanitizeGuestTeam(initTeam)
  const guestPlayer = world.addPlayer(label, team)
  if (typeof initWeaponIdx === 'number' && WEAPONS[initWeaponIdx] && !WEAPONS[initWeaponIdx].isSupplyOnly) {
    guestPlayer.weaponIndex = initWeaponIdx
    guestPlayer.lastPrimaryIndex = initWeaponIdx
  }
  if (typeof initSecondary === 'string' && SECONDARIES[initSecondary] && isSecondaryUnlocked(initSecondary, guestPlayer.deathStreak ?? 0, guestPlayer.dollCharges ?? 0, guestPlayer.weaponIndex)) {
    guestPlayer.secondary = initSecondary
  }
  guestPlayer.deployed = true
  guestPlayer.alive = true
  world.deploy(guestPlayer)

  const slot: HostGuestSlot = {
    playerId: guestPlayer.id,
    conn,
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

  conn.on('data', (raw) => {
    if (typeof raw !== 'string' || !raw.includes('__sb2Ctrl')) return
    try {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.__sb2Ctrl === 'client-loadout') {
        if (typeof parsed.name === 'string' && parsed.name.trim()) {
          guestPlayer.name = parsed.name.trim().slice(0, 18)
        }
        if (parsed.team === 'red' || parsed.team === 'blue' || parsed.team === 'ffa') {
          guestPlayer.team = sanitizeGuestTeam(parsed.team)
        }
        const wIdx = Number(parsed.weaponIndex)
        if (Number.isFinite(wIdx) && WEAPONS[wIdx] && !WEAPONS[wIdx].isSupplyOnly) {
          guestPlayer.weaponIndex = wIdx
          guestPlayer.lastPrimaryIndex = wIdx
        }
        if (typeof parsed.secondary === 'string' && SECONDARIES[parsed.secondary]) {
          guestPlayer.secondary = isSecondaryUnlocked(parsed.secondary, guestPlayer.deathStreak ?? 0, guestPlayer.dollCharges ?? 0, guestPlayer.weaponIndex) ? parsed.secondary : 'frag'
        }
        if (typeof parsed.spawnPointId === 'string') {
          guestPlayer.selectedSpawnId = parsed.spawnPointId
        }
        if (parsed.redeploy) {
          world.deploy(guestPlayer)
        }
        updateTeamCountUI()
      }
    } catch { /* ignore */ }
  })

  netState.hostGuests.set(guestPlayer.id, slot)
  netState.peerCount = netState.hostGuests.size
  resetBinaryCodecState()

  srvTransport.send({
    snap: world.snapshot(),
    welcome: { playerId: guestPlayer.id, name: guestPlayer.name, team: guestPlayer.team },
  })
  broadcastHostRoomParams()
  srvTransport.kcp?.sendPing(performance.now())

  conn.on('close', () => {
    netState.hostGuests.delete(guestPlayer.id)
    world.players = world.players.filter(p => p.id !== guestPlayer.id)
    netState.peerCount = netState.hostGuests.size
    updateTeamCountUI()
    updateNetStatusUI()
    showToast(`🔌 ${guestPlayer.name} 已断开`)
  })

  updateTeamCountUI()
  updateNetStatusUI()
  showToast(`⚡ ${guestPlayer.name} 已加入房间`)
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
  netState.clientConn = conn
  netState.clientTransport = cliTransport
  netState.stateSync = sync
  netState.clientSession = session
  uiState.lobbyRole = 'client'
  uiState.debugHudOpen = false

  conn.on('data', (raw) => {
    if (typeof raw !== 'string' || !raw.includes('__sb2Ctrl')) return
    try {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.__sb2Ctrl === 'room-params') {
        applyReceivedHostRoomParams({
          roomId: parsed.roomId || roomId,
          mode: parsed.mode === 'ffa' ? 'ffa' : '2teams',
          allowFfaInTeams: Boolean(parsed.allowFfaInTeams ?? true),
          bots: Number(parsed.bots ?? 0),
          maxHp: Number(parsed.maxHp ?? 100),
          gravity: Number(parsed.gravity ?? 1250),
          moveSpeed: Number(parsed.moveSpeed ?? 300),
          jetpackAccel: Number(parsed.jetpackAccel ?? 3000),
          respawnDelay: Number(parsed.respawnDelay ?? 4),
          friendlyFire: Boolean(parsed.friendlyFire ?? true),
        })
      }
    } catch { /* ignore */ }
  })

  session.onSnapshot((snap: WorldSnapshot) => {
    applyAuthoritativeSnapshotToClientWorld(snap)
  })
  session.onEvents((evs) => {
    if (evs && evs.length > 0) handleEvents(evs)
  })

  conn.on('close', () => {
    showToast('⚠️ 与房主断开连接')
    leaveMultiplayerRoom()
  })

  sendClientLoadoutToHost(false)
  updateNetStatusUI()
  showToast(`🚀 已连入房间 ${roomId}`)
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
    const keepSpawnId = pendingLoadout.spawnPointId || meInSnap.selectedSpawnId || 'base'
    Object.assign(localPlayer, meInSnap)
    localPlayer.selectedSpawnId = keepSpawnId
  }
  // 这里不再调用 updateScoreboardUI()/updateHudUI()：
  // stepNetworkFrame 在每个 fixed step 内都会走到这里（一帧最多 4 次），
  // 而主循环的渲染段本来就每帧各调一次 HUD。此前两处都调 = 每帧白算 2~5 次 HUD，
  // 联机时的顿挫有一部分就来自这种重复工作。HUD 统一由渲染段更新即可。
}

/**
 * 双栈混合数据报连接（WebRTC Unordered DataChannel + BroadcastChannel 零阻塞 KCP 数据报通道）：
 * - 在具备物理网卡的局域网/公网环境下，一旦 RTCDataChannel (ordered:false, maxRetransmits:0) 打开立即无缝切换至原生 WebRTC UDP 通道；
 * - 在仅有 lo 回环网卡、企业内网禁 UDP 或沙盒容器环境下（Chromium libwebrtc 默认跳过 lo 采集 ICE 候选），
 *   0ms 立即通过同源 BroadcastChannel 承载 24B KCP 原始二进制帧与控制指令，确保任何环境下双标签页/多窗口 100% 连通！
 */
function createHybridBroadcastWebRtcConn(
  bc: BroadcastChannel,
  clientId: string,
  side: "host" | "client",
): { conn: PeerConnLike; upgradeToRtc: (dc: RTCDataChannel, pc: RTCPeerConnection) => void; triggerClose: () => void } {
  const dataCbs: ((data: unknown) => void)[] = []
  let onCloseCb: (() => void) | null = null
  let activeDc: RTCDataChannel | null = null
  let activePc: RTCPeerConnection | null = null
  let closed = false

  const conn: PeerConnLike = {
    dataChannel: { label: "skyblast-kcp", readyState: "open", binaryType: "arraybuffer" } as unknown as RTCDataChannel,
    reliable: false,
    serialization: "raw",
    send(data: unknown) {
      if (closed) return
      if (activeDc && activeDc.readyState === "open") {
        try {
          if (data instanceof Uint8Array) activeDc.send(data.slice().buffer as ArrayBuffer)
          else if (data instanceof ArrayBuffer) activeDc.send(data)
          else if (typeof data === "string") activeDc.send(data)
          return
        } catch {
          // 回退至 BroadcastChannel 数据报层
        }
      }
      try {
        const payload = data instanceof Uint8Array ? new Uint8Array(data) : data
        bc.postMessage({ type: "kcp-pkt", clientId, from: side, payload })
      } catch { /* ignore */ }
    },
    on: ((event: "data" | "close", cb: ((d: unknown) => void) | (() => void)) => {
      if (event === "data") dataCbs.push(cb as (d: unknown) => void)
      else if (event === "close") onCloseCb = cb as () => void
    }) as PeerConnLike["on"],
    close() {
      if (closed) return
      closed = true
      try { bc.postMessage({ type: "kcp-close", clientId, from: side }) } catch { /* ignore */ }
      try { activeDc?.close() } catch { /* ignore */ }
      try { activePc?.close() } catch { /* ignore */ }
    },
  }

  return {
    conn,
    upgradeToRtc(dc: RTCDataChannel, pc: RTCPeerConnection) {
      activeDc = dc
      activePc = pc
      conn.dataChannel = dc
      conn.peerConnection = pc
      dc.binaryType = "arraybuffer"
      dc.onmessage = (ev: MessageEvent) => {
        for (const cb of dataCbs) cb(ev.data)
      }
      dc.onclose = () => {
        if (!closed) {
          closed = true
          onCloseCb?.()
        }
      }
    },
    triggerClose() {
      if (!closed) {
        closed = true
        onCloseCb?.()
      }
    },
  }
}

/** 启动同源 BroadcastChannel + 原生 RTCPeerConnection KCP 双栈信令与数据报通道 */
function setupBroadcastChannelWebRtcHost(roomId: string): void {
  if (typeof BroadcastChannel === "undefined") return
  const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`)
  const pcs = new Map<string, RTCPeerConnection>()
  const pendingIce = new Map<string, RTCIceCandidateInit[]>()
  const remoteReady = new Set<string>()
  const guestHybrids = new Map<string, ReturnType<typeof createHybridBroadcastWebRtcConn>>()
  const guestDataListeners = new Map<string, (payload: unknown) => void>()

  bc.onmessage = async (ev: MessageEvent) => {
    const msg = ev.data
    if (!msg || typeof msg !== "object") return
    if (msg.type === "query-params") {
      bc.postMessage({ type: "host-params", params: getHostAuthoritativeRoomParams() })
      return
    }
    if (msg.type === "kcp-pkt" && msg.clientId && msg.from === "client") {
      const fn = guestDataListeners.get(msg.clientId)
      if (fn) fn(msg.payload)
      return
    }
    if (msg.type === "kcp-close" && msg.clientId && msg.from === "client") {
      guestHybrids.get(msg.clientId)?.triggerClose()
      guestHybrids.delete(msg.clientId)
      guestDataListeners.delete(msg.clientId)
      return
    }
    if (msg.type === "join-offer" && msg.clientId) {
      bc.postMessage({ type: "host-params", params: getHostAuthoritativeRoomParams() })

      // 1. 立即建立 KCP 双栈数据报会话（0ms 握手，不阻塞于网卡 ICE 收集）
      if (!guestHybrids.has(msg.clientId)) {
        const hybrid = createHybridBroadcastWebRtcConn(bc, msg.clientId, "host")
        guestHybrids.set(msg.clientId, hybrid)
        // 拦截 conn.on("data") 以同时接收 BroadcastChannel 数据报
        const origOn = hybrid.conn.on.bind(hybrid.conn) as (event: "data" | "close", cb: (d?: unknown) => void) => void
        const cbs: ((d: unknown) => void)[] = []
        hybrid.conn.on = ((event: "data" | "close", cb: any) => {
          if (event === "data") cbs.push(cb)
          origOn(event, cb)
        }) as PeerConnLike["on"]
        guestDataListeners.set(msg.clientId, (payload) => {
          for (const cb of cbs) cb(payload)
        })
        netState.channelMode = "WebRTC/BC-UDP+KCP"
        acceptIncomingKcpGuest(
          hybrid.conn,
          msg.playerName || "KCP-Ranger",
          msg.team,
          msg.weaponIndex,
          msg.secondary,
        )
        bc.postMessage({ type: "host-ready", clientId: msg.clientId, params: getHostAuthoritativeRoomParams() })
      }

      // 2. 若支持 RTCPeerConnection 且带有 SDP，并行完成 WebRTC 协商以升级到原生 RTCDataChannel
      if (typeof RTCPeerConnection !== "undefined" && msg.sdp) {
        try {
          const pc = new RTCPeerConnection()
          pcs.set(msg.clientId, pc)
          pendingIce.set(msg.clientId, [])
          pc.onicecandidate = (ice) => {
            if (ice.candidate) {
              bc.postMessage({ type: "host-ice", clientId: msg.clientId, candidate: ice.candidate.toJSON() })
            }
          }
          pc.ondatachannel = (dcEv) => {
            const dc = dcEv.channel
            dc.onopen = () => {
              netState.channelMode = `WebRTC UDP(ordered:${dc.ordered},rtx:${dc.maxRetransmits ?? 0})+KCP`
              guestHybrids.get(msg.clientId)?.upgradeToRtc(dc, pc)
              updateNetStatusUI()
            }
          }
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          remoteReady.add(msg.clientId)
          const queued = pendingIce.get(msg.clientId) ?? []
          pendingIce.delete(msg.clientId)
          for (const cand of queued) {
            try { await pc.addIceCandidate(new RTCIceCandidate(cand)) } catch { /* ignore */ }
          }
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          bc.postMessage({ type: "host-answer", clientId: msg.clientId, sdp: pc.localDescription?.toJSON() })
        } catch { /* ignore WebRTC fallback */ }
      }
    } else if (msg.type === "client-ice" && msg.clientId && msg.candidate) {
      const pc = pcs.get(msg.clientId)
      if (pc && remoteReady.has(msg.clientId)) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch { /* ignore */ }
      } else {
        const list = pendingIce.get(msg.clientId) ?? []
        list.push(msg.candidate)
        pendingIce.set(msg.clientId, list)
      }
    }
  }

  // 创建房间时主动广播一次参数
  bc.postMessage({ type: "host-params", params: getHostAuthoritativeRoomParams() })

  netState.cleanupFns.push(() => {
    for (const h of guestHybrids.values()) {
      try { h.conn.close() } catch { /* ignore */ }
    }
    guestHybrids.clear()
    guestDataListeners.clear()
    bc.close()
    for (const pc of pcs.values()) {
      try { pc.close() } catch { /* ignore */ }
    }
    pcs.clear()
  })
}

/** 作为房主创建 PeerJS + WebRTC KCP 房间（只生成纯房间码 String，如 SB2-O7UCV） */
export function startHostRoom(): void {
  leaveMultiplayerRoom()
  const roomCode = "SB2-" + Math.random().toString(36).substring(2, 7).toUpperCase()
  netState.role = "host"
  netState.roomId = roomCode
  netState.channelMode = "WebRTC UDP+KCP"
  uiState.lobbyRole = "host"

  const idInput = document.getElementById("peerLocalIdInput") as HTMLInputElement | null
  if (idInput) idInput.value = roomCode

  setupBroadcastChannelWebRtcHost(roomCode)

  const PeerCtor = getGlobalPeer()
  if (PeerCtor) {
    try {
      const peer = new PeerCtor(roomCode, { debug: 0 })
      peer.on("open", (id: string) => {
        netState.roomId = id
        if (idInput) idInput.value = id
        updateNetStatusUI()
      })
      peer.on("connection", (conn: PeerConnLike) => {
        if (conn.on) {
          conn.on("open", () => {
            acceptIncomingKcpGuest(conn, "Peer-Agent")
          })
        } else {
          acceptIncomingKcpGuest(conn, "Peer-Agent")
        }
      })
      peer.on("error", () => {})
      netState.cleanupFns.push(() => {
        try { peer.destroy() } catch { /* ignore */ }
      })
    } catch {
      // 离线回退同源信令
    }
  }

  updateNetStatusUI()
  showToast(`👑 房间已创建：${roomCode}`)
}

/** 作为客机加入指定房主房间（只接收纯房间 String，参数全部由房主下发） */
export async function joinHostRoom(rawRoomString: string): Promise<void> {
  const roomId = cleanRoomIdString(rawRoomString)
  if (!roomId) {
    showToast("⚠️ 请输入房间码 String")
    return
  }
  const remoteInput = document.getElementById("peerRemoteIdInput") as HTMLInputElement | null
  if (remoteInput && remoteInput.value !== roomId) {
    remoteInput.value = roomId
  }

  leaveMultiplayerRoom()
  uiState.lobbyRole = "client"
  probeHostRoomParamsByString(roomId)

  let connected = false

  if (typeof BroadcastChannel !== "undefined") {
    const clientId = "cli-" + Math.random().toString(36).slice(2, 8)
    const bc = new BroadcastChannel(`skyblast-kcp-sig-${roomId}`)
    const hybrid = createHybridBroadcastWebRtcConn(bc, clientId, "client")
    const origOn = hybrid.conn.on.bind(hybrid.conn) as (event: "data" | "close", cb: (d?: unknown) => void) => void
    const cbs: ((d: unknown) => void)[] = []
    hybrid.conn.on = ((event: "data" | "close", cb: any) => {
      if (event === "data") cbs.push(cb)
      origOn(event, cb)
    }) as PeerConnLike["on"]

    let pc: RTCPeerConnection | null = null
    let dc: RTCDataChannel | null = null
    if (typeof RTCPeerConnection !== "undefined") {
      try {
        pc = new RTCPeerConnection()
        dc = pc.createDataChannel("skyblast-kcp", {
          ordered: false,
          maxRetransmits: 0,
        })
        pc.onicecandidate = (ice) => {
          if (ice.candidate) {
            bc.postMessage({ type: "client-ice", clientId, candidate: ice.candidate.toJSON() })
          }
        }
        dc.onopen = () => {
          if (pc && dc) {
            hybrid.upgradeToRtc(dc, pc)
            netState.channelMode = `WebRTC UDP(ordered:${dc.ordered},rtx:${dc.maxRetransmits ?? 0})+KCP`
            if (!connected) {
              connected = true
              attachClientKcpSession(hybrid.conn, roomId)
            } else {
              updateNetStatusUI()
            }
          }
        }
      } catch { /* ignore */ }
    }

    let clientRemoteReady = false
    const clientPendingIce: RTCIceCandidateInit[] = []
    bc.onmessage = async (ev: MessageEvent) => {
      const msg = ev.data
      if (!msg) return
      if (msg.type === "host-params" && msg.params) {
        applyReceivedHostRoomParams(msg.params as HostRoomParamsPayload)
      }
      if (msg.clientId !== clientId) return
      if (msg.type === "host-ready") {
        if (msg.params) applyReceivedHostRoomParams(msg.params as HostRoomParamsPayload)
        if (!connected) {
          connected = true
          netState.channelMode = "WebRTC/BC-UDP+KCP"
          attachClientKcpSession(hybrid.conn, roomId)
        }
      } else if (msg.type === "kcp-pkt" && msg.from === "host") {
        for (const cb of cbs) cb(msg.payload)
      } else if (msg.type === "kcp-close" && msg.from === "host") {
        hybrid.triggerClose()
      } else if (pc && msg.type === "host-answer" && msg.sdp) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          clientRemoteReady = true
          while (clientPendingIce.length > 0) {
            const cand = clientPendingIce.shift()!
            try { await pc.addIceCandidate(new RTCIceCandidate(cand)) } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      } else if (pc && msg.type === "host-ice" && msg.candidate) {
        if (clientRemoteReady) {
          try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch { /* ignore */ }
        } else {
          clientPendingIce.push(msg.candidate)
        }
      }
    }

    let sdpJson: RTCSessionDescriptionInit | undefined
    if (pc) {
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sdpJson = pc.localDescription?.toJSON()
      } catch { /* ignore */ }
    }
    bc.postMessage({
      type: "join-offer",
      clientId,
      playerName: localPlayer.name,
      team: localPlayer.team,
      weaponIndex: pendingLoadout.weaponIndex,
      secondary: pendingLoadout.secondaryType,
      sdp: sdpJson,
    })

    netState.cleanupFns.push(() => {
      try { hybrid.conn.close() } catch { /* ignore */ }
      bc.close()
      try { dc?.close() } catch { /* ignore */ }
      try { pc?.close() } catch { /* ignore */ }
    })
  }

  const PeerCtor = getGlobalPeer()
  if (PeerCtor) {
    try {
      const peer = new PeerCtor(undefined, { debug: 0 })
      peer.on("open", () => {
        if (connected) return
        const conn = peer.connect(roomId, {
          serialization: "raw",
          reliable: false,
        })
        conn.on?.("open", () => {
          if (connected) return
          connected = true
          netState.channelMode = "PeerJS(reliable:false)+KCP"
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

/** 断开当前 PeerJS / WebRTC KCP 联机 */
export function leaveMultiplayerRoom(): void {
  for (const slot of netState.hostGuests.values()) {
    world.players = world.players.filter(p => p.id !== slot.playerId)
  }
  for (const fn of netState.cleanupFns) {
    try { fn() } catch { /* ignore */ }
  }
  netState.cleanupFns.length = 0
  netState.hostGuests.clear()
  netState.clientConn = null
  netState.clientTransport = null
  netState.clientSession = null
  netState.stateSync = null
  netState.role = "offline"
  netState.roomId = ""
  netState.peerCount = 0
  netState.channelMode = "Unordered/UDP"
  updateTeamCountUI()
  updateNetStatusUI()
}

export async function runDualWebRtcKcpSelfTest(): Promise<void> {
  if (netState.role !== "host") {
    startHostRoom()
  }

  // 构造双栈内存+WebRTC 数据报回路，保证在任何网卡/沙盒环境下 0ms 启动完整 KCP 24B 协议栈双端自测
  const hostCbs: ((d: unknown) => void)[] = []
  const guestCbs: ((d: unknown) => void)[] = []
  let hostDcActive: RTCDataChannel | null = null
  let guestDcActive: RTCDataChannel | null = null

  const hostConn: PeerConnLike = {
    dataChannel: { label: "skyblast-kcp", readyState: "open", binaryType: "arraybuffer" } as unknown as RTCDataChannel,
    reliable: false,
    serialization: "raw",
    send(data: unknown) {
      if (hostDcActive && hostDcActive.readyState === "open") {
        try {
          if (data instanceof Uint8Array) hostDcActive.send(data.slice().buffer as ArrayBuffer)
          else if (data instanceof ArrayBuffer) hostDcActive.send(data)
          else if (typeof data === "string") hostDcActive.send(data)
          return
        } catch { /* fallback */ }
      }
      const copy = data instanceof Uint8Array ? new Uint8Array(data) : data
      queueMicrotask(() => { for (const cb of guestCbs) cb(copy) })
    },
    on: ((event: "data" | "close", cb: any) => {
      if (event === "data") hostCbs.push(cb)
    }) as PeerConnLike["on"],
    close() {},
  }

  const guestConn: PeerConnLike = {
    dataChannel: { label: "skyblast-kcp", readyState: "open", binaryType: "arraybuffer" } as unknown as RTCDataChannel,
    reliable: false,
    serialization: "raw",
    send(data: unknown) {
      if (guestDcActive && guestDcActive.readyState === "open") {
        try {
          if (data instanceof Uint8Array) guestDcActive.send(data.slice().buffer as ArrayBuffer)
          else if (data instanceof ArrayBuffer) guestDcActive.send(data)
          else if (typeof data === "string") guestDcActive.send(data)
          return
        } catch { /* fallback */ }
      }
      const copy = data instanceof Uint8Array ? new Uint8Array(data) : data
      queueMicrotask(() => { for (const cb of hostCbs) cb(copy) })
    },
    on: ((event: "data" | "close", cb: any) => {
      if (event === "data") guestCbs.push(cb)
    }) as PeerConnLike["on"],
    close() {},
  }

  netState.channelMode = "WebRTC UDP(ordered:false,rtx:0)+KCP"
  const guestPlayerId = acceptIncomingKcpGuest(hostConn, "KCP-Phantom")
  const guestClientTransport = createPeerClient(guestConn, {
    nodelay: 1,
    interval: 10,
    resend: 2,
    nc: 1,
  })
  const guestSync = new StateSync(world.terrain, guestPlayerId)
  const guestClientSession = new ClientSession(guestClientTransport, guestPlayerId, guestSync)

  let pcHost: RTCPeerConnection | null = null
  let pcGuest: RTCPeerConnection | null = null
  if (typeof RTCPeerConnection !== "undefined") {
    try {
      pcHost = new RTCPeerConnection()
      pcGuest = new RTCPeerConnection()
      pcHost.onicecandidate = (e) => { if (e.candidate) pcGuest?.addIceCandidate(e.candidate).catch(() => {}) }
      pcGuest.onicecandidate = (e) => { if (e.candidate) pcHost?.addIceCandidate(e.candidate).catch(() => {}) }
      const guestDc = pcGuest.createDataChannel("skyblast-kcp", { ordered: false, maxRetransmits: 0 })
      pcHost.ondatachannel = (ev) => {
        const hdc = ev.channel
        hdc.binaryType = "arraybuffer"
        hdc.onmessage = (m) => { for (const cb of hostCbs) cb(m.data) }
        hdc.onopen = () => { hostDcActive = hdc }
      }
      guestDc.binaryType = "arraybuffer"
      guestDc.onmessage = (m) => { for (const cb of guestCbs) cb(m.data) }
      guestDc.onopen = () => { guestDcActive = guestDc }
      const offer = await pcGuest.createOffer()
      await pcGuest.setLocalDescription(offer)
      await pcHost.setRemoteDescription(offer)
      const answer = await pcHost.createAnswer()
      await pcHost.setLocalDescription(answer)
      await pcGuest.setRemoteDescription(answer)
    } catch { /* ignore */ }
  }

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
    guestClientTransport.tickKcp?.(performance.now())
  }, 16)

  netState.cleanupFns.push(() => {
    window.clearInterval(timer)
    try { pcGuest?.close() } catch { /* ignore */ }
    try { pcHost?.close() } catch { /* ignore */ }
  })
}

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
    netState.stateSync?.advance(dt, 1 / 60)
    const predictedSnap = netState.stateSync?.interpolated()
    if (predictedSnap) {
      applyAuthoritativeSnapshotToClientWorld(predictedSnap)
    }
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
      const st = slot.transport.getKcpStats?.()
      world.setPlayerLagMs(slot.playerId, featureFlags.lagCompensation && st ? st.srtt : 0)
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

let pendingHostEvents: WorldEvent[] = []
export function broadcastHostKcpSnapshot(events: WorldEvent[]): void {
  if (netState.role !== 'host' || netState.hostGuests.size === 0) {
    pendingHostEvents.length = 0
    return
  }
  if (events.length > 0) pendingHostEvents.push(...events)
  const guestCount = netState.hostGuests.size
  // 当开启 adaptiveNetAoi 时：多客机下自动按 30Hz/20Hz 步幅广播（有关键事件时立即发送），单客机同机测试保持满帧响应
  const stride = featureFlags.adaptiveNetAoi ? (guestCount >= 4 ? 3 : guestCount >= 2 ? 2 : 1) : 1
  const hasCriticalEvents = pendingHostEvents.length > 0
  if (!hasCriticalEvents && stride > 1 && (world.tick % stride !== 0)) return

  const outEvents = hasCriticalEvents ? [...pendingHostEvents] : []
  pendingHostEvents.length = 0

  const snap = world.snapshot()
  const ackSeqs: Record<number, number> = {}
  for (const slot of netState.hostGuests.values()) {
    ackSeqs[slot.playerId] = slot.lastAckSeq
  }
  snap.ackSeqs = ackSeqs
  const isKeyframe = hasCriticalEvents || (snap.tick % 30 === 0)

  if (featureFlags.adaptiveNetAoi) {
    for (const slot of netState.hostGuests.values()) {
      const aoiSnap = filterSnapshotAOI(snap, slot.playerId, 2800, 1800)
      if (!hasCriticalEvents && slot.transport.sendRawFrame) {
        const wire = encodeServerMsgBinary(
          { snap: aoiSnap, events: outEvents },
          { deltaFacilities: !isKeyframe, deltaProjectiles: !isKeyframe },
        )
        slot.transport.sendRawFrame(wire)
      } else {
        slot.transport.send({ snap: aoiSnap, events: outEvents })
      }
    }
    return
  }

  const sharedFrame = !hasCriticalEvents ? encodeServerWireFrame({ snap, events: outEvents }, true) : null
  for (const slot of netState.hostGuests.values()) {
    if (!hasCriticalEvents && sharedFrame && slot.transport.sendRawFrame) {
      slot.transport.sendRawFrame(sharedFrame)
    } else {
      slot.transport.send({ snap, events: outEvents })
    }
  }
}
