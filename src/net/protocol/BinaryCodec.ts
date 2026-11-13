// net/protocol/BinaryCodec.ts —— SkyBlast 2D 私有紧凑二进制协议 (SB2B / SB2C v3)
// 核心设计：
//   1. 定点数/半精度量化（位置 0.25px 精度 Uint16、速度 0.16px/s Int16、角度 1e-4 rad Int16、计时器 1ms Uint16）
//   2. 静态字典 + 增量设施同步（Delta Facilities）：据点、障碍物、补给箱、弹药包、迫击炮未变化时仅占 1 bit（0 字节负载），变化时才下发
//   3. 弹丸事件化增量同步（Event-Driven Projectiles）：直线/抛物线匀速弹丸只需在出生/反弹/销毁时同步起点与速度向量，飞行途中由客户端本地推算轨迹
//   4. 支持按连接隔离的 BinaryCodecSession（消除多客机 AOI 下全局增量签名互相污染），同时向下兼容默认会话
//   5. 支持 ackSeqs 序列号同步，支撑客户端预测与服务器回滚重放（Reconciliation）
import type { ClientMsg, ServerMsg } from '../transport/types.ts'
import type { WorldSnapshot, ScoreBoard } from '../../core/snap.ts'
import type {
  PlayerState, Projectile, Grenade, Landmine, Airstrike,
  Obstacle, CapturePoint, AmmoPack, SupplyCrate, Mortar, WorldEvent, TeamId,
} from '../../core/types.ts'
import type { Intent } from '../../input/intent.ts'
import { WEAPONS, SECONDARY_UNLOCK_ORDER } from '../../core/weapons.ts'
import { OBSTACLE_PRESETS } from '../../core/terrain.ts'
import { CP_INITS, SUPPLY_SPOTS, DOLL_SUPPLY_SPOTS, MORTARS_INIT, AMMO_SPOTS } from '../../core/sim/landmarks.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY, clamp } from '../../core/wrap.ts'
import { stepClientProjectilesDeadReckoning } from '../../core/sim/projectiles.ts'

// 魔数：'SB2S' (0x53423253) = ServerMsg，'SB2C' (0x53423243) = ClientMsg
const MAGIC_SERVER = 0x53423253
const MAGIC_CLIENT = 0x53423243
export const BINARY_STR_PREFIX = '\x00SB2:'

const TEAMS: TeamId[] = ['red', 'blue', 'green', 'ffa']
const TEAM_TO_IDX: Record<string, number> = { red: 0, blue: 1, green: 2, ffa: 3 }

const POS_X_SCALE = 4          // 0..13200 -> 0..52800 (Uint16, 0.25px 精度)
const INV_POS_X = 1 / POS_X_SCALE
const POS_Y_SCALE = 12         // 0..4400  -> 0..52800 (Uint16, 0.083px 精度)
const INV_POS_Y = 1 / POS_Y_SCALE
const VEL_SCALE = 6            // -5400..+5400 -> -32400..+32400 (Int16, 0.16px/s 精度)
const INV_VEL = 1 / VEL_SCALE
const AIM_SCALE = 10000        // -3.1416..+3.1416 -> -31416..+31416 (Int16, 0.0001rad 精度)
const INV_AIM = 1 / AIM_SCALE

function qPosX(x: number): number { return clamp(Math.round(wrapX(x) * POS_X_SCALE), 0, 65535) }
function uPosX(q: number): number { return q * INV_POS_X }
function qPosY(y: number): number { return clamp(Math.round(wrapY(y) * POS_Y_SCALE), 0, 65535) }
function uPosY(q: number): number { return q * INV_POS_Y }
function qVel(v: number): number { return clamp(Math.round(v * VEL_SCALE), -32767, 32767) }
function uVel(q: number): number { return q * INV_VEL }
function qAim(a: number): number { return clamp(Math.round(a * AIM_SCALE), -32767, 32767) }
function uAim(q: number): number { return q * INV_AIM }
function qTimerMs(t: number): number { return clamp(Math.round(Math.max(0, t) * 1000), 0, 65535) }
function uTimerMs(q: number): number { return q * 0.001 }

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// ── 静态字典构建辅助 ──
function buildDefaultCapturePointsDict(): CapturePoint[] {
  return CP_INITS.map(c => ({ ...c, progress: c.ownerTeam ? 100 : 0, capturingTeam: null }))
}
function buildDefaultSupplyCratesDict(): SupplyCrate[] {
  const crates: SupplyCrate[] = []
  let id = 1
  for (const s of SUPPLY_SPOTS) {
    const wid = s.weaponId ?? 4
    const w = WEAPONS[wid]
    crates.push({ id: id++, x: s.x, y: s.y, area: s.area, kind: 'weapon', weaponId: wid, weaponName: w.name, color: w.color, active: true, respawnTimer: 0 })
  }
  for (const s of DOLL_SUPPLY_SPOTS) {
    crates.push({ id: id++, x: s.x, y: s.y, area: s.area, kind: 'doll', weaponId: -1, weaponName: '🎎 替身人偶', color: '#f472b6', active: true, respawnTimer: 0 })
  }
  return crates
}
function buildDefaultMortarsDict(): Mortar[] {
  return MORTARS_INIT.map(m => ({ ...m, cooldown: 0, operatorId: null }))
}

/**
 * 按连接隔离的二进制编解码增量会话状态：
 * 在多客机 AOI 独立编码场景下，每个客户端连接持有独立的 BinaryCodecSession，
 * 避免第 1 个客机编码后更新全局签名导致第 2~N 个客机漏发设施变更、名字变更或弹丸全量包。
 */
export class BinaryCodecSession {
  staticDictCapturePoints: CapturePoint[] | null = buildDefaultCapturePointsDict()
  staticDictSupplyCrates: SupplyCrate[] | null = buildDefaultSupplyCratesDict()
  staticDictMortars: Mortar[] | null = buildDefaultMortarsDict()
  staticDictAmmoSpots = new Map<number, string>(AMMO_SPOTS.map(a => [a.x, a.area]))
  encodedPlayerNames = new Map<number, string>()
  decodedPlayerNames = new Map<number, string>()

  lastEncObsSig = ''
  lastEncCpSig = ''
  lastEncAmmoSig = ''
  lastEncCrateSig = ''
  lastEncMortarSig = ''

  lastDecObstacles: Obstacle[] = []
  lastDecCapturePoints: CapturePoint[] = []
  lastDecAmmoPacks: AmmoPack[] = []
  lastDecSupplyCrates: SupplyCrate[] = []
  lastDecMortars: Mortar[] = []

  encodedBallisticProjs = new Map<number, number>()
  decodedBallisticProjs = new Map<number, Projectile>()
  lastDecodedTick = 0

  reset(): void {
    this.staticDictCapturePoints = buildDefaultCapturePointsDict()
    this.staticDictSupplyCrates = buildDefaultSupplyCratesDict()
    this.staticDictMortars = buildDefaultMortarsDict()
    this.staticDictAmmoSpots.clear()
    for (const a of AMMO_SPOTS) this.staticDictAmmoSpots.set(a.x, a.area)
    this.encodedPlayerNames.clear()
    this.decodedPlayerNames.clear()
    this.lastEncObsSig = ''
    this.lastEncCpSig = ''
    this.lastEncAmmoSig = ''
    this.lastEncCrateSig = ''
    this.lastEncMortarSig = ''
    this.lastDecObstacles = []
    this.lastDecCapturePoints = []
    this.lastDecAmmoPacks = []
    this.lastDecSupplyCrates = []
    this.lastDecMortars = []
    this.encodedBallisticProjs.clear()
    this.decodedBallisticProjs.clear()
    this.lastDecodedTick = 0
  }
}

export function createBinaryCodecSession(): BinaryCodecSession {
  return new BinaryCodecSession()
}

const defaultCodecSession = new BinaryCodecSession()

