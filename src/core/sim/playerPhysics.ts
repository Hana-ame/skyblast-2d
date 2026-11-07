// core/sim/playerPhysics.ts —— 玩家运动学、6 采样点碰撞、穿模解算与重叠分离
// 同时导出纯函数 `predictLocalPlayerStep` 供客户端 StateSync 本地预测与服务器回滚重放（Reconciliation）直接复用！
import { applyGravity, jetpack, jump, updateJetpackFuel, getPhysicsParams, stepRecoilVel, RECOIL_DISPLACEMENT_FACTOR } from './physics.ts'
import { TILE_SIZE, GRID_W } from '../terrain.ts'
import type { Terrain } from '../terrain.ts'
import { WEAPONS } from '../weapons.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist } from '../wrap.ts'
import { BODY_HALF_W, BODY_TOP, BODY_BOTTOM, JUMP_PADS, SPAWN_POINTS } from './landmarks.ts'
import { bucketIdx, findObstacleAt, checkBodyOverlapsAt } from './spatial.ts'
import type { PlayerState, WorldInput, Obstacle, Mortar, Watchtower } from '../types.ts'

/** 两个玩家身体 AABB 是否相交（宽 20，高 -30..+16，脚底锚点） */
export function bodiesOverlap(ax: number, ay: number, bx: number, by: number): boolean {
  if ((ay + 16) <= (by - 30) || (ay - 30) >= (by + 16)) return false
  return Math.abs(wrapDeltaX(ax, bx)) < 20
}

/** 单个点是否落在其他玩家身体 AABB 内（通过空间桶 O(1) 定位） */
export function playerHitsPoint(
  playerBroadBuckets: PlayerState[][],
  x: number,
  y: number,
  selfId: number,
): boolean {
  const list = playerBroadBuckets[bucketIdx(x)]
  if (!list) return false
  for (let i = 0; i < list.length; i++) {
    const other = list[i]
    if (other.id === selfId) continue
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
    if ((other.spawnProtectTimer ?? 0) > 0) continue   // 复活保护：无实体
    if (y <= other.pos.y - 30 || y >= other.pos.y + 16) continue
    if (Math.abs(wrapDeltaX(x, other.pos.x)) <= 10) return true
  }
  return false
}

/** 找指定位置与玩家 selfId 身体相交的其他玩家 */
export function playerBlockingAt(
  playerBroadBuckets: PlayerState[][],
  x: number,
  y: number,
  selfId: number,
): PlayerState | null {
  const list = playerBroadBuckets[bucketIdx(x)]
  if (!list) return null
  for (let i = 0; i < list.length; i++) {
    const other = list[i]
    if (other.id === selfId) continue
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
    if ((other.spawnProtectTimer ?? 0) > 0) continue   // 复活保护：无实体
    if (bodiesOverlap(x, y, other.pos.x, other.pos.y)) return other
  }
  return null
}

/** 轻推另一个玩家（"顶着人"：被挡住时把对方朝同方向推一点，避让地形/障碍/其他人） */
export function tryNudgePlayer(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  playerBroadBuckets: PlayerState[][],
  other: PlayerState,
  dir: number,
  amount: number,
): void {
  if (dir === 0) return
  const nx = wrapX(other.pos.x + dir * amount)
  if (terrain.isSolidAt(nx, other.pos.y - 6)) return
  if (terrain.isSolidAt(nx, other.pos.y + 15)) return
  if (findObstacleAt(obstacles, obstacleBroadBuckets, nx, other.pos.y)) return
  const list = playerBroadBuckets[bucketIdx(nx)]
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      if (t.id === other.id) continue
      if (!t.deployed || !t.alive || t.respawnTimer > 0) continue
      if (bodiesOverlap(nx, other.pos.y, t.pos.x, t.pos.y)) return
    }
  }
  other.pos.x = nx
}

