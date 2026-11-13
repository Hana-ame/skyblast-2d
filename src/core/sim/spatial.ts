// core/sim/spatial.ts —— 一维环形空间哈希桶（Broadphase）与地形/掩体几何查询纯函数
import { TILE_SIZE, GRID_W, GRID_H } from '../terrain.ts'
import type { Terrain } from '../terrain.ts'
import { WORLD_W, WORLD_H, wrapX, wrapY, wrapDeltaX, wrapDeltaY } from '../wrap.ts'
import type { Obstacle, PlayerState } from '../types.ts'

export const BUCKET_SIZE = 200
export const INV_BUCKET_SIZE = 1 / BUCKET_SIZE
export const NUM_BUCKETS = Math.ceil(WORLD_W / BUCKET_SIZE) // 66
export const PLAYER_BROAD_PAD = 48
export const OBSTACLE_BROAD_PAD = 16

export function bucketIdx(wx: number): number {
  const b = (wx * INV_BUCKET_SIZE) | 0
  return b >= 0 && b < NUM_BUCKETS ? b : ((b % NUM_BUCKETS) + NUM_BUCKETS) % NUM_BUCKETS
}

export function obstacleAtBucket(list: Obstacle[], wx: number, y: number, pad = 0): Obstacle | null {
  for (let i = 0; i < list.length; i++) {
    const ob = list[i]
    if (ob.hp <= 0) continue
    if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad) {
      const dy = wrapDeltaY(ob.y, y)
      if (dy >= -pad && dy <= ob.h + pad) return ob
    }
  }
  return null
}

export function findObstacleAt(
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  x: number,
  y: number,
  pad = 0,
): Obstacle | null {
  const wx = x >= 0 && x < WORLD_W ? x : wrapX(x)
  if (obstacleBroadBuckets && pad <= OBSTACLE_BROAD_PAD) {
    const list = obstacleBroadBuckets[bucketIdx(wx)]
    return list && list.length > 0 ? obstacleAtBucket(list, wx, y, pad) : null
  }
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i]
    if (ob.hp <= 0) continue
    const dy = wrapDeltaY(ob.y, y)
    if (wx >= ob.x - pad && wx <= ob.x + ob.w + pad && dy >= -pad && dy <= ob.h + pad) return ob
  }
  return null
}

/** 两点之间是否被「原始地形 或 可破坏掩体」挡住（4px 采样、端点不计） */
export function lineBlockedByTerrain(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  /** 真实未 wrap 位移（光束段跨接缝时必传，否则 wrapDelta 会走反方向误判遮挡） */
  rawDx?: number,
  rawDy?: number,
): boolean {
  const dx = rawDx ?? wrapDeltaX(x1, x2)
  const dy = rawDy ?? wrapDeltaY(y1, y2)
  const dist = Math.hypot(dx, dy)
  if (dist <= 1) return false
  const steps = Math.max(1, Math.ceil(dist / 4))
  const tGrid = terrain.grid
  const invSteps = 1 / steps
  const hasObs = obstacles.length > 0
  for (let k = 1; k < steps; k++) {
    const f = k * invSteps
    let px = x1 + dx * f
    if (px >= WORLD_W || px < 0) px = wrapX(px)
    let py = y1 + dy * f
    if (py >= WORLD_H || py < 0) py = wrapY(py)
    if (tGrid[((py * 0.05) | 0) * GRID_W + ((px * 0.05) | 0)] !== 0) return true
    if (hasObs && findObstacleAt(obstacles, obstacleBroadBuckets, px, py)) return true
  }
  return false
}

/**
 * 把一段光束截断到「最后一个空点」。
 * 端点由「起点 + 真实未 wrap 位移」推导（而不是直接取 wrap 后的 x2/y2）：
 * 跨接缝或长段时，wrap 后的末端与起点并非最短路径关系，直接用会画出跨世界的假长线。
 * 返回的 dx/dy 是该段真正要绘制的位移，渲染端直接用它，不再自己算 wrapDelta。
 */
export function truncateSegmentToFree(
  terrain: Terrain,
  x1: number,
  y1: number,
  _x2: number,
  _y2: number,
  /** 真实（未 wrap）位移：单段可能长于半世界（如地面→天花板 2440px > 2200），
   *  用 wrapDelta 会把它折叠成反向最短路径，把段截成几个像素。 */
  rawDx?: number,
  rawDy?: number,
): { x: number; y: number; dx: number; dy: number; shortened: boolean } {
  const dx = rawDx ?? wrapDeltaX(x1, _x2)
  const dy = rawDy ?? wrapDeltaY(y1, _y2)
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return { x: x1, y: y1, dx: 0, dy: 0, shortened: false }
  const steps = Math.max(1, Math.ceil(len / 3))
  const tGrid = terrain.grid
  const invSteps = 1 / steps
  let lastDx = 0
  let lastDy = 0
  for (let k = 1; k <= steps; k++) {
    const f = k * invSteps
    const curDx = dx * f
    const curDy = dy * f
    let px = x1 + curDx
    if (px >= WORLD_W || px < 0) px = wrapX(px)
    let py = y1 + curDy
    if (py >= WORLD_H || py < 0) py = wrapY(py)
    if (tGrid[((py * 0.05) | 0) * GRID_W + ((px * 0.05) | 0)] !== 0) {
      return { x: wrapX(x1 + lastDx), y: wrapY(y1 + lastDy), dx: lastDx, dy: lastDy, shortened: true }
    }
    lastDx = curDx
    lastDy = curDy
  }
  return { x: wrapX(x1 + dx), y: wrapY(y1 + dy), dx, dy, shortened: false }
}

