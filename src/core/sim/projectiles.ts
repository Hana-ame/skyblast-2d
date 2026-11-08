// core/sim/projectiles.ts —— 弹道子系统 (stepProjectiles)：
//   常规弹丸子步进、高斯枪 2 次反射光线追踪、引力枪力场弯折与持续牵引、客户端弹丸本地推算 (Dead Reckoning)
import { getPhysicsParams } from './physics.ts'
import { GRID_W } from '../terrain.ts'
import type { Terrain } from '../terrain.ts'
import { WEAPONS, weaponFalloff } from '../weapons.ts'
import type { WeaponDef, GameConfig } from '../weapons.ts'
import { WORLD_W, WORLD_H, wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist } from '../wrap.ts'
import {
  INV_BUCKET_SIZE,
  bucketIdx,
  obstacleAtBucket,
  findObstacleAt,
  lineBlockedByTerrain,
  truncateSegmentToFree,
  checkBodyOverlapsAt,
} from './spatial.ts'
import type { PlayerState, Projectile, Obstacle, WorldEvent, TeamId } from '../types.ts'

/** 玩家开启能量护盾时的额外碰撞箱外扩半径（px） */
export const SHIELD_HITBOX_PAD = 8

export interface ProjectileContext {
  terrain: Terrain
  players: PlayerState[]
  playerById: Map<number, PlayerState>
  playerBroadBuckets: PlayerState[][]
  obstacles: Obstacle[]
  obstacleBroadBuckets: Obstacle[][]
  projectiles: Projectile[]
  activeGravityOrbs: Projectile[]
  events: WorldEvent[]
  config: GameConfig
  ownerTeamOf(ownerId: number): TeamId
  startReload(p: PlayerState): void
  damagePlayer(
    target: PlayerState,
    dmg: number,
    pr?: Projectile,
    headshot?: boolean,
    piercing?: boolean,
    attackerIdOverride?: number,
    attackerTeamOverride?: TeamId,
    weaponLabelOverride?: string,
  ): void
  damageObstacle(ob: Obstacle, dmg: number, pr?: Projectile): void
  explode(
    x: number,
    y: number,
    radius: number,
    maxDamage: number,
    knockback: number,
    srcProj?: Projectile,
    ownerIdOverride?: number,
    ownerTeamOverride?: TeamId,
    weaponLabelOverride?: string,
    implosion?: boolean,
  ): void
}

/** 构造弹丸实体 */
export function createProjectile(
  id: number,
  owner: PlayerState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  opts: {
    damage: number
    headshotMult: number
    terrainRadius: number
    explosive: boolean
    gravityScale: number
    pierceOnHeadshot?: boolean
    pierceAll?: boolean
    isGravityOrb?: boolean
    bounces?: number
    passWalls?: boolean
    beam?: boolean
    rocket?: boolean
    dragPerSecond?: number
    weaponId?: number
    curveRate?: number
    weaponLabel: string
    color: string
    r: number
    life: number
  },
): Projectile {
  return {
    id,
    owner: owner.id,
    pos: { x: wrapX(x), y },
    vel: { x: vx, y: vy },
    spawnX: wrapX(x),
    spawnY: y,
    weaponId: opts.weaponId ?? -1,
    curveRate: opts.curveRate ?? 0,
    life: opts.life,
    r: opts.r,
    damage: opts.damage,
    headshotMult: opts.headshotMult,
    explosive: opts.explosive,
    terrainRadius: opts.terrainRadius,
    gravityScale: opts.gravityScale,
    pierceOnHeadshot: opts.pierceOnHeadshot ?? false,
    pierceAll: opts.pierceAll ?? false,
    isGravityOrb: opts.isGravityOrb ?? false,
    bounces: opts.bounces ?? 0,
    passWalls: opts.passWalls ?? false,
    beam: opts.beam ?? false,
    rocket: opts.rocket ?? false,
    dragPerSecond: opts.dragPerSecond ?? 1,
    weaponLabel: opts.weaponLabel,
    color: opts.color,
    hitTargets: [owner.id],
  }
}

export function calcProjectileFalloff(ctx: ProjectileContext, pr: Projectile, hitX: number, hitY: number): number {
  if (pr.weaponId < 0) return 1
  const wep = WEAPONS[pr.weaponId]
  if (!wep) return 1
  const d = wrapDist(pr.spawnX ?? pr.pos.x, pr.spawnY ?? pr.pos.y, hitX, hitY)
  return weaponFalloff(wep, d, ctx.config.falloffExponent)
}