/** 躯干/头是否嵌在实体里（站立在地面上不算——只查躯干以上） */
export function torsoBlockedAt(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  x: number,
  y: number,
): boolean {
  const wx = wrapX(x)
  const pts: [number, number][] = [
    [wx - 10, y - 4], [wx + 10, y - 4], [wx, y - 6],
    [wx - 10, y - 26], [wx + 10, y - 26], [wx, y - 30],
  ]
  for (const [px, py] of pts) {
    if (terrain.isSolidAt(px, py)) return true
    if (findObstacleAt(obstacles, obstacleBroadBuckets, px, py)) return true
  }
  return false
}

/** 把玩家挪到最近的安全位置（出生/被结构挤压/死角兜底） */
export function ensureFreePosition(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  p: PlayerState,
): boolean {
  if (!torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, p.pos.x, p.pos.y)) return false
  for (let r = 24; r <= 320; r += 24) {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI) / 8
      const x = wrapX(p.pos.x + Math.cos(ang) * r)
      const y = wrapY(p.pos.y + Math.sin(ang) * r)
      if (!torsoBlockedAt(terrain, obstacles, obstacleBroadBuckets, x, y)) {
        p.pos = { x, y }
        p.vel = { x: 0, y: 0 }
        return true
      }
    }
  }
  const base = SPAWN_POINTS.find(s => s.team === p.team) ?? SPAWN_POINTS[3]
  p.pos = { x: wrapX(base.x), y: base.y }
  p.vel = { x: 0, y: 0 }
  return true
}

/** 最小轴推出（穿模解算）：把玩家从任何嵌入的实体里沿最小穿透方向推出 */
export function resolvePenetration(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  p: PlayerState,
): boolean {
  const halfW = 10
  let moved = false
  for (let iter = 0; iter < 6; iter++) {
    if (!checkBodyOverlapsAt(terrain, obstacles, p.pos.x, p.pos.y, obstacleBroadBuckets)) break
    const wx = wrapX(p.pos.x)
    const pick: { v: { dx: number; dy: number } | null } = { v: null }
    let bestLen = Infinity
    const consider = (tileL: number, tileR: number, tileT: number, tileB: number): void => {
      if (!(tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16)) return
      const cand = [
        { dx: tileL - halfW, dy: 0 },
        { dx: tileR + halfW, dy: 0 },
        { dx: 0, dy: tileB + 30 },
        { dx: 0, dy: tileT - 16 },
      ]
      for (const c of cand) {
        const len = Math.abs(c.dx) + Math.abs(c.dy)
        if (len < bestLen) { bestLen = len; pick.v = c }
      }
    }
    const gx0 = Math.floor((wx - halfW) / TILE_SIZE)
    const gx1 = Math.floor((wx + halfW) / TILE_SIZE)
    const gy0 = Math.floor(wrapY(p.pos.y - 30) / TILE_SIZE)
    const gy1 = Math.floor(wrapY(p.pos.y + 16) / TILE_SIZE)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const cellX = wrapX(gx * TILE_SIZE) + TILE_SIZE / 2
        const cellY = wrapY(gy * TILE_SIZE) + TILE_SIZE / 2
        if (!terrain.isSolidAt(cellX, cellY)) continue
        const lx = wrapDeltaX(wx, cellX)
        const ly = wrapDeltaY(p.pos.y, cellY)
        consider(lx - TILE_SIZE / 2, lx + TILE_SIZE / 2, ly - TILE_SIZE / 2, ly + TILE_SIZE / 2)
      }
    }
    for (const ob of obstacles) {
      if (ob.hp <= 0) continue
      const lx = wrapDeltaX(wx, ob.x + ob.w / 2)
      const ly = wrapDeltaY(p.pos.y, ob.y + ob.h / 2)
      consider(lx - ob.w / 2, lx + ob.w / 2, ly - ob.h / 2, ly + ob.h / 2)
    }
    if (pick.v) {
      p.pos.x = wrapX(p.pos.x + pick.v.dx)
      p.pos.y = wrapY(p.pos.y + pick.v.dy)
      moved = true
    } else {
      ensureFreePosition(terrain, obstacles, obstacleBroadBuckets, p)
      moved = true
      break
    }
  }
  return moved
}