export interface BinaryEncodeOptions {
  /** 开启低频地图设施（障碍物/据点/弹药包/补给箱/迫击炮）未变更帧零字节省流模式 */
  deltaFacilities?: boolean
  /** 开启直线/抛物线常规弹丸事件化省流模式（飞行途中不重复发完整弹丸包，由解码端按 dt 本地推算） */
  deltaProjectiles?: boolean
  /** 客户端推算弹丸轨迹的帧间隔（默认 1/60） */
  dt?: number
  /** 按连接隔离的增量会话状态（省略时使用默认共享会话） */
  session?: BinaryCodecSession
}

class ByteWriter {
  buf: Uint8Array
  view: DataView
  offset = 0

  constructor(initialCapacity = 32768) {
    this.buf = new Uint8Array(initialCapacity)
    this.view = new DataView(this.buf.buffer)
  }

  reset(): void {
    this.offset = 0
  }

  ensure(extra: number): void {
    if (this.offset + extra <= this.buf.length) return
    let nextCap = this.buf.length * 2
    while (nextCap < this.offset + extra) nextCap *= 2
    const next = new Uint8Array(nextCap)
    next.set(this.buf.subarray(0, this.offset))
    this.buf = next
    this.view = new DataView(this.buf.buffer)
  }

  u8(v: number): void {
    this.buf[this.offset++] = v & 0xff
  }

  i8(v: number): void {
    this.view.setInt8(this.offset++, v)
  }

  u16(v: number): void {
    this.view.setUint16(this.offset, v & 0xffff, true)
    this.offset += 2
  }

  i16(v: number): void {
    this.view.setInt16(this.offset, v, true)
    this.offset += 2
  }

  u32(v: number): void {
    this.view.setUint32(this.offset, v >>> 0, true)
    this.offset += 4
  }

  i32(v: number): void {
    this.view.setInt32(this.offset, v | 0, true)
    this.offset += 4
  }

  f32(v: number): void {
    this.view.setFloat32(this.offset, v, true)
    this.offset += 4
  }

  f64(v: number): void {
    this.view.setFloat64(this.offset, v, true)
    this.offset += 8
  }

  str(s: string): void {
    if (!s) {
      this.ensure(2)
      this.u16(0)
      return
    }
    const n = s.length
    let isAscii = n <= 64
    if (isAscii) {
      for (let i = 0; i < n; i++) {
        if (s.charCodeAt(i) > 0x7f) { isAscii = false; break }
      }
    }
    if (isAscii) {
      this.ensure(2 + n)
      this.view.setUint16(this.offset, n, true)
      this.offset += 2
      for (let i = 0; i < n; i++) this.buf[this.offset + i] = s.charCodeAt(i)
      this.offset += n
      return
    }
    const bytes = textEncoder.encode(s)
    this.ensure(2 + bytes.length)
    this.view.setUint16(this.offset, bytes.length, true)
    this.offset += 2
    this.buf.set(bytes, this.offset)
    this.offset += bytes.length
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.offset)
  }
}

class ByteReader {
  private buf: Uint8Array
  private view: DataView
  offset = 0

