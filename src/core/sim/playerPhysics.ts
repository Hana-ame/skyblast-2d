// core/sim/playerPhysics.ts —— 玩家运动学、AABB 滑动碰撞、穿模解算与无死锁多人分离
// 同时导出纯函数 `predictLocalPlayerStep` 供客户端 StateSync 本地预测与服务器回滚重放（Reconciliation）直接复用！
import { applyGravity, jetpack, jump, updateJetpackFuel, getPhysicsParams, stepRecoilVel, RECOIL_DISPLACEMENT_FACTOR } from './physics.ts'
import { TILE_SIZE } from '../terrain.ts'
import type { Terrain } from '../terrain.ts'
import { WEAPONS } from '../weapons.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist } from '../wrap.ts'
import { JUMP_PADS, SPAWN_POINTS } from './landmarks.ts'
import { bucketIdx, findObstacleAt, checkBodyOverlapsAt } from './spatial.ts'
import type { PlayerState, WorldInput, Obstacle, Mortar, Watchtower } from '../types.ts'

/** 两个玩家身体 AABB 是否相交（宽 20，高 -30..+16，脚底锚点） */
export function bodiesOverlap(ax: number, ay: number, bx: number, by: number): boolean {
  if ((ay + 16) <= (by - 30) || (ay - 30) >= (by + 16)) return false
  return Math.abs(wrapDeltaX(ax, bx)) < 20 - 1e-3
}

/** 单个点是否落在其他玩家身体 AABB 内（通过空间桶 O(1) 定位） */
export function playerHitsPoint(
  playerBroadBuckets: PlayerState[][],
  x: number,
  y: number,
  selfId: number,
  curSelfX?: number,
  curSelfY?: number,
  nextSelfX?: number,
  nextSelfY?: number,
): boolean {
  const list = playerBroadBuckets[bucketIdx(x)]
  if (!list || list.length === 0) return false
  for (let i = 0; i < list.length; i++) {
    const other = list[i]
    if (other.id === selfId) continue
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
    if (y <= other.pos.y - 30 || y >= other.pos.y + 16) continue
    if (Math.abs(wrapDeltaX(x, other.pos.x)) < 10) {
      if (curSelfX !== undefined && curSelfY !== undefined && bodiesOverlap(curSelfX, curSelfY, other.pos.x, other.pos.y)) {
        if (nextSelfX !== undefined && Math.abs(wrapDeltaX(nextSelfX, other.pos.x)) >= Math.abs(wrapDeltaX(curSelfX, other.pos.x)) - 1e-4) {
          continue
        }
        if (nextSelfY !== undefined && nextSelfY !== curSelfY) {
          continue
        }
      }
      return true
    }
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
    if (bodiesOverlap(x, y, other.pos.x, other.pos.y)) return other
  }
  return null
}

/** 轻推另一个玩家（"顶着人"：被挡住时把对方朝同方向推一点，严格使用完整身体 AABB 避让地形/障碍/其他人） */
export function tryNudgePlayer(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  playerBroadBuckets: PlayerState[][],
  other: PlayerState,
  dir: number,
  amount: number,
): boolean {
  if (dir === 0) return false
  const nx = wrapX(other.pos.x + dir * amount)
  // 必须用完整身体 AABB 检查地形与障碍物，绝不能把对方推进墙体或天花板角落里
  if (checkBodyOverlapsAt(terrain, obstacles, nx, other.pos.y, obstacleBroadBuckets)) return false
  const list = playerBroadBuckets[bucketIdx(nx)]
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      if (t.id === other.id) continue
      if (!t.deployed || !t.alive || t.respawnTimer > 0) continue
      if (bodiesOverlap(nx, other.pos.y, t.pos.x, t.pos.y)) {
        const wasOverlapping = bodiesOverlap(other.pos.x, other.pos.y, t.pos.x, t.pos.y)
        if (!wasOverlapping) return false
        const prevDist = Math.abs(wrapDeltaX(other.pos.x, t.pos.x))
        const nextDist = Math.abs(wrapDeltaX(nx, t.pos.x))
        if (nextDist <= prevDist) return false
      }
    }
  }
  other.pos.x = nx
  return true
}