/** 判断弹丸命中玩家身体碰撞箱（[-bodyHalfX, +bodyHalfX] × [-12, +18]）时是否属于「碰撞箱边缘擦边命中」：
 *  计算弹道直线穿过身体 AABB 的线段中点 (midX, midY) 与弦长，
 *  当弹道仅擦过水平外侧边缘（|midX| > 10，超出躯干物理半宽 BODY_HALF_W=10）、
 *  底部边缘（midY > 13.5，擦到脚底边缘 13.5..18）或边角弦长 < 8px 时判定为碰撞箱边缘命中。 */
export function isProjectileBodyEdgeHit(
  rx: number,
  ry: number,
  vx: number,
  vy: number,
  bodyHalfX: number,
): boolean {
  const spd = Math.hypot(vx, vy)
  if (spd < 1e-6) return Math.abs(rx) > 10 || ry > 13.5
  const ux = vx / spd
  const uy = vy / spd

  let sMinX = -1e9
  let sMaxX = 1e9
  if (Math.abs(ux) > 1e-6) {
    const sx1 = (-bodyHalfX - rx) / ux
    const sx2 = (bodyHalfX - rx) / ux
    sMinX = Math.min(sx1, sx2)
    sMaxX = Math.max(sx1, sx2)
  }

  let sMinY = -1e9
  let sMaxY = 1e9
  if (Math.abs(uy) > 1e-6) {
    const sy1 = (-12 - ry) / uy
    const sy2 = (18 - ry) / uy
    sMinY = Math.min(sy1, sy2)
    sMaxY = Math.max(sy1, sy2)
  }

  const sEnter = Math.max(sMinX, sMinY)
  const sExit = Math.min(sMaxX, sMaxY)
  const chord = sExit - sEnter
  const sMid = chord >= 0 ? 0.5 * (sEnter + sExit) : 0
  const midX = Math.abs(rx + sMid * ux)
  const midY = ry + sMid * uy

  return midX > 10 || midY > 13.5 || (chord >= 0 && chord < 8)
}

/**
 * 分级擦边命中质量（0..1）——用于「命中主体满伤、越靠边缘越少」的武器（突击步枪）。
 *   1 = 正中身体主体（弦长饱满、中心接近躯干中心）
 *   0 = 仅擦到碰撞箱边角
 * 依据：弹道穿过身体 AABB 的弦长（越短越擦边）+ 穿点中心距躯干中心的横向偏移。
 */
export function projectileBodyHitQuality(
  /** 命中瞬间弹丸相对玩家中心（头中心）的横向偏移（已 wrap，可正可负） */
  dxToCenter: number,
  /** 命中瞬间弹丸相对玩家脚底的纵向偏移 */
  dyToFeet: number,
  /** 弹丸速度：用来求弹道穿过身体 AABB 的实际弦长 */
  vx: number,
  vy: number,
  bodyHalfX: number,
): number {
  // 关键：弹丸判定发生在「首次进入碰撞箱」的那一步，所以命中点几乎总在边缘。
  // 真正能反映「打得正不正」的是**弹道穿过身体的弦长**：
  //   平直穿过躯干中心 → 弦长≈整个躯干高度（30px）→ 满伤
  //   擦过肩/脚/侧面 → 弦长很短 → 最低伤
  const spd = Math.hypot(vx, vy)
  const TOP = -12, BOTTOM = 18
  const halfY = (BOTTOM - TOP) * 0.5
  const centerY = (BOTTOM + TOP) * 0.5

  if (spd < 1e-6) return 1
  const ux = vx / spd
  const uy = vy / spd
  // 沿弹道方向，与 AABB（横 [-halfX, halfX]、纵 [TOP, BOTTOM]）相交的弦长
  let sMin = -1e9
  let sMax = 1e9
  const slab = (o: number, u: number, lo: number, hi: number): void => {
    if (Math.abs(u) < 1e-9) return
    const t1 = (lo - o) / u
    const t2 = (hi - o) / u
    sMin = Math.max(sMin, Math.min(t1, t2))
    sMax = Math.min(sMax, Math.max(t1, t2))
  }
  slab(dxToCenter, ux, -bodyHalfX, bodyHalfX)
  slab(dyToFeet, uy, TOP, BOTTOM)
  const chord = sMax - sMin
  if (chord <= 0) return 0
  // 弦长饱满度（0..1）：穿过长度达到「躯干高度」视为满
  const fullness = Math.min(1, chord / (halfY * 2))
  // 穿点的居中程度：同时看纵向（靠肩/脚）和横向（靠身侧）
  const midAlong = (sMin + sMax) * 0.5
  const midY = dyToFeet + midAlong * uy
  const midX = dxToCenter + midAlong * ux
  const offY = Math.min(1, Math.abs(midY - centerY) / halfY)
  const offX = Math.min(1, Math.abs(midX) / Math.max(1e-6, bodyHalfX))
  // 取较差的一维：垂直弹看横向偏移，水平弹看纵向高度
  const off = Math.max(offY, offX)
  const centered = 1 - off * 0.5
  // 主体：弦长为主（70%），居中度占 30%
  const raw = fullness * 0.7 + centered * 0.3
  // 分段映射（raw: 0=擦边, 1=完美穿心）→ 质量：
  //   raw 0.00~0.55 → 质量 0.00~0.42（30~33，真正的擦边惩罚）
  //   raw 0.55~0.85 → 质量 0.42~0.62（33~34，绝大多数命中落这里）
  //   raw 0.85~1.00 → 质量 0.62~1.00（35~37，只有正中穿心才满伤）
  // 目标分布：擦边 30~32 占少数，绝大多数命中落在 33~34，只有极正中的穿心才到 36~37。
  // raw 0.00~0.60 → 质量 0.00~0.30（30~32）
  // raw 0.60~0.90 → 质量 0.30~0.50（32~33.5，主群体）
  // raw 0.90~1.00 → 质量 0.50~1.00（33.5~37，只有穿心）
  let q: number
  if (raw <= 0.60) q = (raw / 0.60) * 0.30
  else if (raw <= 0.90) q = 0.30 + ((raw - 0.60) / 0.30) * 0.20
  else q = 0.50 + ((raw - 0.90) / 0.10) * 0.50
  return Math.max(0, Math.min(1, q))
}