/** 扫描覆盖身体 AABB 的地形格与障碍物，判断玩家躯干是否发生穿模 */
export function checkBodyOverlapsAt(
  terrain: Terrain,
  obstacles: Obstacle[],
  x: number,
  y: number,
  obstacleBroadBuckets?: Obstacle[][],
): boolean {
  const wx = x >= 0 && x < WORLD_W ? x : wrapX(x)
  const halfW = 10
  const tGrid = terrain.grid
  const gx0 = Math.floor((wx - halfW) / TILE_SIZE)
  const gx1 = Math.floor((wx + halfW) / TILE_SIZE)
  const wyTop = y - 30 >= 0 && y - 30 < WORLD_H ? y - 30 : wrapY(y - 30)
  const wyBot = y + 16 >= 0 && y + 16 < WORLD_H ? y + 16 : wrapY(y + 16)
  const gy0 = Math.floor(wyTop / TILE_SIZE)
  const gy1 = Math.floor(wyBot / TILE_SIZE)
  for (let gx = gx0; gx <= gx1; gx++) {
    const gxx = gx >= 0 && gx < GRID_W ? gx : ((gx % GRID_W) + GRID_W) % GRID_W
    for (let gy = gy0; gy <= gy1; gy++) {
      const gyy = gy >= 0 && gy < GRID_H ? gy : ((gy % GRID_H) + GRID_H) % GRID_H
      if (tGrid[gyy * GRID_W + gxx] === 0) continue
      const cellX = gxx * TILE_SIZE + TILE_SIZE / 2
      const cellY = gyy * TILE_SIZE + TILE_SIZE / 2
      const lx = wrapDeltaX(wx, cellX)
      const ly = wrapDeltaY(y, cellY)
      const tileL = lx - TILE_SIZE / 2
      const tileR = lx + TILE_SIZE / 2
      const tileT = ly - TILE_SIZE / 2
      const tileB = ly + TILE_SIZE / 2
      if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true
    }
  }
  const obList = obstacleBroadBuckets ? obstacleBroadBuckets[bucketIdx(wx)] : obstacles
  if (obList && obList.length > 0) {
    for (let i = 0; i < obList.length; i++) {
      const ob = obList[i]
      if (ob.hp <= 0) continue
      const dx = wrapDeltaX(wx, ob.x + ob.w / 2)
      const dy = wrapDeltaY(y, ob.y + ob.h / 2)
      const tileL = dx - ob.w / 2
      const tileR = dx + ob.w / 2
      const tileT = dy - ob.h / 2
      const tileB = dy + ob.h / 2
      if (tileR > -halfW && tileL < halfW && tileB > -30 && tileT < 16) return true
    }
  }
  return false
}

export interface LagHistoryEntry {
  tick: number
  positions: Map<number, { x: number; y: number }>
}

const MAX_LAG_HISTORY_TICKS = 36

export function recordPlayerLagHistory(history: LagHistoryEntry[], tick: number, players: PlayerState[]): void {
  let entry: LagHistoryEntry
  if (history.length >= MAX_LAG_HISTORY_TICKS) {
    entry = history.shift()!
    entry.tick = tick
    entry.positions.clear()
  } else {
    entry = { tick, positions: new Map<number, { x: number; y: number }>() }
  }
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    if (p.deployed && p.alive && p.respawnTimer <= 0) {
      entry.positions.set(p.id, { x: p.pos.x, y: p.pos.y })
    }
  }
  history.push(entry)
}

export function withRewoundPlayersForShooter<T>(
  enabled: boolean,
  history: LagHistoryEntry[],
  playerLagMs: Map<number, number>,
  shooterId: number,
  players: PlayerState[],
  rebuildBuckets: () => void,
  fn: () => T,
): T {
  if (!enabled || history.length === 0) return fn()
  const lagMs = playerLagMs.get(shooterId) ?? 0
  if (lagMs < 16) return fn()
  const rewindTicks = Math.min(30, Math.max(1, Math.round(lagMs / (1000 / 60))))
  const idx = Math.max(0, history.length - 1 - rewindTicks)
  const snap = history[idx]
  if (!snap) return fn()

  const saved: { p: PlayerState; x: number; y: number }[] = []
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    if (p.id === shooterId || !p.deployed || !p.alive || p.respawnTimer > 0) continue
    const histPos = snap.positions.get(p.id)
    if (histPos && Math.abs(wrapDeltaX(p.pos.x, histPos.x)) < 480 && Math.abs(wrapDeltaY(p.pos.y, histPos.y)) < 480) {
      saved.push({ p, x: p.pos.x, y: p.pos.y })
      p.pos.x = histPos.x
      p.pos.y = histPos.y
    }
  }
  if (saved.length === 0) return fn()
  rebuildBuckets()
  try {
    return fn()
  } finally {
    for (let i = 0; i < saved.length; i++) {
      saved[i].p.pos.x = saved[i].x
      saved[i].p.pos.y = saved[i].y
    }
    rebuildBuckets()
  }
}