/** 躯干/头是否嵌在实体里（站立在地面上不算——只查躯干以上，零数组分配） */
export function torsoBlockedAt(
  terrain: Terrain,
  obstacles: Obstacle[],
  obstacleBroadBuckets: Obstacle[][] | undefined,
  x: number,
  y: number,
): boolean {
  const wx = wrapX(x)
  const checkPt = (px: number, py: number): boolean =>
    terrain.isSolidAt(px, py) || findObstacleAt(obstacles, obstacleBroadBuckets, px, py) !== null
  return (
    checkPt(wx - 9.5, y - 4) ||
    checkPt(wx + 9.5, y - 4) ||
    checkPt(wx, y - 6) ||
    checkPt(wx - 9.5, y - 26) ||
    checkPt(wx + 9.5, y - 26) ||
    checkPt(wx, y - 29.5)
  )
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
  const base = SPAWN_POINTS.find(s => s.team === p.team) ?? SPAWN_POINTS[0]
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
    let bestDx = 0
    let bestDy = 0
    let bestLen = Infinity
    let found = false
    const consider = (tileL: number, tileR: number, tileT: number, tileB: number): void => {
      if (!(tileR > -halfW + 1e-3 && tileL < halfW - 1e-3 && tileB > -30 + 1e-3 && tileT < 16 - 1e-3)) return
      const d1 = tileL - halfW
      if (Math.abs(d1) < bestLen) { bestLen = Math.abs(d1); bestDx = d1; bestDy = 0; found = true }
      const d2 = tileR + halfW
      if (Math.abs(d2) < bestLen) { bestLen = Math.abs(d2); bestDx = d2; bestDy = 0; found = true }
      const d3 = tileB + 30
      if (Math.abs(d3) < bestLen) { bestLen = Math.abs(d3); bestDx = 0; bestDy = d3; found = true }
      const d4 = tileT - 16
      if (Math.abs(d4) < bestLen) { bestLen = Math.abs(d4); bestDx = 0; bestDy = d4; found = true }
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
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i]
      if (ob.hp <= 0) continue
      const lx = wrapDeltaX(wx, ob.x + ob.w / 2)
      const ly = wrapDeltaY(p.pos.y, ob.y + ob.h / 2)
      consider(lx - ob.w / 2, lx + ob.w / 2, ly - ob.h / 2, ly + ob.h / 2)
    }
    if (found) {
      p.pos.x = wrapX(p.pos.x + bestDx)
      p.pos.y = wrapY(p.pos.y + bestDy)
      moved = true
    } else {
      ensureFreePosition(terrain, obstacles, obstacleBroadBuckets, p)
      moved = true
      break
    }
  }
  return moved
}

/** 查找水平移动时阻挡玩家 p 的其他玩家（若已重叠、正在远离、相向擦肩而过或背靠墙体脱困则绝不阻挡） */
function findHorizontalPlayerBlocker(
  playerBroadBuckets: PlayerState[][],
  p: PlayerState,
  curX: number,
  curY: number,
  nx: number,
): PlayerState | null {
  const list = playerBroadBuckets[bucketIdx(nx)]
  if (!list || list.length === 0) return null
  for (let i = 0; i < list.length; i++) {
    const other = list[i]
    if (other.id === p.id) continue
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
    // 垂直方向不相交（含站在对方头顶 curY <= other.pos.y - 44）时不产生水平阻挡
    if ((curY + 16) <= (other.pos.y - 28) || (curY - 28) >= (other.pos.y + 16)) continue
    const curAbsDx = Math.abs(wrapDeltaX(curX, other.pos.x))
    const nextAbsDx = Math.abs(wrapDeltaX(nx, other.pos.x))
    // 1. 正在远离对方：绝不阻挡
    if (nextAbsDx >= curAbsDx - 1e-4) continue
    // 2. 新位置未进入 20px 身体宽度内：不阻挡
    if (nextAbsDx >= 20 - 1e-3) continue
    // 3. 若当前已经与对方发生身体重叠（curAbsDx < 19.5，例如同点出生或落入体内）：允许自由走开脱困，绝不锁死
    if (curAbsDx < 19.5) continue
    // 4. 若两人正在相向移动（互相按相反方向键擦肩通过）：允许顺畅穿过，避免两人在窄道/平地迎头顶死
    const moveDir = wrapDeltaX(curX, nx)
    if (moveDir * other.vel.x < -1) continue
    return other
  }
  return null
}