/** 判定光束采样点 (px, py) 是否命中玩家 t（含护盾开启时稍微扩大的碰撞箱） */
function isPointInPlayerBeamHitbox(
  t: PlayerState,
  px: number,
  py: number,
  baseHeadR: number,
): { isHead: boolean } | null {
  const shieldPad = (t.shieldTimer > 0 && t.shieldHp > 0) ? SHIELD_HITBOX_PAD : 0
  const rawDy = Math.abs(t.pos.y - py)
  if (rawDy > 40 + shieldPad && rawDy < WORLD_H - (40 + shieldPad)) return null
  const hx = wrapDeltaX(t.pos.x, px)
  const maxHalfX = 18 + shieldPad
  if (hx > maxHalfX || hx < -maxHalfX) return null
  const hy = wrapDeltaY(t.pos.y - 24, py)
  const effHeadR = baseHeadR + shieldPad
  const isHead = (hx * hx + hy * hy) <= effHeadR * effHeadR
  const bx = Math.abs(hx)
  const by = wrapDeltaY(t.pos.y, py)
  if (isHead || (bx <= 14 + shieldPad && by >= -12 - shieldPad && by <= 18 + shieldPad)) {
    return { isHead }
  }
  return null
}

/**
 * 高斯枪：按住即持续发射的反射光束
 * 反射、跨地图缝隙与自伤规则：
 *   1. 碰到障碍物（原始实心地形或可破坏障碍物）时：改变方向（光线沿着表面反射），反射次数 -1
 *   2. 穿过地图缝隙时：不改变方向，为了防止无限长度，反射次数 -1
 *   3. 当反射次数归零后（bouncesLeft <= 0）：不再反射，也不再穿透地图缝隙
 *   4. 自伤保护：发射出去的初始段不会扣发射者自己的血（且贴地图缝发射时需先穿出自身碰撞箱），
 *      经障碍物反射或跨地图缝绕回命中发射者时正常结算自伤
 */