function hitSingleBodyPoint(
  tGrid: Uint8Array,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  playerBroadBuckets: PlayerState[][] | undefined,
  selfId: number,
  x: number,
  y: number,
): boolean {
  const wx = wrapX(x)
  const wy = wrapY(y)
  if (tGrid[((wy / 20) | 0) * GRID_W + ((wx / 20) | 0)] !== 0) return true
  if (findObstacleAt(obstacles, obstacleBroadBuckets, wx, y) !== null) return true
  if (playerBroadBuckets) return playerHitsPoint(playerBroadBuckets, wx, y, selfId)
  return false
}

function hitAnyBodyPoints(
  tGrid: Uint8Array,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  playerBroadBuckets: PlayerState[][] | undefined,
  selfId: number,
  cx: number,
  cy: number,
): boolean {
  return (
    hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx - BODY_HALF_W, cy + BODY_BOTTOM) ||
    hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx + BODY_HALF_W, cy + BODY_BOTTOM) ||
    hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy + BODY_BOTTOM) ||
    hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx - BODY_HALF_W, cy) ||
    hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx + BODY_HALF_W, cy) ||
    hitSingleBodyPoint(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, selfId, cx, cy - BODY_TOP)
  )
}

/** 权威端单玩家物理步进（含地形/掩体/其他玩家碰撞与弹射跳台） */
export function stepPlayerKinematic(
  p: PlayerState,
  w: WorldInput,
  dt: number,
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  playerBroadBuckets: PlayerState[][] | undefined,
  mortars: Mortar[],
  watchtowers: Watchtower[],
): void {
  if (!p.alive || p.respawnTimer > 0) return
  for (let i = 0; i < mortars.length; i++) {
    const mm = mortars[i]
    if (mm.operatorId === p.id) {
      p.pos = { x: mm.x, y: mm.y - 16 }
      p.vel = { x: 0, y: 0 }
      return
    }
  }
  if (p.mountedTowerId) {
    for (let i = 0; i < watchtowers.length; i++) {
      const tw = watchtowers[i]
      if (tw.id === p.mountedTowerId) {
        p.pos = { x: tw.x, y: tw.y - 150 + 12 }
        p.vel = { x: 0, y: 0 }
        p.onGround = false
        return
      }
    }
  }

  applyGravity(p.vel, dt, 1)

  if (p.onGround && p.vel.y >= -20) {
    for (let i = 0; i < JUMP_PADS.length; i++) {
      const pad = JUMP_PADS[i]
      if (Math.abs(p.pos.y - pad.y) >= 34) continue
      const d = wrapDist(p.pos.x, p.pos.y, pad.x, pad.y)
      if (d < 34) {
        p.vel.x += pad.vx
        p.vel.y = pad.vy
        p.onGround = false
      }
    }
  }

  const tGrid = terrain.grid
  // 位移 = 常规速度 + 独立后坐力速度（后者不受移动覆写/重力/速度上限影响 → 各向同性）
  if (!p.recoilVel) p.recoilVel = { x: 0, y: 0 }
  const rv = p.recoilVel
  // 后坐力位移按解析积分系数结算（帧首速度直接乘 dt 会系统性少 ~4%）
  const nx = wrapX(p.pos.x + p.vel.x * dt + rv.x * RECOIL_DISPLACEMENT_FACTOR)
  if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, nx, p.pos.y)) {
    p.pos.x = nx
  } else if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, nx, p.pos.y - 10)) {
    p.pos.x = nx
    p.pos.y -= 10
  } else {
    if (playerBroadBuckets) {
      const blocker = playerBlockingAt(playerBroadBuckets, nx, p.pos.y, p.id)
      if (blocker) {
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, blocker, Math.sign(nx - p.pos.x), 1.4)
      }
    }
    p.vel.x = 0
    rv.x = 0            // 撞墙：该轴后坐力被墙吸收
  }

  const vyTotal = p.vel.y + rv.y
  const nyRaw = p.pos.y + p.vel.y * dt + rv.y * RECOIL_DISPLACEMENT_FACTOR
  const ny = wrapY(nyRaw)
  if (!hitAnyBodyPoints(tGrid, obstacles, obstacleBroadBuckets, playerBroadBuckets, p.id, p.pos.x, ny)) {
    p.pos.y = ny
    p.onGround = false
  } else {
    p.onGround = vyTotal > 0
    p.vel.y = 0
    rv.y = 0            // 落地：垂直后坐力被地面吸收
  }
  p.pos.x = wrapX(p.pos.x)
  p.pos.y = wrapY(p.pos.y)
  // 指数阻尼衰减（各向同性）
  stepRecoilVel(rv, dt)
}