/** 查找玩家 p 下落时脚下踩到的其他玩家头顶（仅自上而下落到头顶时支撑，侧面/向上起跳绝不阻挡垂直移动） */
function findVerticalHeadSupportPlayer(
  playerBroadBuckets: PlayerState[][],
  p: PlayerState,
  curX: number,
  curY: number,
  ny: number,
  vyTotal: number,
): PlayerState | null {
  if (vyTotal < 0) return null
  const list = playerBroadBuckets[bucketIdx(curX)]
  if (!list || list.length === 0) return null
  for (let i = 0; i < list.length; i++) {
    const other = list[i]
    if (other.id === p.id) continue
    if (!other.deployed || !other.alive || other.respawnTimer > 0) continue
    if (Math.abs(wrapDeltaX(curX, other.pos.x)) >= 18) continue
    // 仅当起跳/下落前脚底位于对方头顶附近或上方（curY <= other.pos.y - 42），且本帧下落越过头顶平面（other.pos.y - 46）时才踩住头顶
    const headStandY = other.pos.y - 46
    const dyCur = wrapDeltaY(headStandY, curY)
    const dyNext = wrapDeltaY(headStandY, ny)
    if (dyCur <= 4 && dyNext >= -0.5 && dyNext <= 24) {
      return other
    }
  }
  return null
}

/** 权威端单玩家物理步进（含地形/掩体 AABB 滑动碰撞、其他玩家防卡死交互与弹射跳台） */
export function stepPlayerKinematic(
  p: PlayerState,
  _w: WorldInput,
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

  // 若进入步进前因外部因素轻微嵌墙，先做一次干净的最小轴推出，保证起点处于合法自由态
  if (checkBodyOverlapsAt(terrain, obstacles, p.pos.x, p.pos.y, obstacleBroadBuckets)) {
    resolvePenetration(terrain, obstacles, obstacleBroadBuckets, p)
  }

  // 位移 = 常规速度 + 独立后坐力速度（后者不受移动覆写/重力/速度上限影响 → 各向同性）
  if (!p.recoilVel) p.recoilVel = { x: 0, y: 0 }
  const rv = p.recoilVel
  const curX = p.pos.x
  const curY = p.pos.y
  const dxMove = p.vel.x * dt + rv.x * RECOIL_DISPLACEMENT_FACTOR
  const nx = wrapX(curX + dxMove)

  // ── 1. 水平轴 (X) 独立碰撞消解（绝不修改 Y，彻底杜绝墙角按方向键被卡在半空或顶进天花板） ──
  if (Math.abs(dxMove) > 1e-6) {
    if (checkBodyOverlapsAt(terrain, obstacles, nx, curY, obstacleBroadBuckets)) {
      // 二分逼近墙面，使角色平滑贴合墙壁而不嵌入墙体，确保垂直轴可自由上下滑动
      let lo = 0
      let hi = 1
      for (let s = 0; s < 5; s++) {
        const mid = (lo + hi) * 0.5
        const tx = wrapX(curX + dxMove * mid)
        if (!checkBodyOverlapsAt(terrain, obstacles, tx, curY, obstacleBroadBuckets)) lo = mid
        else hi = mid
      }
      p.pos.x = wrapX(curX + dxMove * lo)
      p.vel.x = 0
      rv.x = 0 // 撞墙：该轴后坐力被墙吸收
    } else {
      const dir = Math.sign(dxMove)
      const pinnedBehindByWall = checkBodyOverlapsAt(terrain, obstacles, wrapX(curX - dir * 3), curY, obstacleBroadBuckets)
      const blocker = (!pinnedBehindByWall && playerBroadBuckets)
        ? findHorizontalPlayerBlocker(playerBroadBuckets, p, curX, curY, nx)
        : null
      if (blocker && playerBroadBuckets) {
        tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, blocker, dir, 1.6)
        // 推开对方后，自身贴合到对方身侧 20px 处（若不嵌墙）
        const targetX = wrapX(blocker.pos.x - dir * 20)
        const stepToward = wrapDeltaX(curX, targetX)
        if (
          stepToward * dir > 0 &&
          Math.abs(stepToward) <= Math.abs(dxMove) + 1e-3 &&
          !checkBodyOverlapsAt(terrain, obstacles, targetX, curY, obstacleBroadBuckets)
        ) {
          p.pos.x = targetX
        }
        p.vel.x = 0
        rv.x = 0
      } else {
        p.pos.x = nx
      }
    }
  }

  // ── 2. 垂直轴 (Y) 独立碰撞消解（与水平墙体完全解耦，贴墙/墙角按住方向键时仍可丝滑跳跃、飞行与下落） ──
  const vyTotal = p.vel.y + rv.y
  const dyMove = p.vel.y * dt + rv.y * RECOIL_DISPLACEMENT_FACTOR
  const ny = wrapY(p.pos.y + dyMove)
  const headSupport = playerBroadBuckets
    ? findVerticalHeadSupportPlayer(playerBroadBuckets, p, p.pos.x, p.pos.y, ny, vyTotal)
    : null

  if (checkBodyOverlapsAt(terrain, obstacles, p.pos.x, ny, obstacleBroadBuckets)) {
    let lo = 0
    let hi = 1
    for (let s = 0; s < 5; s++) {
      const mid = (lo + hi) * 0.5
      const ty = wrapY(p.pos.y + dyMove * mid)
      if (!checkBodyOverlapsAt(terrain, obstacles, p.pos.x, ty, obstacleBroadBuckets)) lo = mid
      else hi = mid
    }
    p.pos.y = wrapY(p.pos.y + dyMove * lo)
    p.onGround = vyTotal > 0
    p.vel.y = 0
    rv.y = 0 // 落地或顶天花板：垂直后坐力被吸收
  } else if (headSupport) {
    const standY = wrapY(headSupport.pos.y - 46)
    if (!checkBodyOverlapsAt(terrain, obstacles, p.pos.x, standY, obstacleBroadBuckets)) {
      p.pos.y = standY
    }
    p.onGround = true
    p.vel.y = 0
    rv.y = 0
  } else {
    p.pos.y = ny
    p.onGround = false
  }

  p.pos.x = wrapX(p.pos.x)
  p.pos.y = wrapY(p.pos.y)
  // 指数阻尼衰减（各向同性）
  stepRecoilVel(rv, dt)
}