export function updateContinuousBeam(
  ctx: ProjectileContext,
  p: PlayerState,
  wep: WeaponDef,
  dt: number,
): void {
  if (p.respawnTimer > 0 || !p.alive) return
  const wi = p.weaponIndex
  if (p.reloading) return
  if (p.ammo[wi] <= 0) {
    ctx.startReload(p)
    return
  }
  const dps = wep.damagePerSecond ?? wep.damage * 3
  const aps = wep.ammoPerSecond ?? 6
  p.ammo[wi] = Math.max(0, p.ammo[wi] - aps * dt)
  if (p.ammo[wi] <= 0 && (p.reserveAmmo[wi] || 0) > 0) ctx.startReload(p)

  const segments: { x1: number; y1: number; x2: number; y2: number; dx?: number; dy?: number }[] = []
  const hitPlayer = new Set<number>()
  const hitObstacle = new Set<string>()

  let dx = Math.cos(p.aim)
  let dy = Math.sin(p.aim)
  // 枪口起点：沿瞄准方向从 4px 起按 4px 步进走到 24px，取「第一个实体之前」的最远空点
  let x = 0
  let y = 0
  let originOk = false
  for (let ahead = 4; ahead <= 24; ahead += 4) {
    const cx = wrapX(p.pos.x + dx * ahead)
    const cy = wrapY((p.pos.y - 12) + dy * ahead)
    if (ctx.terrain.isSolidAt(cx, cy) || findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, cx, cy)) break
    if (ahead > 4) {
      const nxProbe = wrapX(cx + dx * 4)
      const nyProbe = wrapY(cy + dy * 4)
      if (ctx.terrain.isSolidAt(nxProbe, nyProbe) || findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, nxProbe, nyProbe)) break
    }
    x = cx
    y = cy
    originOk = true
  }
  if (!originOk) return

  const step = 4
  let bouncesLeft = wep.bounces ?? 2
  const headR = ctx.config.headRadius + 3
  const tGrid = ctx.terrain.grid
  const obstacleBroadBuckets = ctx.obstacleBroadBuckets
  const playerBroadBuckets = ctx.playerBroadBuckets
  const obstacles = ctx.obstacles

  // 防止任意角度发射激光扣自己血：
  // 1) 初始直射段（未发生任何障碍物反射或跨地图缝隙前）绝不自伤；
  // 2) 若贴着地图缝隙朝外发射，跨缝瞬间仍处于自身碰撞箱内，需等光束真正离开自身碰撞箱 (exitedSelf) 后才允许自伤；
  // 3) 一旦发生障碍物表面反射，或跨缝并离开自身碰撞箱后绕回，立即对发射者生效自伤。
  let hasReflectedOrWrapped = false
  let exitedSelf = !isPointInPlayerBeamHitbox(p, x, y, headR)

  const checkPlayersAt = (
    px: number,
    py: number,
    segStartX: number,
    segStartY: number,
    dirX: number,
    dirY: number,
    distFromSegStart: number,
  ): void => {
    if (!exitedSelf && !isPointInPlayerBeamHitbox(p, px, py, headR)) {
      exitedSelf = true
    }
    const bIdx = bucketIdx(px)
    const pList = playerBroadBuckets[bIdx]
    if (!pList || pList.length === 0) return
    for (let pi = 0; pi < pList.length; pi++) {
      const t = pList[pi]
      if (t.id === p.id) {
        if (!wep.selfDamage || !hasReflectedOrWrapped || !exitedSelf) continue
      } else if (t.team === p.team && p.team !== 'ffa' && !wep.friendlyFire) {
        continue
      }
      if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue
      const hitInfo = isPointInPlayerBeamHitbox(t, px, py, headR)
      if (!hitInfo) continue
      if (lineBlockedByTerrain(
        ctx.terrain, obstacles, obstacleBroadBuckets,
        segStartX, segStartY, t.pos.x, t.pos.y - 12,
        dirX * distFromSegStart, dirY * distFromSegStart,
      )) continue
      hitPlayer.add(t.id)
      const mult = hitInfo.isHead ? wep.headshotMult : 1
      ctx.damagePlayer(t, dps * mult * dt, undefined, hitInfo.isHead, false, p.id, p.team, wep.shortName)
    }
  }

  const pushBeamSegment = (x1: number, y1: number, x2: number, y2: number, rawDx: number, rawDy: number) => {
    if (Math.hypot(rawDx, rawDy) <= 1e-6) return null
    const cut = truncateSegmentToFree(ctx.terrain, x1, y1, x2, y2, rawDx, rawDy)
    segments.push({ x1, y1, x2: cut.x, y2: cut.y, dx: cut.dx, dy: cut.dy })
    return cut
  }

  let segStartX = x
  let segStartY = y
  let travelled = 0
  let stepsCount = 0
  const maxTotalSegments = Math.max(16, (wep.bounces ?? 2) + 2)
  const maxSingleSegLen = Math.ceil(Math.hypot(WORLD_W, WORLD_H)) + 32
  const maxTotalSteps = Math.ceil((maxSingleSegLen * 8) / step)

  while (segments.length < maxTotalSegments && stepsCount < maxTotalSteps) {
    stepsCount++
    const dirX = dx
    const dirY = dy
    const rawNx = x + dirX * step
    const rawNy = y + dirY * step
    const crossedSeam = rawNx < 0 || rawNx >= WORLD_W || rawNy < 0 || rawNy >= WORLD_H
    const nx = wrapX(rawNx)
    const ny = wrapY(rawNy)

    // 1. 穿过地图缝隙时：方向不变，反射次数 -1；反射次数归零后不再穿透地图缝隙
    if (crossedSeam) {
      const gxAfter = (nx / 20) | 0
      const gyAfter = (ny / 20) | 0
      const nextIsTerrain = tGrid[gyAfter * GRID_W + gxAfter] !== 0
      const nextObsList = obstacleBroadBuckets[bucketIdx(nx)]
      const nextOb = (!nextIsTerrain && nextObsList && nextObsList.length > 0)
        ? obstacleAtBucket(nextObsList, nx, ny, 0)
        : null
      const nextIsFree = !nextIsTerrain && !nextOb

      if (nextIsFree) {
        bouncesLeft--
        if (bouncesLeft <= 0) {
          if (travelled > 0) {
            pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled)
          }
          break
        }
        const segLen = travelled + step
        pushBeamSegment(segStartX, segStartY, nx, ny, dirX * segLen, dirY * segLen)
        hasReflectedOrWrapped = true
        x = nx
        y = ny
        segStartX = nx
        segStartY = ny
        travelled = 0
        checkPlayersAt(nx, ny, segStartX, segStartY, dirX, dirY, 0)
        continue
      }
      // 跨缝处紧贴实心地形或障碍物：若反射次数已归零，直接在缝前结段终止，不再穿透地图缝隙
      if (bouncesLeft <= 0) {
        if (travelled > 0) {
          pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled)
        }
        break
      }
    }

    // 2. 碰到原始实心地形障碍物：改变方向（光线沿着表面反射），反射次数 -1；反射次数归零后不再反射
    const gx = (nx / 20) | 0
    const gy = (ny / 20) | 0
    if (tGrid[gy * GRID_W + gx] !== 0) {
      if (travelled > 0) {
        const cut = pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled)
        if (cut && cut.shortened) {
          x = cut.x
          y = cut.y
        }
      }
      if (bouncesLeft <= 0) break
      bouncesLeft--
      const prevGx = (x / 20) | 0
      const prevGy = (y / 20) | 0
      const hitX = tGrid[prevGy * GRID_W + gx] !== 0
      const hitY = tGrid[gy * GRID_W + prevGx] !== 0
      if (hitX) dx = -dx
      if (hitY) dy = -dy
      if (!hitX && !hitY) { dx = -dx; dy = -dy }
      if (ctx.terrain.isSolidAt(wrapX(x + dx * step), wrapY(y + dy * step))) break
      hasReflectedOrWrapped = true
      exitedSelf = true
      segStartX = x
      segStartY = y
      travelled = 0
      continue
    }

    // 3. 碰到可破坏障碍物：改变方向（光线沿着表面反射），反射次数 -1；反射次数归零后不再反射
    const bIdx = bucketIdx(nx)
    const obsList = obstacleBroadBuckets[bIdx]
    if (obsList && obsList.length > 0) {
      const ob = obstacleAtBucket(obsList, nx, ny, 0)
      if (ob) {
        // 先基于未销毁的障碍物几何计算碰撞面法线，再结算伤害（防止当帧打爆后 obstacleAtBucket 返回 null）
        const hitX = obstacleAtBucket([ob], nx, y, 0) !== null
        const hitY = obstacleAtBucket([ob], x, ny, 0) !== null
        if (!hitObstacle.has(ob.id)) {
          hitObstacle.add(ob.id)
          ctx.damageObstacle(ob, dps * dt, undefined)
        }
        if (travelled > 0) {
          const cut = pushBeamSegment(segStartX, segStartY, x, y, dirX * travelled, dirY * travelled)
          if (cut && cut.shortened) {
            x = cut.x
            y = cut.y
          }
        }
        if (bouncesLeft <= 0) break
        bouncesLeft--
        if (hitX) dx = -dx
        if (hitY) dy = -dy
        if (!hitX && !hitY) { dx = -dx; dy = -dy }
        hasReflectedOrWrapped = true
        exitedSelf = true
        segStartX = x
        segStartY = y
        travelled = 0
        continue
      }
    }

    // 4. 自由空间步进与玩家命中判定
    x = nx
    y = ny
    travelled += step
    checkPlayersAt(nx, ny, segStartX, segStartY, dirX, dirY, travelled)
  }

  ctx.events.push({
    kind: 'laser',
    x: p.pos.x,
    y: p.pos.y,
    segments,
    duration: 0.06,
    color: wep.color,
    playerId: p.id,
    weaponLabel: wep.shortName,
  })
}