/** 玩家重叠分离：利用宽相空间桶只检查同桶内距离 <20px 的玩家对，复杂度 O(N) */
export function separateOverlappingPlayers(
  players: PlayerState[],
  playerBroadBuckets: PlayerState[][],
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
): void {
  for (let i = 0; i < players.length; i++) {
    const a = players[i]
    if (!a.deployed || !a.alive || a.respawnTimer > 0) continue
    const candidates = playerBroadBuckets[bucketIdx(a.pos.x)]
    if (!candidates) continue
    let nudged = 0
    for (let k = 0; k < candidates.length; k++) {
      const b = candidates[k]
      if (b.id <= a.id) continue
      if (!b.deployed || !b.alive || b.respawnTimer > 0) continue
      if (!bodiesOverlap(a.pos.x, a.pos.y, b.pos.x, b.pos.y)) continue
      const dx = Math.abs(wrapDeltaX(a.pos.x, b.pos.x))
      const ox = 20 - dx
      const top = Math.max(a.pos.y - 30, b.pos.y - 30)
      const bottom = Math.min(a.pos.y + 16, b.pos.y + 16)
      const oy = bottom - top
      if (oy > 0 && ((ox <= 20 && dx <= 8) || oy <= ox)) {
        const upper = a.pos.y <= b.pos.y ? a : b
        const upY = wrapY(upper.pos.y - oy)
        if (!terrain.isSolidAt(upper.pos.x, upY - 26)) upper.pos.y = upY
      } else {
        const dir = Math.sign(wrapDeltaX(a.pos.x, b.pos.x)) || 1
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, b, dir, 0.6)
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, a, -dir, 0.6)
      }
      if (++nudged >= 3) break
    }
  }
}

/** 客户端本地预测与服务器回滚重放（Reconciliation）专用纯函数：
 *  推进单个玩家一帧的输入响应（移动速度、跳跃、喷气推力、燃料消耗与地形/障碍碰撞）。 */
export function predictLocalPlayerStep(
  p: PlayerState,
  w: WorldInput,
  dt: number,
  terrain: Terrain,
  obstacles: Obstacle[] = [],
  mortars: Mortar[] = [],
  watchtowers: Watchtower[] = [],
): void {
  if (!p.deployed || !p.alive || p.respawnTimer > 0) return
  p.aim = w.aim
  const wepCur = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
  if (p.mountedTowerId) {
    p.vel.x = 0
    p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1))
  } else {
    p.vel.x = w.move * getPhysicsParams().moveSpeed * (wepCur.moveSpeedMult ?? 1)
  }
  if (w.jump && p.onGround) jump(p.vel)
  const fuelMax = getPhysicsParams().jetpackFuel * (wepCur.fuelMult ?? 1)
  const fuel = Math.min(p.fuel, fuelMax)
  const canJet = !p.mountedTowerId && w.jetpack && fuel > 0
  if (canJet) jetpack(p.vel, dt, wepCur.ascendMult ?? 1)
  p.jetpack = canJet
  p.fuel = updateJetpackFuel(fuel, w.jetpack, !!p.onGround, dt, fuelMax)

  stepPlayerKinematic(p, w, dt, terrain, obstacles, undefined, undefined, mortars, watchtowers)
}