/** 玩家重叠分离：利用宽相空间桶只检查同桶内距离 <20px 的玩家对，复杂度 O(N)，绝不把玩家推进墙体或天花板 */
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
      const absDy = Math.abs(wrapDeltaY(a.pos.y, b.pos.y))
      // 仅当两人确实处于上下踩头位置（垂直中心差 >= 30px，即 oy <= 16）时才向上托举上方玩家，且必须通过完整 AABB 校验
      if (oy > 0 && absDy >= 30 && oy <= ox) {
        const upper = wrapDeltaY(b.pos.y, a.pos.y) < 0 ? a : b
        const lower = upper === a ? b : a
        const upY = wrapY(lower.pos.y - 46)
        if (!checkBodyOverlapsAt(terrain, obstacles, upper.pos.x, upY, obstacleBroadBuckets)) {
          upper.pos.y = upY
          if (upper.vel.y > 0) upper.vel.y = 0
          upper.onGround = true
        }
      } else {
        const dir = Math.sign(wrapDeltaX(a.pos.x, b.pos.x)) || (a.id < b.id ? 1 : -1)
        const pushAmt = Math.min(2.0, Math.max(0.6, ox * 0.35))
        // 若某一方正在主动移动，优先轻推静止方，避免干扰正在按键脱离的玩家
        if (Math.abs(a.vel.x) > 1 && Math.abs(b.vel.x) <= 1) {
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, b, dir, pushAmt)
        } else if (Math.abs(b.vel.x) > 1 && Math.abs(a.vel.x) <= 1) {
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, a, -dir, pushAmt)
        } else {
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, b, dir, pushAmt)
          tryNudgePlayer(terrain, obstacles, obstacleBroadBuckets, playerBroadBuckets, a, -dir, pushAmt)
        }
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