/** 引力弹持续牵引（位移式）：把附近玩家朝弹体位置拉，碰撞安全 */
export function applyGravityOrbPull(
  terrain: Terrain,
  obstacles: Obstacle[],
  activeGravityOrbs: Projectile[],
  p: PlayerState,
  dt: number,
  obstacleBroadBuckets?: Obstacle[][],
): void {
  const RANGE = 260
  const MAX_PULL = 240
  const MIN_RATIO = 0.35
  let vx = 0
  let vy = 0
  for (let i = 0; i < activeGravityOrbs.length; i++) {
    const pr = activeGravityOrbs[i]
    if (!pr.isGravityOrb || pr.life <= 0) continue
    const dx = wrapDeltaX(p.pos.x, pr.pos.x)
    if (dx > RANGE || dx < -RANGE) continue
    const dy = wrapDeltaY(p.pos.y - 12, pr.pos.y)
    if (dy > RANGE || dy < -RANGE) continue
    const d = Math.hypot(dx, dy)
    if (d > RANGE || d < 8) continue
    const strength = MAX_PULL * (MIN_RATIO + (1 - MIN_RATIO) * (1 - d / RANGE))
    vx += (dx / d) * strength
    vy += (dy / d) * strength
  }
  if (vx === 0 && vy === 0) return
  const tryX = wrapX(p.pos.x + vx * dt)
  if (!checkBodyOverlapsAt(terrain, obstacles, tryX, p.pos.y, obstacleBroadBuckets)) p.pos.x = tryX
  const tryY = wrapY(p.pos.y + vy * dt)
  if (!checkBodyOverlapsAt(terrain, obstacles, p.pos.x, tryY, obstacleBroadBuckets)) p.pos.y = tryY
}