  constructor(bytes: Uint8Array) {
    this.buf = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8(): number {
    if (this.offset + 1 > this.buf.byteLength) return 0
    return this.buf[this.offset++]
  }

  i8(): number {
    if (this.offset + 1 > this.buf.byteLength) return 0
    return this.view.getInt8(this.offset++)
  }

  u16(): number {
    if (this.offset + 2 > this.buf.byteLength) { this.offset = this.buf.byteLength; return 0 }
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  i16(): number {
    if (this.offset + 2 > this.buf.byteLength) { this.offset = this.buf.byteLength; return 0 }
    const v = this.view.getInt16(this.offset, true)
    this.offset += 2
    return v
  }

  u32(): number {
    if (this.offset + 4 > this.buf.byteLength) { this.offset = this.buf.byteLength; return 0 }
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  i32(): number {
    if (this.offset + 4 > this.buf.byteLength) { this.offset = this.buf.byteLength; return 0 }
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  f32(): number {
    if (this.offset + 4 > this.buf.byteLength) { this.offset = this.buf.byteLength; return 0 }
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  f64(): number {
    if (this.offset + 8 > this.buf.byteLength) { this.offset = this.buf.byteLength; return 0 }
    const v = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return v
  }

  str(): string {
    const len = this.u16()
    if (len === 0) return ''
    const start = this.offset
    const end = Math.min(this.buf.byteLength, start + len)
    this.offset = end
    if (len <= 64) {
      let ascii = ''
      for (let i = start; i < end; i++) {
        const c = this.buf[i]
        if (c > 0x7f) return textDecoder.decode(this.buf.subarray(start, end))
        ascii += String.fromCharCode(c)
      }
      return ascii
    }
    return textDecoder.decode(this.buf.subarray(start, end))
  }
}

const sharedServerWriter = new ByteWriter(32768)
const sharedClientWriter = new ByteWriter(512)

export function resetBinaryCodecState(session: BinaryCodecSession = defaultCodecSession): void {
  session.reset()
}

// ── ServerMsg 二进制编码 ──────────────────────────────────────────────
export function encodeServerMsgBinary(msg: ServerMsg, opts: BinaryEncodeOptions = {}): Uint8Array {
  const sess = opts.session ?? defaultCodecSession
  const w = sharedServerWriter
  w.reset()
  w.ensure(64)
  w.u32(MAGIC_SERVER)

  const hasEvents = !!(msg.events && msg.events.length > 0)
  const hasWelcome = !!msg.welcome
  if (hasWelcome || (msg.snap.tick % 60 === 0)) sess.encodedPlayerNames.clear()
  const hasAckSeqs = !!(msg.snap.ackSeqs && Object.keys(msg.snap.ackSeqs).length > 0)
  const hdrFlags =
    1 |
    (hasEvents ? 2 : 0) |
    (hasWelcome ? 4 : 0) |
    (hasAckSeqs ? 8 : 0) |
    (opts.deltaFacilities ? 16 : 0) |
    (opts.deltaProjectiles ? 32 : 0)
  w.u8(hdrFlags)

  encodeSnapshot(w, msg.snap, opts, sess)

  if (hasEvents && msg.events) {
    w.ensure(4)
    w.u16(msg.events.length)
    for (let i = 0; i < msg.events.length; i++) {
      encodeWorldEvent(w, msg.events[i])
    }
  }

  if (hasWelcome && msg.welcome) {
    w.ensure(16)
    w.u16(msg.welcome.playerId)
    w.str(msg.welcome.name)
    w.str(msg.welcome.team)
  }

  if (hasAckSeqs && msg.snap.ackSeqs) {
    const entries = Object.entries(msg.snap.ackSeqs)
    w.ensure(2 + entries.length * 6)
    w.u16(entries.length)
    for (let i = 0; i < entries.length; i++) {
      w.u16(Number(entries[i][0]))
      w.u32(entries[i][1])
    }
  }

  return w.finish()
}

export function decodeServerMsgBinary(bytes: Uint8Array, session: BinaryCodecSession = defaultCodecSession): ServerMsg | null {
  if (bytes.byteLength < 5) return null
  const r = new ByteReader(bytes)
  const magic = r.u32()
  if (magic !== MAGIC_SERVER) return null
  const hdrFlags = r.u8()

  const snap = decodeSnapshot(r, !!(hdrFlags & 16), !!(hdrFlags & 32), session)
  const out: ServerMsg = { snap }

  if (hdrFlags & 2) {
    const evCount = r.u16()
    const events: WorldEvent[] = new Array(evCount)
    for (let i = 0; i < evCount; i++) {
      events[i] = decodeWorldEvent(r)
    }
    out.events = events
  }

  if (hdrFlags & 4) {
    const playerId = r.u16()
    const name = r.str()
    const team = r.str()
    out.welcome = { playerId, name, team }
  }

  if (hdrFlags & 8) {
    const ackCount = r.u16()
    const ackSeqs: Record<number, number> = {}
    for (let i = 0; i < ackCount; i++) {
      const pid = r.u16()
      const seq = r.u32()
      ackSeqs[pid] = seq
    }
    snap.ackSeqs = ackSeqs
  }

  return out
}

function encodeSnapshot(w: ByteWriter, s: WorldSnapshot, opts: BinaryEncodeOptions, sess: BinaryCodecSession): void {
  w.ensure(32)
  w.u32(s.tick)
  w.i32(s.seed)

  // Scores (8B)
  w.u16(s.scores.red ?? 0)
  w.u16(s.scores.blue ?? 0)
  w.u16(s.scores.green ?? 0)
  w.u16(s.scores.ffa ?? 0)

  // Players (~25B/人)
  w.u16(s.players.length)
  for (let i = 0; i < s.players.length; i++) {
    encodePlayer(w, s.players[i], sess)
  }

  // Projectiles（支持全量模式与事件化增量模式）
  if (!opts.deltaProjectiles) {
    w.ensure(4)
    w.u16(s.projectiles.length)
    for (let i = 0; i < s.projectiles.length; i++) {
      encodeProjectile(w, s.projectiles[i])
    }
  } else {
    // 弹丸事件化增量模式：
    // 若场上有引力弹，则所有弹丸受非线性力场影响需同步；
    // 否则对于已同步过（id 与 bounces 未变）的直线/抛物线常规弹丸，仅下发 2B 存活 ID，由客户端本地推算轨迹！
    const hasGravityOrb = s.projectiles.some(pr => pr.isGravityOrb && pr.life > 0)
    const fullSend: Projectile[] = []
    const deadReckonedIds: number[] = []
    const currentAliveIds = new Set<number>()

    for (let i = 0; i < s.projectiles.length; i++) {
      const pr = s.projectiles[i]
      currentAliveIds.add(pr.id)
      const prevBounces = sess.encodedBallisticProjs.get(pr.id)
      if (!hasGravityOrb && !pr.isGravityOrb && prevBounces === pr.bounces) {
        deadReckonedIds.push(pr.id)
      } else {
        fullSend.push(pr)
        sess.encodedBallisticProjs.set(pr.id, pr.bounces)
      }
    }
    for (const oldId of sess.encodedBallisticProjs.keys()) {
      if (!currentAliveIds.has(oldId)) sess.encodedBallisticProjs.delete(oldId)
    }

    w.ensure(6 + deadReckonedIds.length * 2)
    w.u16(fullSend.length)
    for (let i = 0; i < fullSend.length; i++) {
      encodeProjectile(w, fullSend[i])
    }
    w.ensure(4 + deadReckonedIds.length * 2)
    w.u16(deadReckonedIds.length)
    for (let i = 0; i < deadReckonedIds.length; i++) {
      w.u16(deadReckonedIds[i] & 0xffff)
    }
  }

  // Grenades (17B/枚)
  w.ensure(4 + s.grenades.length * 18)
  w.u16(s.grenades.length)
  for (let i = 0; i < s.grenades.length; i++) {
    const g = s.grenades[i]
    w.u32(g.id)
    w.u16(g.owner)
    w.u16(qPosX(g.pos.x))
    w.u16(qPosY(g.pos.y))
    w.i16(qVel(g.vel.x))
    w.i16(qVel(g.vel.y))
    w.u16(qTimerMs(g.fuse))
    w.u8(g.bounces)
  }

  // Landmines (19B/枚)
  w.ensure(4 + s.landmines.length * 20)
  w.u16(s.landmines.length)
  for (let i = 0; i < s.landmines.length; i++) {
    const m = s.landmines[i]
    w.i16(m.id)
    w.u16(m.owner)
    w.u16(qPosX(m.pos.x))
    w.u16(qPosY(m.pos.y))
    w.i16(qVel(m.vel.x))
    w.i16(qVel(m.vel.y))
    const mf = (m.armed ? 1 : 0) | (m.triggered ? 2 : 0) | (m.instant ? 4 : 0) | (m.directHit ? 8 : 0) | (m.preset ? 16 : 0)
    w.u8(mf)
    w.u16(qTimerMs(m.armTimer))
    w.u16(qTimerMs(m.fuse))
    w.u16(qTimerMs(m.respawnTimer))
  }

  // Airstrikes (13B/次)
  w.ensure(4 + s.airstrikes.length * 14)
  w.u16(s.airstrikes.length)
  for (let i = 0; i < s.airstrikes.length; i++) {
    const a = s.airstrikes[i]
    w.u32(a.id)
    w.u16(a.owner)
    w.u16(qPosX(a.pos.x))
    w.u16(qPosY(a.pos.y))
    w.i16(Math.round(a.timer * 1000))
    w.u8(a.dropped ? 1 : 0)
  }

  // ── 地图低频设施：支持按状态变更增量下发（未变更时 0 字节） ──
  let facilityMask = 0x1f // 默认全量 5 类设施 (bits 0..4)
  if (opts.deltaFacilities) {
    const obsSig = s.obstacles.map(o => `${o.id}:${o.hp}`).join('|')
    const cpSig = s.capturePoints.map(c => `${c.ownerTeam}:${Math.round(c.progress)}:${c.capturingTeam}`).join('|')
    const ammoSig = s.ammoPacks.map(a => a.id).join('|')
    const crateSig = s.supplyCrates.map(c => `${c.id}:${c.active ? 1 : 0}:${c.weaponId}`).join('|')
    const mortarSig = s.mortars.map(m => `${m.operatorId}:${qAim(m.angle)}:${m.cooldown > 0 ? 1 : 0}`).join('|')

    facilityMask =
      (obsSig !== sess.lastEncObsSig ? 1 : 0) |
      (cpSig !== sess.lastEncCpSig ? 2 : 0) |
      (ammoSig !== sess.lastEncAmmoSig ? 4 : 0) |
      (crateSig !== sess.lastEncCrateSig ? 8 : 0) |
      (mortarSig !== sess.lastEncMortarSig ? 16 : 0)

    sess.lastEncObsSig = obsSig
    sess.lastEncCpSig = cpSig
    sess.lastEncAmmoSig = ammoSig
    sess.lastEncCrateSig = crateSig
    sess.lastEncMortarSig = mortarSig
    w.ensure(2)
    w.u8(facilityMask)
  }

  // 1. Obstacles
  if (facilityMask & 1) {
    w.ensure(4)
    w.u16(s.obstacles.length)
    for (let i = 0; i < s.obstacles.length; i++) {
      const ob = s.obstacles[i]
      const presetIdx = OBSTACLE_PRESETS.findIndex(p => p.id === ob.id)
      if (presetIdx >= 0 && OBSTACLE_PRESETS[presetIdx].x === ob.x && OBSTACLE_PRESETS[presetIdx].y === ob.y) {
        w.ensure(6)
        w.u8(1)
        w.u8(presetIdx)
        w.i16(ob.hp)
        w.i16(ob.maxHp)
      } else {
        w.ensure(24)
        w.u8(0)
        w.str(ob.id)
        w.f32(ob.x); w.f32(ob.y); w.f32(ob.w); w.f32(ob.h)
        w.i16(ob.hp); w.i16(ob.maxHp)
        w.str(ob.label); w.str(ob.color); w.str(ob.borderColor)
      }
    }
  }

  // 2. CapturePoints
  if (facilityMask & 2) {
    if (!sess.staticDictCapturePoints && s.capturePoints.length > 0) {
      sess.staticDictCapturePoints = s.capturePoints.map(c => ({ ...c }))
    }
    const canFastCp =
      sess.staticDictCapturePoints !== null &&
      sess.staticDictCapturePoints.length === s.capturePoints.length &&
      s.capturePoints.every((c, idx) => c.id === sess.staticDictCapturePoints![idx].id && c.x === sess.staticDictCapturePoints![idx].x)

    w.ensure(2 + s.capturePoints.length * 16)
    w.u8(s.capturePoints.length)
    w.u8(canFastCp ? 1 : 0)
    for (let i = 0; i < s.capturePoints.length; i++) {
      const cp = s.capturePoints[i]
      if (!canFastCp) {
        w.str(cp.id); w.str(cp.code); w.str(cp.name)
        w.ensure(14)
        w.f32(cp.x); w.f32(cp.y)
      }
      w.ensure(6)
      w.i8(cp.ownerTeam ? (TEAM_TO_IDX[cp.ownerTeam] ?? -1) : -1)
      w.u16(clamp(Math.round(cp.progress * 100), 0, 10000))
      w.i8(cp.capturingTeam ? (TEAM_TO_IDX[cp.capturingTeam] ?? -1) : -1)
    }
  }

  // 3. AmmoPacks
  if (facilityMask & 4) {
    w.ensure(2)
    w.u8(s.ammoPacks.length)
    for (let i = 0; i < s.ammoPacks.length; i++) {
      const a = s.ammoPacks[i]
      const knownArea = sess.staticDictAmmoSpots.get(a.x) === a.area
      w.ensure(12)
      w.u16(a.id)
      w.u16(qPosX(a.x))
      w.u16(qPosY(a.y))
      if (knownArea) {
        w.u8(1)
      } else {
        sess.staticDictAmmoSpots.set(a.x, a.area)
        w.u8(0)
        w.str(a.area)
      }
    }
  }

  // 4. SupplyCrates
  if (facilityMask & 8) {
    if (!sess.staticDictSupplyCrates && s.supplyCrates.length > 0) {
      sess.staticDictSupplyCrates = s.supplyCrates.map(c => ({ ...c }))
    }
    const canFastCrate =
      sess.staticDictSupplyCrates !== null &&
      sess.staticDictSupplyCrates.length === s.supplyCrates.length &&
      s.supplyCrates.every((c, idx) => c.x === sess.staticDictSupplyCrates![idx].x && c.kind === sess.staticDictSupplyCrates![idx].kind)

    w.ensure(4 + s.supplyCrates.length * 8)
    w.u8(s.supplyCrates.length)
    w.u8(canFastCrate ? 1 : 0)
    for (let i = 0; i < s.supplyCrates.length; i++) {
      const c = s.supplyCrates[i]
      if (canFastCrate) {
        w.ensure(6)
        w.u16(c.id)
        w.i8(c.weaponId)
        w.u8(c.active ? 1 : 0)
        w.u16(qTimerMs(c.respawnTimer))
      } else {
        w.ensure(16)
        w.u16(c.id)
        w.f32(c.x); w.f32(c.y)
        w.str(c.area)
        w.ensure(8)
        w.u8(c.kind === 'doll' ? 1 : 0)
        w.i8(c.weaponId)
        w.str(c.weaponName)
        w.str(c.color)
        w.ensure(6)
        w.u8(c.active ? 1 : 0)
        w.u16(qTimerMs(c.respawnTimer))
      }
    }
  }

  // 5. Mortars
  if (facilityMask & 16) {
    if (!sess.staticDictMortars && s.mortars.length > 0) {
      sess.staticDictMortars = s.mortars.map(m => ({ ...m }))
    }
    const canFastMortar =
      sess.staticDictMortars !== null &&
      sess.staticDictMortars.length === s.mortars.length &&
      s.mortars.every((m, idx) => m.id === sess.staticDictMortars![idx].id && m.x === sess.staticDictMortars![idx].x)

    w.ensure(4 + s.mortars.length * 8)
    w.u8(s.mortars.length)
    w.u8(canFastMortar ? 1 : 0)
    for (let i = 0; i < s.mortars.length; i++) {
      const m = s.mortars[i]
      if (!canFastMortar) {
        w.str(m.id); w.str(m.name)
        w.ensure(12)
        w.f32(m.x); w.f32(m.y); w.f32(m.power)
      }
      w.ensure(6)
      w.i16(qAim(m.angle))
      w.u16(qTimerMs(m.cooldown))
      w.i16(m.operatorId ?? -1)
    }
  }
}

function decodeSnapshot(r: ByteReader, isDeltaFacilities: boolean, isDeltaProjectiles: boolean, sess: BinaryCodecSession): WorldSnapshot {
  const tick = r.u32()
  const seed = r.i32()
  const scores: ScoreBoard = {
    red: r.u16(),
    blue: r.u16(),
    green: r.u16(),
    ffa: r.u16(),
  }

  const pCount = r.u16()
  const players: PlayerState[] = new Array(pCount)
  for (let i = 0; i < pCount; i++) players[i] = decodePlayer(r, sess)

  let projectiles: Projectile[]
  if (!isDeltaProjectiles) {
    sess.decodedBallisticProjs.clear()
    const prjCount = r.u16()
    projectiles = new Array(prjCount)
    for (let i = 0; i < prjCount; i++) {
      const pr = decodeProjectile(r)
      projectiles[i] = pr
      sess.decodedBallisticProjs.set(pr.id & 0xffff, pr)
    }
  } else {
    const dtTicks = sess.lastDecodedTick > 0 && tick > sess.lastDecodedTick ? (tick - sess.lastDecodedTick) : 1
    const activeShortIds = new Set<number>()
    const fullCount = r.u16()
    const freshProjs: Projectile[] = new Array(fullCount)
    for (let i = 0; i < fullCount; i++) {
      const pr = decodeProjectile(r)
      freshProjs[i] = pr
      const sid = pr.id & 0xffff
      activeShortIds.add(sid)
      sess.decodedBallisticProjs.set(sid, pr)
    }
    const keptCount = r.u16()
    const keptProjs: Projectile[] = []
    for (let i = 0; i < keptCount; i++) {
      const shortId = r.u16()
      activeShortIds.add(shortId)
      const cached = sess.decodedBallisticProjs.get(shortId)
      if (cached) {
        stepClientProjectilesDeadReckoning([cached], (1 / 60) * dtTicks)
        keptProjs.push({
          ...cached,
          pos: { x: cached.pos.x, y: cached.pos.y },
          vel: { x: cached.vel.x, y: cached.vel.y },
          hitTargets: [...cached.hitTargets],
        })
      }
    }
    for (const oldKey of sess.decodedBallisticProjs.keys()) {
      if (!activeShortIds.has(oldKey)) sess.decodedBallisticProjs.delete(oldKey)
    }
    projectiles = [...freshProjs, ...keptProjs]
  }
  sess.lastDecodedTick = tick

  const gCount = r.u16()
  const grenades: Grenade[] = new Array(gCount)
  for (let i = 0; i < gCount; i++) {
    grenades[i] = {
      id: r.u32(),
      owner: r.u16(),
      pos: { x: uPosX(r.u16()), y: uPosY(r.u16()) },
      vel: { x: uVel(r.i16()), y: uVel(r.i16()) },
      fuse: uTimerMs(r.u16()),
      bounces: r.u8(),
    }
  }

  const mCount = r.u16()
  const landmines: Landmine[] = new Array(mCount)
  for (let i = 0; i < mCount; i++) {
    const id = r.i16()
    const owner = r.u16()
    const px = uPosX(r.u16())
    const py = uPosY(r.u16())
    const vx = uVel(r.i16())
    const vy = uVel(r.i16())
    const mf = r.u8()
    landmines[i] = {
      id, owner,
      pos: { x: px, y: py },
      vel: { x: vx, y: vy },
      armed: !!(mf & 1),
      triggered: !!(mf & 2),
      instant: !!(mf & 4),
      directHit: !!(mf & 8),
      preset: !!(mf & 16),
      armTimer: uTimerMs(r.u16()),
      fuse: uTimerMs(r.u16()),
      respawnTimer: uTimerMs(r.u16()),
    }
  }

  const aCount = r.u16()
  const airstrikes: Airstrike[] = new Array(aCount)
  for (let i = 0; i < aCount; i++) {
    airstrikes[i] = {
      id: r.u32(),
      owner: r.u16(),
      pos: { x: uPosX(r.u16()), y: uPosY(r.u16()) },
      timer: r.i16() * 0.001,
      dropped: r.u8() !== 0,
    }
  }

  const facilityMask = isDeltaFacilities ? r.u8() : 0x1f

  // 1. Obstacles
  let obstacles: Obstacle[]
  if (facilityMask & 1) {
    const oCount = r.u16()
    obstacles = new Array(oCount)
    for (let i = 0; i < oCount; i++) {
      const isPreset = r.u8() === 1
      if (isPreset) {
        const idx = r.u8()
        const hp = r.i16()
        const maxHp = r.i16()
        const p = OBSTACLE_PRESETS[idx]
        obstacles[i] = { ...p, hp, maxHp }
      } else {
        obstacles[i] = {
          id: r.str(),
          x: r.f32(), y: r.f32(), w: r.f32(), h: r.f32(),
          hp: r.i16(), maxHp: r.i16(),
          label: r.str(), color: r.str(), borderColor: r.str(),
        }
      }
    }
    sess.lastDecObstacles = obstacles.map(o => ({ ...o }))
  } else {
    obstacles = sess.lastDecObstacles.map(o => ({ ...o }))
  }

  // 2. CapturePoints
  let capturePoints: CapturePoint[]
  if (facilityMask & 2) {
    const cpCount = r.u8()
    const isFastCp = r.u8() === 1
    capturePoints = new Array(cpCount)
    for (let i = 0; i < cpCount; i++) {
      let id: string, code: string, name: string, x: number, y: number
      if (isFastCp && sess.staticDictCapturePoints && sess.staticDictCapturePoints[i]) {
        const tpl = sess.staticDictCapturePoints[i]
        id = tpl.id; code = tpl.code; name = tpl.name; x = tpl.x; y = tpl.y
      } else {
        id = r.str(); code = r.str(); name = r.str()
        x = r.f32(); y = r.f32()
      }
      const ownIdx = r.i8()
      const progress = r.u16() * 0.01
      const capIdx = r.i8()
      capturePoints[i] = {
        id, code, name, x, y,
        ownerTeam: ownIdx >= 0 ? TEAMS[ownIdx] : null,
        progress,
        capturingTeam: capIdx >= 0 ? TEAMS[capIdx] : null,
      }
    }
    if (!sess.staticDictCapturePoints && capturePoints.length > 0) {
      sess.staticDictCapturePoints = capturePoints.map(c => ({ ...c }))
    }
    sess.lastDecCapturePoints = capturePoints.map(c => ({ ...c }))
  } else {
    capturePoints = sess.lastDecCapturePoints.map(c => ({ ...c }))
  }

  // 3. AmmoPacks
  let ammoPacks: AmmoPack[]
  if (facilityMask & 4) {
    const amCount = r.u8()
    ammoPacks = new Array(amCount)
    for (let i = 0; i < amCount; i++) {
      const id = r.u16()
      const x = Math.round(uPosX(r.u16()))
      const y = Math.round(uPosY(r.u16()))
      const isKnown = r.u8() === 1
      let area = ''
      if (isKnown) {
        area = sess.staticDictAmmoSpots.get(x) ?? ''
      } else {
        area = r.str()
        sess.staticDictAmmoSpots.set(x, area)
      }
      ammoPacks[i] = { id, x, y, area }
    }
    sess.lastDecAmmoPacks = ammoPacks.map(a => ({ ...a }))
  } else {
    ammoPacks = sess.lastDecAmmoPacks.map(a => ({ ...a }))
  }

  // 4. SupplyCrates
  let supplyCrates: SupplyCrate[]
  if (facilityMask & 8) {
    const scCount = r.u8()
    const isFastCrate = r.u8() === 1
    supplyCrates = new Array(scCount)
    for (let i = 0; i < scCount; i++) {
      if (isFastCrate && sess.staticDictSupplyCrates && sess.staticDictSupplyCrates[i]) {
        const tpl = sess.staticDictSupplyCrates[i]
        const id = r.u16()
        const weaponId = r.i8()
        const active = r.u8() !== 0
        const respawnTimer = uTimerMs(r.u16())
        const w = weaponId >= 0 ? WEAPONS[weaponId] : null
        supplyCrates[i] = {
          ...tpl,
          id,
          weaponId,
          weaponName: w ? w.name : tpl.weaponName,
          color: w ? w.color : tpl.color,
          active,
          respawnTimer,
        }
      } else {
        supplyCrates[i] = {
          id: r.u16(),
          x: r.f32(), y: r.f32(),
          area: r.str(),
          kind: r.u8() === 1 ? 'doll' : 'weapon',
          weaponId: r.i8(),
          weaponName: r.str(),
          color: r.str(),
          active: r.u8() !== 0,
          respawnTimer: uTimerMs(r.u16()),
        }
      }
    }
    if (!sess.staticDictSupplyCrates && supplyCrates.length > 0) {
      sess.staticDictSupplyCrates = supplyCrates.map(c => ({ ...c }))
    }
    sess.lastDecSupplyCrates = supplyCrates.map(c => ({ ...c }))
  } else {
    supplyCrates = sess.lastDecSupplyCrates.map(c => ({ ...c }))
  }

  // 5. Mortars
  let mortars: Mortar[]
  if (facilityMask & 16) {
    const mtCount = r.u8()
    const isFastMortar = r.u8() === 1
    mortars = new Array(mtCount)
    for (let i = 0; i < mtCount; i++) {
      let id: string, name: string, x: number, y: number, power: number
      if (isFastMortar && sess.staticDictMortars && sess.staticDictMortars[i]) {
        const tpl = sess.staticDictMortars[i]
        id = tpl.id; name = tpl.name; x = tpl.x; y = tpl.y; power = tpl.power
      } else {
        id = r.str(); name = r.str()
        x = r.f32(); y = r.f32(); power = r.f32()
      }
      const angle = uAim(r.i16())
      const cooldown = uTimerMs(r.u16())
      const op = r.i16()
      mortars[i] = { id, name, x, y, angle, power, cooldown, operatorId: op >= 0 ? op : null }
    }
    if (!sess.staticDictMortars && mortars.length > 0) {
      sess.staticDictMortars = mortars.map(m => ({ ...m }))
    }
    sess.lastDecMortars = mortars.map(m => ({ ...m }))
  } else {
    mortars = sess.lastDecMortars.map(m => ({ ...m }))
  }

  return {
    tick, seed, players, projectiles, grenades, landmines, airstrikes,
    obstacles, capturePoints, ammoPacks, supplyCrates, mortars, scores,
  }
}

function encodePlayer(w: ByteWriter, p: PlayerState, sess: BinaryCodecSession): void {
  w.ensure(48)
  w.u16(p.id)
  w.u16(qPosX(p.pos.x))
  w.u16(qPosY(p.pos.y))
  w.i16(qVel(p.vel.x))
  w.i16(qVel(p.vel.y))
  w.i16(qAim(p.aim))

  const teamIdx = TEAM_TO_IDX[p.team] ?? 3
  const bitFlags =
    (teamIdx & 3) |
    (p.alive ? 4 : 0) |
    (p.deployed ? 8 : 0) |
    (p.onGround ? 16 : 0) |
    (p.jetpack ? 32 : 0) |
    (p.reloading ? 64 : 0) |
    (p.doll ? 128 : 0)
  w.u8(bitFlags)

  const secIdx = Math.max(0, SECONDARY_UNLOCK_ORDER.indexOf(p.secondary as (typeof SECONDARY_UNLOCK_ORDER)[number]))
  const hasCustomSpawn = Boolean(p.selectedSpawnId && p.selectedSpawnId !== 'base')
  const wepAndSec = (p.weaponIndex & 0x0f) | ((hasCustomSpawn ? 1 : 0) << 4) | ((p.fragCharges & 0x07) << 5)
  w.u8(wepAndSec)
  if (hasCustomSpawn) w.str(p.selectedSpawnId!)

  w.i16(clamp(Math.round(p.hp * 10), -32767, 32767))
  w.u16(p.maxHp)
  w.u16(clamp(Math.round(p.fuel * 1000), 0, 65535))
  w.u16(p.kills)
  w.u16(p.deaths)
  const hasRecoilVel = Boolean(p.recoilVel && (Math.abs(p.recoilVel.x) > 0.5 || Math.abs(p.recoilVel.y) > 0.5))
  const hasDiffLastPrimary = Boolean(p.lastPrimaryIndex !== undefined && p.lastPrimaryIndex !== p.weaponIndex)
  const dollAndSec =
    (clamp(p.dollCharges, 0, 7) & 0x07) |
    ((secIdx & 0x07) << 3) |
    (hasRecoilVel ? 64 : 0) |
    (hasDiffLastPrimary ? 128 : 0)
  w.u8(dollAndSec)
  w.u8(clamp(p.deathStreak ?? 0, 0, 255))
  if (sess.encodedPlayerNames.get(p.id) === p.name) {
    w.u8(1)
  } else {
    sess.encodedPlayerNames.set(p.id, p.name)
    w.u8(0)
    w.str(p.name)
  }

  w.ensure(64)
  const wi = p.weaponIndex
  w.u16(clamp(Math.round((p.ammo[wi] ?? 0) * 100), 0, 65535))
  w.u16(p.reserveAmmo[wi] ?? 0)

  let otherAmmoModified = false
  for (let i = 0; i < WEAPONS.length; i++) {
    if (i === wi) continue
    if (p.ammo[i] !== WEAPONS[i].magSize || p.reserveAmmo[i] !== WEAPONS[i].maxReserve) {
      otherAmmoModified = true
      break
    }
  }

  const timerMask =
    (otherAmmoModified ? 1 : 0) |
    (p.reloadTimer > 0 ? 2 : 0) |
    (p.fireCooldown > 0 ? 4 : 0) |
    (p.chargeTimer > 0 ? 8 : 0) |
    (p.secondaryCooldown > 0 ? 16 : 0) |
    (p.fragRechargeTimer > 0 ? 32 : 0) |
    (p.shieldTimer > 0 || p.shieldHp > 0 ? 64 : 0) |
    (p.respawnTimer > 0 || p.warpCooldown > 0 || p.mountedTowerId !== null || p.watchtowerTimer > 0 || (p.teleportTimer ?? 0) > 0 ? 128 : 0)
  w.u8(timerMask)

  if (timerMask & 1) {
    w.ensure(2 + p.ammo.length * 4)
    w.u8(p.ammo.length)
    for (let i = 0; i < p.ammo.length; i++) {
      w.u16(clamp(Math.round(p.ammo[i] * 100), 0, 65535))
      w.u16(p.reserveAmmo[i])
    }
  }
  if (timerMask & 2) w.u16(qTimerMs(p.reloadTimer))
  if (timerMask & 4) w.u16(qTimerMs(p.fireCooldown))
  if (timerMask & 8) {
    w.u16(qTimerMs(p.chargeTimer))
    w.i16(qAim(p.chargeAim ?? p.aim))
  }
  if (timerMask & 16) w.u16(qTimerMs(p.secondaryCooldown))
  if (timerMask & 32) w.u16(qTimerMs(p.fragRechargeTimer))
  if (timerMask & 64) {
    w.u16(clamp(Math.round(p.shieldHp * 10), 0, 65535))
    w.u16(qTimerMs(p.shieldTimer))
  }
  if (timerMask & 128) {
    w.u16(qTimerMs(p.respawnTimer))
    w.u16(qTimerMs(p.warpCooldown))
    w.u16(qTimerMs(p.watchtowerTimer))
    w.str(p.mountedTowerId ?? '')
    const tpActive = (p.teleportTimer ?? 0) > 0 && p.teleportTarget ? 1 : 0
    w.u8(tpActive)
    if (tpActive && p.teleportTarget) {
      w.u16(qTimerMs(p.teleportTimer ?? 0))
      w.u16(qPosX(p.teleportTarget.x))
      w.u16(qPosY(p.teleportTarget.y))
    }
  }

  if (hasRecoilVel && p.recoilVel) {
    w.ensure(4)
    w.i16(qVel(p.recoilVel.x))
    w.i16(qVel(p.recoilVel.y))
  }
  if (hasDiffLastPrimary) {
    w.ensure(1)
    w.u8((p.lastPrimaryIndex ?? p.weaponIndex) & 0x0f)
  }

  if (p.doll) {
    w.ensure(32 + p.doll.ammo.length * 4)
    w.u16(qPosX(p.doll.pos.x))
    w.u16(qPosY(p.doll.pos.y))
    w.i16(clamp(Math.round(p.doll.hp * 10), -32767, 32767))
    w.u16(clamp(Math.round(p.doll.shieldHp * 10), 0, 65535))
    w.u16(clamp(Math.round(p.doll.fuel * 1000), 0, 65535))
    w.u8(p.doll.weaponIndex)
    w.u16(qTimerMs(p.doll.timer))
    w.u8(p.doll.ammo.length)
    for (let i = 0; i < p.doll.ammo.length; i++) {
      w.u16(clamp(Math.round(p.doll.ammo[i] * 100), 0, 65535))
      w.u16(p.doll.reserveAmmo[i])
    }
  }
}

function decodePlayer(r: ByteReader, sess: BinaryCodecSession): PlayerState {
  const id = r.u16()
  const px = uPosX(r.u16())
  const py = uPosY(r.u16())
  const vx = uVel(r.i16())
  const vy = uVel(r.i16())
  const aim = uAim(r.i16())
  const bitFlags = r.u8()
  const wepAndSec = r.u8()

  const team = TEAMS[bitFlags & 3] ?? 'ffa'
  const alive = !!(bitFlags & 4)
  const deployed = !!(bitFlags & 8)
  const onGround = !!(bitFlags & 16)
  const jetpack = !!(bitFlags & 32)
  const reloading = !!(bitFlags & 64)
  const hasDoll = !!(bitFlags & 128)

  const weaponIndex = wepAndSec & 0x0f
  const hasCustomSpawn = !!(wepAndSec & 0x10)
  const fragCharges = (wepAndSec >> 5) & 0x07
  const selectedSpawnId = hasCustomSpawn ? r.str() : 'base'

  const hp = r.i16() * 0.1
  const maxHp = r.u16()
  const fuel = r.u16() * 0.001
  const kills = r.u16()
  const deaths = r.u16()
  const dollAndSec = r.u8()
  const dollCharges = dollAndSec & 0x07
  const secIdx = (dollAndSec >> 3) & 0x07
  const hasRecoilVel = !!(dollAndSec & 64)
  const hasDiffLastPrimary = !!(dollAndSec & 128)
  const secondary = SECONDARY_UNLOCK_ORDER[secIdx] ?? 'frag'
  const deathStreak = r.u8()
  const nameCached = r.u8() === 1
  let name = ''
  if (nameCached) {
    name = sess.decodedPlayerNames.get(id) ?? ('Player_' + id)
  } else {
    name = r.str()
    sess.decodedPlayerNames.set(id, name)
  }

  const curAmmo = r.u16() * 0.01
  const curReserve = r.u16()
  const ammo = WEAPONS.map(w => w.magSize)
  const reserveAmmo = WEAPONS.map(w => w.maxReserve)
  if (weaponIndex >= 0 && weaponIndex < ammo.length) {
    ammo[weaponIndex] = curAmmo
    reserveAmmo[weaponIndex] = curReserve
  }

  const timerMask = r.u8()
  if (timerMask & 1) {
    const len = r.u8()
    for (let i = 0; i < len; i++) {
      ammo[i] = r.u16() * 0.01
      reserveAmmo[i] = r.u16()
    }
  }
  const reloadTimer = (timerMask & 2) ? uTimerMs(r.u16()) : 0
  const fireCooldown = (timerMask & 4) ? uTimerMs(r.u16()) : 0
  let chargeTimer = 0
  let chargeAim: number | undefined = undefined
  if (timerMask & 8) {
    chargeTimer = uTimerMs(r.u16())
    chargeAim = uAim(r.i16())
  }
  const secondaryCooldown = (timerMask & 16) ? uTimerMs(r.u16()) : 0
  const fragRechargeTimer = (timerMask & 32) ? uTimerMs(r.u16()) : 0
  let shieldHp = 0
  let shieldTimer = 0
  if (timerMask & 64) {
    shieldHp = r.u16() * 0.1
    shieldTimer = uTimerMs(r.u16())
  }
  let respawnTimer = 0
  let warpCooldown = 0
  let watchtowerTimer = 0
  let mountedTowerId: string | null = null
  let teleportTimer = 0
  let teleportTarget: { x: number; y: number } | null = null
  if (timerMask & 128) {
    respawnTimer = uTimerMs(r.u16())
    warpCooldown = uTimerMs(r.u16())
    watchtowerTimer = uTimerMs(r.u16())
    const mt = r.str()
    mountedTowerId = mt ? mt : null
    const tpActive = r.u8()
    if (tpActive) {
      teleportTimer = uTimerMs(r.u16())
      teleportTarget = { x: uPosX(r.u16()), y: uPosY(r.u16()) }
    }
  }

  const recoilVel = hasRecoilVel ? { x: uVel(r.i16()), y: uVel(r.i16()) } : undefined
  const lastPrimaryIndex = hasDiffLastPrimary ? (r.u8() & 0x0f) : (WEAPONS[weaponIndex]?.isSupplyOnly ? 1 : weaponIndex)

  let doll: PlayerState['doll'] = null
  if (hasDoll) {
    const dx = uPosX(r.u16())
    const dy = uPosY(r.u16())
    const dHp = r.i16() * 0.1
    const dShield = r.u16() * 0.1
    const dFuel = r.u16() * 0.001
    const dWep = r.u8()
    const dTimer = uTimerMs(r.u16())
    const dLen = r.u8()
    const dAmmo = new Array(dLen)
    const dRes = new Array(dLen)
    for (let i = 0; i < dLen; i++) {
      dAmmo[i] = r.u16() * 0.01
      dRes[i] = r.u16()
    }
    doll = {
      pos: { x: dx, y: dy },
      hp: dHp,
      shieldHp: dShield,
      fuel: dFuel,
      weaponIndex: dWep,
      ammo: dAmmo,
      reserveAmmo: dRes,
      timer: dTimer,
    }
  }

  return {
    id, pos: { x: px, y: py }, vel: { x: vx, y: vy }, recoilVel, aim,
    team, name, hp, maxHp, alive, deployed, onGround,
    weaponIndex, lastPrimaryIndex, ammo, reserveAmmo,
    reloading, reloadTimer, fireCooldown, chargeTimer, chargeAim,
    secondary, secondaryCooldown, fragCharges, fragRechargeTimer,
    jetpack, fuel, shieldHp, shieldTimer, watchtowerTimer, mountedTowerId, warpCooldown,
    teleportTimer, teleportTarget, doll, dollCharges, respawnTimer, kills, deaths, deathStreak, selectedSpawnId,
  }
}

function encodeProjectile(w: ByteWriter, pr: Projectile): void {
  w.ensure(24)
  w.u32(pr.id)
  w.u16(pr.owner)
  w.i8(pr.weaponId)

  const wep = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : undefined
  const expectedR = wep ? (wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2) : -1
  const isStandard =
    wep !== undefined &&
    pr.damage === wep.damage &&
    pr.headshotMult === wep.headshotMult &&
    pr.terrainRadius === wep.terrainRadius &&
    Math.abs(pr.r - expectedR) < 1e-4 &&
    pr.hitTargets.length === 1 &&
    pr.hitTargets[0] === pr.owner

  const flags =
    (pr.explosive ? 1 : 0) |
    (pr.isGravityOrb ? 2 : 0) |
    (pr.pierceOnHeadshot ? 4 : 0) |
    (pr.pierceAll ? 8 : 0) |
    (pr.passWalls ? 16 : 0) |
    (pr.beam ? 32 : 0) |
    (pr.rocket ? 64 : 0) |
    (!isStandard ? 128 : 0)
  w.u8(flags)

  w.u16(qPosX(pr.pos.x))
  w.u16(qPosY(pr.pos.y))
  w.i16(qVel(pr.vel.x))
  w.i16(qVel(pr.vel.y))
  w.u16(clamp(Math.round(Math.min(60, pr.life) * 1000), 0, 65535))
  w.u8(pr.bounces)

  if (!isStandard) {
    w.ensure(36)
    w.f32(pr.r)
    w.f32(pr.damage)
    w.f32(pr.headshotMult)
    w.f32(pr.terrainRadius)
    w.f32(pr.gravityScale)
    w.f32(pr.dragPerSecond)
    w.f32(pr.curveRate)
    w.str(pr.weaponLabel)
    w.str(pr.color)
    w.ensure(2 + pr.hitTargets.length * 2)
    w.u8(pr.hitTargets.length)
    for (let i = 0; i < pr.hitTargets.length; i++) w.u16(pr.hitTargets[i])
  }
}

function decodeProjectile(r: ByteReader): Projectile {
  const id = r.u32()
  const owner = r.u16()
  const weaponId = r.i8()
  const flags = r.u8()
  const px = uPosX(r.u16())
  const py = uPosY(r.u16())
  const vx = uVel(r.i16())
  const vy = uVel(r.i16())
  const lifeRaw = r.u16() * 0.001
  const bounces = r.u8()

  const explosive = !!(flags & 1)
  const isGravityOrb = !!(flags & 2)
  const pierceOnHeadshot = !!(flags & 4)
  const pierceAll = !!(flags & 8)
  const passWalls = !!(flags & 16)
  const beam = !!(flags & 32)
  const rocket = !!(flags & 64)
  const hasCustom = !!(flags & 128)

  if (!hasCustom && weaponId >= 0 && WEAPONS[weaponId]) {
    const wep = WEAPONS[weaponId]
    const rad = wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2
    const life = lifeRaw >= 59.9 ? (wep.lifeSeconds ?? lifeRaw) : lifeRaw
    return {
      id, owner, pos: { x: px, y: py }, vel: { x: vx, y: vy },
      life, r: rad,
      damage: wep.damage, headshotMult: wep.headshotMult,
      explosive, terrainRadius: wep.terrainRadius,
      gravityScale: wep.gravityScale ?? (wep.id === 4 ? 0.0 : 0.04),
      pierceOnHeadshot, pierceAll, isGravityOrb,
      weaponId, curveRate: wep.curveRate ?? 0,
      weaponLabel: wep.shortName, color: wep.color,
      hitTargets: [owner],
      bounces, passWalls, beam, rocket,
      dragPerSecond: wep.dragPerSecond ?? 1,
    }
  }

  const rad = r.f32()
  const damage = r.f32()
  const headshotMult = r.f32()
  const terrainRadius = r.f32()
  const gravityScale = r.f32()
  const dragPerSecond = r.f32()
  const curveRate = r.f32()
  const weaponLabel = r.str()
  const color = r.str()
  const htLen = r.u8()
  const hitTargets = new Array(htLen)
  for (let i = 0; i < htLen; i++) hitTargets[i] = r.u16()

  return {
    id, owner, pos: { x: px, y: py }, vel: { x: vx, y: vy },
    life: lifeRaw, r: rad, damage, headshotMult, explosive, terrainRadius,
    gravityScale, pierceOnHeadshot, pierceAll, isGravityOrb,
    weaponId, curveRate, weaponLabel, color, hitTargets,
    bounces, passWalls, beam, rocket, dragPerSecond,
  }
}

// 索引表必须覆盖 core 实际发出的每个 kind：未知 kind 走 (?? 0) 会退化成 'kill'
// （曾因缺少 'hit' 导致二进制联机下"每次受击都变成一次击杀"）。
const EVENT_KINDS: WorldEvent['kind'][] = [
  'hit', 'kill', 'explosion', 'obstacle_destroy',
  'capture', 'supply_pickup', 'ammo_pickup', 'warp',
  'shield', 'shield_break', 'doll_recall', 'mortar_fire',
  'airstrike', 'airstrike_drop', 'laser', 'watchtower',
  'headshot', 'pierce',
  'projectile_spawn', 'projectile_bounce', 'projectile_destroy',
]
const EVENT_KIND_TO_IDX: Record<string, number> = Object.fromEntries(EVENT_KINDS.map((k, i) => [k, i]))

function encodeWorldEvent(w: ByteWriter, e: WorldEvent): void {
  w.ensure(20)
  const kIdx = EVENT_KIND_TO_IDX[e.kind] ?? 0
  w.u8(kIdx)
  if (e.kind === 'laser' && e.segments) {
    w.u8(1)
    w.u16(qPosX(e.x ?? 0))
    w.u16(qPosY(e.y ?? 0))
    w.u16(qTimerMs(e.duration ?? 0.06))
    w.str(e.color ?? '#22d3ee')
    w.ensure(4 + e.segments.length * 8)
    w.u16(e.playerId ?? 0)
    w.str(e.weaponLabel ?? '高斯枪')
    w.ensure(2 + e.segments.length * 16)
    w.u8(e.segments.length)
    for (let i = 0; i < e.segments.length; i++) {
      const s = e.segments[i]
      w.u16(qPosX(s.x1)); w.u16(qPosY(s.y1)); w.u16(qPosX(s.x2)); w.u16(qPosY(s.y2))
      // 真实位移（可为负、可达到全图宽度 13200px，i16*4 会在 >8191px 时溢出变负）→ 用 i32 保证长段无溢出
      w.i32(Math.round((s.dx ?? 0) * 16))
      w.i32(Math.round((s.dy ?? 0) * 16))
    }
    return
  }
  if (e.kind === 'projectile_spawn' || e.kind === 'projectile_bounce') {
    w.u8(2)
    w.u32(e.projectileId ?? 0)
    w.u16(e.playerId ?? 0)
    w.i8(e.weaponId ?? -1)
    w.u16(qPosX(e.x ?? 0))
    w.u16(qPosY(e.y ?? 0))
    w.i16(qVel(e.vx ?? 0))
    w.i16(qVel(e.vy ?? 0))
    w.u8(e.bounces ?? 0)
    return
  }
  if (e.kind === 'projectile_destroy') {
    w.u8(3)
    w.u32(e.projectileId ?? 0)
    return
  }
  w.u8(0)
  w.str(JSON.stringify(e))
}

function decodeWorldEvent(r: ByteReader): WorldEvent {
  const kIdx = r.u8()
  const mode = r.u8()
  if (mode === 1) {
    const x = uPosX(r.u16())
    const y = uPosY(r.u16())
    const duration = uTimerMs(r.u16())
    const color = r.str()
    const playerId = r.u16()
    const weaponLabel = r.str()
    const segLen = r.u8()
    const segments = new Array(segLen)
    for (let i = 0; i < segLen; i++) {
      const x1 = uPosX(r.u16()), y1 = uPosY(r.u16()), x2 = uPosX(r.u16()), y2 = uPosY(r.u16())
      const dx = r.i32() / 16
      const dy = r.i32() / 16
      segments[i] = { x1, y1, x2, y2, dx, dy }
    }
    return { kind: 'laser', x, y, duration, color, playerId, weaponLabel, segments }
  }
  if (mode === 2) {
    const kind = EVENT_KINDS[kIdx] === 'projectile_bounce' ? 'projectile_bounce' : 'projectile_spawn'
    return {
      kind,
      projectileId: r.u32(),
      playerId: r.u16(),
      weaponId: r.i8(),
      x: uPosX(r.u16()),
      y: uPosY(r.u16()),
      vx: uVel(r.i16()),
      vy: uVel(r.i16()),
      bounces: r.u8(),
    }
  }
  if (mode === 3) {
    return {
      kind: 'projectile_destroy',
      projectileId: r.u32(),
    }
  }
  return JSON.parse(r.str()) as WorldEvent
}

// ── ClientMsg 二进制编码（把每帧意图流压至 ~20 字节） ──────────────────
export function encodeClientMsgBinary(msg: ClientMsg): Uint8Array {
  const w = sharedClientWriter
  w.reset()
  w.ensure(64)
  w.u32(MAGIC_CLIENT)
  w.u32(msg.seq)
  w.f64(msg.ts)
  w.u8(msg.intents.length)
  for (let i = 0; i < msg.intents.length; i++) {
    w.ensure(32)
    const it = msg.intents[i]
    switch (it.t) {
      case 'move': w.u8(1); w.i8(it.dir); break
      case 'jump': w.u8(2); break
      case 'jetpack': w.u8(3); w.u8(it.on ? 1 : 0); break
      case 'dive': w.u8(4); w.u8(it.on ? 1 : 0); break
      case 'aim': w.u8(5); w.f32(it.angle); break
      case 'fire': w.u8(6); w.u8(it.on ? 1 : 0); break
      case 'reload': w.u8(7); break
      case 'interact': w.u8(8); break
      case 'secondary': w.u8(9); w.str(it.kind); w.f32(it.targetX); w.f32(it.targetY); break
      case 'switchWeapon': w.u8(10); w.i8(it.index); break
    }
  }
  return w.finish()
}

export function decodeClientMsgBinary(bytes: Uint8Array): ClientMsg | null {
  if (bytes.byteLength < 17) return null
  const r = new ByteReader(bytes)
  if (r.u32() !== MAGIC_CLIENT) return null
  const seq = r.u32()
  const ts = r.f64()
  const count = r.u8()
  const intents: Intent[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const code = r.u8()
    switch (code) {
      case 1: intents[i] = { t: 'move', dir: r.i8() as -1 | 0 | 1 }; break
      case 2: intents[i] = { t: 'jump' }; break
      case 3: intents[i] = { t: 'jetpack', on: r.u8() !== 0 }; break
      case 4: intents[i] = { t: 'dive', on: r.u8() !== 0 }; break
      case 5: intents[i] = { t: 'aim', angle: r.f32() }; break
      case 6: intents[i] = { t: 'fire', on: r.u8() !== 0 }; break
      case 7: intents[i] = { t: 'reload' }; break
      case 8: intents[i] = { t: 'interact' }; break
      case 9: intents[i] = { t: 'secondary', kind: r.str(), targetX: r.f32(), targetY: r.f32() }; break
      case 10: intents[i] = { t: 'switchWeapon', index: r.i8() }; break
      default: intents[i] = { t: 'move', dir: 0 }; break
    }
  }
  return { seq, ts, intents }
}

export function bytesToFrameString(bytes: Uint8Array): string {
  let out = BINARY_STR_PREFIX
  const CHUNK = 4096
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return out
}

export function frameStringToBytes(str: string): Uint8Array {
  const pLen = BINARY_STR_PREFIX.length
  const len = str.length - pLen
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = str.charCodeAt(i + pLen) & 0xff
  }
  return out
}

/** AOI（Area of Interest）视野兴趣区裁剪：在百人房间下为指定玩家裁剪视野外的非关键飞行物 */
export function filterSnapshotAOI(snap: WorldSnapshot, centerPlayerId: number, radiusX = 2800, radiusY = 1800): WorldSnapshot {
  const viewer = snap.players.find(p => p.id === centerPlayerId)
  if (!viewer) return snap
  const vx = viewer.pos.x
  const vy = viewer.pos.y
  return {
    ...snap,
    projectiles: snap.projectiles.filter(pr =>
      pr.owner === centerPlayerId ||
      (Math.abs(wrapDeltaX(vx, pr.pos.x)) <= radiusX && Math.abs(wrapDeltaY(vy, pr.pos.y)) <= radiusY)
    ),
    grenades: snap.grenades.filter(g =>
      g.owner === centerPlayerId ||
      (Math.abs(wrapDeltaX(vx, g.pos.x)) <= radiusX && Math.abs(wrapDeltaY(vy, g.pos.y)) <= radiusY)
    ),
  }
}
