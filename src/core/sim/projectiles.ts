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
  obstacleAtBucket,
  findObstacleAt,
  lineBlockedByTerrain,
  truncateSegmentToFree,
  checkBodyOverlapsAt,
} from './spatial.ts'
import type { PlayerState, Projectile, Obstacle, WorldEvent, TeamId } from '../types.ts'

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

/** 高斯枪：按住即持续发射的反射光束（2 次镜面反射、连续 DPS、弹药按秒消耗） */
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
    x = cx
    y = cy
    originOk = true
  }
  if (!originOk) return
  const originX = x
  const originY = y
  // 每段独立射程，按「本段主导轴」取小于该轴绕世界一圈的距离：
  //   水平主导 → WORLD_W-200 (13000)，够"横跨地图左右的大房间"单段 11976；
  //   垂直主导 → WORLD_H-200 (4200)，避免竖直激光绕过世界上下接缝、从背面打回射手
  //              （实测：地面上朝正上方开火，2748px 后到顶接缝，绕到底部反射回来打中射手）。
  // 不能跨段累计预算——那会让大房间第二段被截断、反射次数变少。
  const segCapFor = (ddx: number, ddy: number): number =>
    Math.abs(ddx) >= Math.abs(ddy) ? WORLD_W - 200 : WORLD_H - 200
  const step = 4
  const bounces = wep.bounces ?? 0
  const headR = ctx.config.headRadius + 3
  const headRSq = headR * headR
  const tGrid = ctx.terrain.grid
  const obstacleBroadBuckets = ctx.obstacleBroadBuckets
  const playerBroadBuckets = ctx.playerBroadBuckets
  const obstacles = ctx.obstacles

  // 反射预算：真实镜面反射与「接缝穿透式反射」共享。每次穿越世界接缝消耗一次，
  // 因此激光不可能绕环面世界转很多周；但穿接缝时**方向不变、线段不拆**，视觉仍连续。
  let budget = bounces
  let b = 0
  while (b <= bounces) {
    let travelled = 0
    let hitWall = false
    let blockedByObstacle = false
    const segStartX = x
    const segStartY = y
    const dirX = dx       // 本段方向（反射会改 dx/dy，这里先存一份用于真实位移）
    const dirY = dy
    const stepX = dx * step
    const stepY = dy * step
    const maxSegLen = segCapFor(dirX, dirY)
    while (travelled < maxSegLen) {
      let nx = x + stepX
      let crossedSeam = false
      if (nx >= WORLD_W) { nx -= WORLD_W; crossedSeam = true }
      else if (nx < 0) { nx += WORLD_W; crossedSeam = true }
      let ny = y + stepY
      if (ny >= WORLD_H) { ny -= WORLD_H; crossedSeam = true }
      else if (ny < 0) { ny += WORLD_H; crossedSeam = true }

      // 接缝 → 一次「穿透式反射」：不改变方向、不拆线段（保持连续），只扣反射预算。
      if (crossedSeam) {
        if (budget <= 0) { hitWall = false; break }   // 预算耗尽：射程尽头自然终止
        budget--
      }

      const gx = (nx / 20) | 0
      const gy = (ny / 20) | 0
      if (tGrid[gy * GRID_W + gx] !== 0) {
        hitWall = true
        // 反射点必须退回到「最后一个空点」（x,y 当前就是），绝不能让下一段从墙体内部出发，
        // 否则下一段的真实位移会算成"从墙内穿出"（实测会得到 dx≈±13176 这类荒谬值），
        // 进而让反射光束打到墙背面的目标。
        const prevGx = (x / 20) | 0
        const prevGy = (y / 20) | 0
        const hitX = tGrid[prevGy * GRID_W + gx] !== 0
        const hitY = tGrid[gy * GRID_W + prevGx] !== 0
        if (hitX) dx = -dx
        if (hitY) dy = -dy
        if (!hitX && !hitY) { dx = -dx; dy = -dy }
        break
      }

      const bIdx = (nx * INV_BUCKET_SIZE) | 0
      const obsList = obstacleBroadBuckets[bIdx]
      if (obsList && obsList.length > 0) {
        const ob = obstacleAtBucket(obsList, nx, ny, 0)
        if (ob) {
          if (!hitObstacle.has(ob.id)) {
            hitObstacle.add(ob.id)
            ctx.damageObstacle(ob, dps * dt, undefined)
          }
          x = nx
          y = ny
          blockedByObstacle = true
          break
        }
      }

      const pList = playerBroadBuckets[bIdx]
      if (pList && pList.length > 0) {
        for (let pi = 0; pi < pList.length; pi++) {
          const t = pList[pi]
          // 自伤：第一段（枪口出发）不伤自己，只有反射回来的光束且开启 selfDamage 才会打到自己
          if (t.id === p.id && b === 0) continue
          if (t.id === p.id && !wep.selfDamage) continue
          if (t.id !== p.id && t.team === p.team && p.team !== 'ffa' && !wep.friendlyFire) continue
          if (t.respawnTimer > 0 || !t.deployed || !t.alive || hitPlayer.has(t.id)) continue
          const rawDy = Math.abs(t.pos.y - ny)
          if (rawDy > 40 && rawDy < WORLD_H - 40) continue
          const hx = wrapDeltaX(t.pos.x, nx)
          if (hx > 18 || hx < -18) continue
          const hy = wrapDeltaY(t.pos.y - 24, ny)
          const isHead = (hx * hx + hy * hy) <= headRSq
          const bx = Math.abs(hx)
          const by = wrapDeltaY(t.pos.y, ny)
          if (isHead || (bx <= 14 && by >= -12 && by <= 18)) {
            // 用「本步真实方向 × 到枪口的距离」做遮挡判定：跨接缝时 wrapDelta 会反向
            if (lineBlockedByTerrain(
              ctx.terrain, obstacles, obstacleBroadBuckets,
              segStartX, segStartY, t.pos.x, t.pos.y - 12,
              dirX * travelled, dirY * travelled,
            )) continue
            hitPlayer.add(t.id)
            const mult = isHead ? wep.headshotMult : 1
            ctx.damagePlayer(t, dps * mult * dt, undefined, isHead, false, p.id, p.team, wep.shortName)
          }
        }
      }

      x = nx
      y = ny
      travelled += step
    }
    if (hitWall && ctx.terrain.isSolidAt(wrapX(x + dx * step), wrapY(y + dy * step))) {
      hitWall = false
    }
    // 段起点必须是本段真实的起点（segStartX/Y），不能用上一段"截断后"的端点：
    // 截断会把上段端点拉回墙前，若拿它当本源点，本源点与 rawDx 就错位，
    // 真实位移会算出 dx≈±13176 这种荒谬值（并让反射光束打到墙背面）。
    const seg = { x1: segStartX, y1: segStartY, x2: x, y2: y, dx: 0, dy: 0 }
    // 真实（未 wrap）位移：单段可能 > 半世界（如地面→天花板 2440px），
    // 用 wrapDelta 会折叠成反向最短路径 → 段被截成几像素、反射丢失。
    const rawDx = dirX * travelled
    const rawDy = dirY * travelled
    const cut = truncateSegmentToFree(ctx.terrain, seg.x1, seg.y1, seg.x2, seg.y2, rawDx, rawDy)
    seg.x2 = cut.x
    seg.y2 = cut.y
    seg.dx = cut.dx
    seg.dy = cut.dy
    segments.push(seg)
    if (cut.shortened) break
    if (blockedByObstacle || !hitWall) break
    if (budget <= 0) break
    budget--
    b++
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
    const headHitRSq = headHitR * headHitR
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

      // A. 玩家命中判定
      let hit = false
      const pList = playerBroadBuckets[bIdx]
      if (pList && pList.length > 0) {
        for (let ti = 0; ti < pList.length; ti++) {
          const t = pList[ti]
          if (t.id !== pr.owner && t.team === ownerTeam && t.team !== 'ffa' && !allowFF) continue
          if (t.id === pr.owner && !allowSelf) continue
          if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
          const rawDy = Math.abs(t.pos.y - ny)
          if (rawDy > 42 && rawDy < WORLD_H - 42) continue
          if (pr.hitTargets.includes(t.id)) continue
          const dxHead = wrapDeltaX(t.pos.x, nx)
          const dxBody = Math.abs(dxHead)
          if (dxBody > Math.max(headHitR, bodyHalfX)) continue
          const dyHead = wrapDeltaY(t.pos.y - 24, ny)
          if (dxHead * dxHead + dyHead * dyHead <= headHitRSq) {
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
          if (dxBody <= bodyHalfX && dyBody >= -12 && dyBody <= 18) {
            pr.hitTargets.push(t.id)
            if (pr.explosive) {
              ctx.explode(nx, ny, pr.terrainRadius, pr.damage * calcProjectileFalloff(ctx, pr, nx, ny), 900, pr)
              hit = true
            } else {
              let dmg = Math.round(pr.damage)
              // 狙击碰撞箱边缘规则：打中碰撞箱边缘才造成 edgeDamage(99)，近/远距离命中身体主体均保持 100 伤害
              if (wep?.edgeDamage !== undefined && isProjectileBodyEdgeHit(dxHead, dyBody, pr.vel.x, pr.vel.y, bodyHalfX)) {
                dmg = Math.min(dmg, wep.edgeDamage)
              } else if (wep?.farRange && pr.weaponId === 2) {
                const owner = ctx.playerById.get(pr.owner) ?? ctx.players.find(x => x.id === pr.owner)
                if (owner) {
                  const dShot = wrapDist(owner.pos.x, owner.pos.y - 12, t.pos.x, t.pos.y - 12)
                  if (dShot > wep.farRange) dmg = Math.min(dmg, wep.farDamage ?? dmg)
                }
              }
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