/** 弹道子步进（≤8px/步）+ 引力场弯折 + 空间桶加速命中判定 */
export function stepProjectilesSubsystem(ctx: ProjectileContext, dt: number): void {
  ctx.activeGravityOrbs.length = 0
  let writeIdx = 0
  for (let i = 0; i < ctx.projectiles.length; i++) {
    const pr = ctx.projectiles[i]
    if (pr.damage > 0 && pr.life > 0) {
      ctx.projectiles[writeIdx++] = pr
      if (pr.isGravityOrb && pr.life > 0) ctx.activeGravityOrbs.push(pr)
    } else {
      // 事件化：寿命耗尽/0 伤害清理 → 通知客户端移除
      ctx.events.push({ kind: 'projectile_destroy', projectileId: pr.id })
    }
  }
  ctx.projectiles.length = writeIdx

  const g = getPhysicsParams().gravity
  const SUBSTEP_PX = 8
  const tGrid = ctx.terrain.grid
  const playerBroadBuckets = ctx.playerBroadBuckets
  const obstacleBroadBuckets = ctx.obstacleBroadBuckets
  const hasOrbs = ctx.activeGravityOrbs.length > 0

  for (let pi = 0; pi < ctx.projectiles.length; pi++) {
    const pr = ctx.projectiles[pi]
    if (pr.life <= 0) continue

    if (pr.dragPerSecond < 1) {
      const k = Math.pow(pr.dragPerSecond, dt)
      pr.vel.x *= k
      pr.vel.y *= k
    }
    if (hasOrbs && !pr.isGravityOrb && !pr.beam) {
      const FIELD = 360
      for (let oi = 0; oi < ctx.activeGravityOrbs.length; oi++) {
        const orb = ctx.activeGravityOrbs[oi]
        if (orb.life <= 0) continue
        const dx = wrapDeltaX(pr.pos.x, orb.pos.x)
        if (dx > FIELD || dx < -FIELD) continue
        const dy = wrapDeltaY(pr.pos.y, orb.pos.y)
        if (dy > FIELD || dy < -FIELD) continue
        const d = Math.hypot(dx, dy)
        if (d > FIELD) continue
        const falloff = 1 - d / FIELD
        const cur = Math.atan2(pr.vel.y, pr.vel.x)
        const want = Math.atan2(dy, dx)
        let delta = want - cur
        while (delta > Math.PI) delta -= Math.PI * 2
        while (delta < -Math.PI) delta += Math.PI * 2
        const bend = Math.sign(delta) * Math.min(Math.abs(delta), (0.5 + 8.5 * falloff) * dt)
        const cosB = Math.cos(bend)
        const sinB = Math.sin(bend)
        const vx = pr.vel.x
        const vy = pr.vel.y
        pr.vel.x = vx * cosB - vy * sinB
        pr.vel.y = vx * sinB + vy * cosB
      }
    }
    pr.vel.y += g * pr.gravityScale * dt
    pr.life -= dt
    if (pr.life <= 0) continue

    const dx = pr.vel.x * dt
    const dy = pr.vel.y * dt
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(dist / SUBSTEP_PX))
    const sx = dx / steps
    const sy = dy / steps
    let dead = false
    const ownerTeam = ctx.ownerTeamOf(pr.owner)
    const wep = pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : undefined
    const allowFF = !!wep?.friendlyFire
    const allowSelf = !!wep?.selfDamage
    const headHitR = ctx.config.headRadius + pr.r
    const bodyHalfX = 13 + pr.r

    for (let step = 0; step < steps; step++) {
      const prevX = pr.pos.x
      const prevY = pr.pos.y
      let nx = prevX + sx
      if (nx >= WORLD_W) nx -= WORLD_W
      else if (nx < 0) nx += WORLD_W
      let ny = prevY + sy
      if (ny >= WORLD_H) ny -= WORLD_H
      else if (ny < 0) ny += WORLD_H
      pr.pos.x = nx
      pr.pos.y = ny

      const bIdx = (nx * INV_BUCKET_SIZE) | 0

      // A. 玩家命中判定（护盾开启时碰撞箱稍微扩大 SHIELD_HITBOX_PAD）
      let hit = false
      const pList = playerBroadBuckets[bIdx]
      if (pList && pList.length > 0) {
        for (let ti = 0; ti < pList.length; ti++) {
          const t = pList[ti]
          if (t.id !== pr.owner && t.team === ownerTeam && t.team !== 'ffa' && !allowFF) continue
          if (t.id === pr.owner && !allowSelf) continue
          if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
          const shieldPad = (t.shieldTimer > 0 && t.shieldHp > 0) ? SHIELD_HITBOX_PAD : 0
          const rawDy = Math.abs(t.pos.y - ny)
          if (rawDy > 42 + shieldPad && rawDy < WORLD_H - (42 + shieldPad)) continue
          if (pr.hitTargets.includes(t.id)) continue
          const tHeadHitR = headHitR + shieldPad
          const tHeadHitRSq = tHeadHitR * tHeadHitR
          const tBodyHalfX = bodyHalfX + shieldPad
          const dxHead = wrapDeltaX(t.pos.x, nx)
          const dxBody = Math.abs(dxHead)
          if (dxBody > Math.max(tHeadHitR, tBodyHalfX)) continue
          const dyHead = wrapDeltaY(t.pos.y - 24, ny)
          // 爆头仅在未开护盾（或命中真实头部圆）时按头部算；护盾外扩圈命中算躯干/护盾受击
          const isRealHead = (dxHead * dxHead + dyHead * dyHead) <= (headHitR * headHitR)
          if (isRealHead) {
            pr.hitTargets.push(t.id)
            const piercing = pr.pierceOnHeadshot || pr.pierceAll
            if (pr.explosive) {
              ctx.explode(nx, ny, pr.terrainRadius, pr.damage * pr.headshotMult * calcProjectileFalloff(ctx, pr, nx, ny), 960, pr)
              hit = true
            } else {
              ctx.damagePlayer(t, Math.round(pr.damage * pr.headshotMult * calcProjectileFalloff(ctx, pr, t.pos.x, t.pos.y - 24)), pr, true, piercing)
              t.vel.x += pr.vel.x * 0.12
              t.vel.y += pr.vel.y * 0.12 - 72
              if (!piercing) hit = true
            }
            if (hit) break
            continue
          }
          const dyBody = wrapDeltaY(t.pos.y, ny)
          const hitShieldHead = shieldPad > 0 && (dxHead * dxHead + dyHead * dyHead <= tHeadHitRSq)
          const hitBodyBox = dxBody <= tBodyHalfX && dyBody >= (-12 - shieldPad) && dyBody <= (18 + shieldPad)
          if (hitShieldHead || hitBodyBox) {
            pr.hitTargets.push(t.id)
            if (pr.explosive) {
              ctx.explode(nx, ny, pr.terrainRadius, pr.damage * calcProjectileFalloff(ctx, pr, nx, ny), 900, pr)
              hit = true
            } else {
              let dmg = Math.round(pr.damage)
              // 统一擦边分级（所有子弹类武器共用同一套规则）：
              //   命中主体 = damage，越靠碰撞箱边缘越低，最低 grazeDamageMin。
              //   狙击保留原有 edgeDamage(99) 作为额外上限（边缘命中不会超过 99）。
              if (wep?.grazeDamageMin !== undefined) {
                const q = projectileBodyHitQuality(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX)
                dmg = Math.round(wep.grazeDamageMin + (pr.damage - wep.grazeDamageMin) * q)
                if (wep.edgeDamage !== undefined) dmg = Math.min(dmg, wep.edgeDamage)
              } else if (wep?.edgeDamage !== undefined && isProjectileBodyEdgeHit(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX)) {
                dmg = Math.min(dmg, wep.edgeDamage)
              } else if (wep?.farRange && pr.weaponId === 2) {
                const owner = ctx.playerById.get(pr.owner) ?? ctx.players.find(x => x.id === pr.owner)
                if (owner) {
                  const dShot = wrapDist(owner.pos.x, owner.pos.y - 12, t.pos.x, t.pos.y - 12)
                  if (dShot > wep.farRange) dmg = Math.min(dmg, wep.farDamage ?? dmg)
                }
              }
              // 擦边分级只决定「基于命中质量的伤害」，随后照常施加距离衰减
              // （距离衰减必须能继续拉开近/远差距，不能被子弹的擦边下限压平）
              dmg = Math.round(dmg * calcProjectileFalloff(ctx, pr, t.pos.x, t.pos.y - 12))
              ctx.damagePlayer(t, dmg, pr, false, false)
              t.vel.x += pr.vel.x * 0.09
              t.vel.y += pr.vel.y * 0.09
              if (!pr.pierceAll) hit = true
            }
            if (hit) break
          }
        }
      }
      if (hit) { dead = true; break }

      // B. 可破坏障碍物
      const obsList = obstacleBroadBuckets[bIdx]
      if (obsList && obsList.length > 0) {
        const ob = obstacleAtBucket(obsList, nx, ny, pr.r)
        if (ob) {
          if (pr.explosive) {
            ctx.explode(nx, ny, pr.terrainRadius, pr.damage, 960, pr)
            dead = true
          } else {
            ctx.damageObstacle(ob, pr.damage, pr)
            if (!pr.pierceAll) dead = true
          }
          if (dead) break
        }
      }

      // C. 原始地形
      const gx = (nx / 20) | 0
      const gy = (ny / 20) | 0
      if (tGrid[gy * GRID_W + gx] !== 0) {
        if (pr.passWalls) continue
        if (pr.explosive) {
          ctx.explode(nx, ny, pr.terrainRadius, pr.damage, 960, pr)
          dead = true
          break
        }
        if (pr.bounces > 0) {
          const hitX = ctx.terrain.isSolidAt(nx, prevY)
          const hitY = ctx.terrain.isSolidAt(prevX, ny)
          pr.pos = { x: prevX, y: prevY }
          if (hitX) pr.vel.x = -pr.vel.x
          if (hitY) pr.vel.y = -pr.vel.y
          if (!hitX && !hitY) { pr.vel.x = -pr.vel.x; pr.vel.y = -pr.vel.y }
          pr.bounces--
          pr.hitTargets = [pr.owner]
          // 事件化：反弹（客户端本地推算据此校正）
          ctx.events.push({
            kind: 'projectile_bounce', projectileId: pr.id, playerId: pr.owner,
            weaponId: pr.weaponId, x: pr.pos.x, y: pr.pos.y,
            vx: pr.vel.x, vy: pr.vel.y, bounces: pr.bounces, life: pr.life,
          })
          break
        }
        dead = true
        break
      }
    }

    if (dead) {
      // 事件化：销毁（客户端移除本地推算弹丸）
      ctx.events.push({ kind: 'projectile_destroy', projectileId: pr.id })
      pr.life = 0
    }
  }
}

/** 客户端本地推算确定性直线/抛物线弹丸轨迹（用于弹丸事件化同步下的帧间推演） */
export function stepClientProjectilesDeadReckoning(projectiles: Projectile[], dt: number, terrain?: Terrain): void {
  const g = getPhysicsParams().gravity
  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i]
    if (pr.life <= 0) continue
    if (pr.dragPerSecond < 1) {
      const k = Math.pow(pr.dragPerSecond, dt)
      pr.vel.x *= k
      pr.vel.y *= k
    }
    pr.vel.y += g * pr.gravityScale * dt
    pr.pos.x = wrapX(pr.pos.x + pr.vel.x * dt)
    pr.pos.y = wrapY(pr.pos.y + pr.vel.y * dt)
    pr.life -= dt
    if (terrain && !pr.passWalls && pr.bounces <= 0 && terrain.isSolidAt(pr.pos.x, pr.pos.y)) {
      pr.life = 0
    }
  }
}
