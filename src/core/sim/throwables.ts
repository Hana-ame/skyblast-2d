// core/sim/throwables.ts —— 手雷、地雷、空袭与爆炸结算子系统 (stepExplosionsAndThrowables)
import type { Terrain } from '../terrain.ts'
import type { Rng } from '../rng.ts'
import { WEAPONS } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../wrap.ts'
import { bucketIdx, findObstacleAt } from './spatial.ts'
import { createProjectile } from './projectiles.ts'
import type {
  PlayerState, Projectile, Grenade, Landmine, Airstrike, Obstacle, Mortar, WorldEvent, TeamId,
} from '../types.ts'

export interface ThrowablesContext {
  terrain: Terrain
  players: PlayerState[]
  playerById: Map<number, PlayerState>
  playerBroadBuckets: PlayerState[][]
  obstacles: Obstacle[]
  obstacleBroadBuckets: Obstacle[][]
  projectiles: Projectile[]
  grenades: Grenade[]
  landmines: Landmine[]
  airstrikes: Airstrike[]
  mortars: Mortar[]
  scores: Record<string, number>
  events: WorldEvent[]
  config: GameConfig
  rng: Rng
  nextProjId: () => number
  onHitCount: () => void
  ownerTeamOf: (id: number) => TeamId
  recallDoll: (p: PlayerState, ev: 'doll_recall') => void
}

export function damageObstacleInWorld(ctx: ThrowablesContext, ob: Obstacle, dmg: number): void {
  if (ob.hp <= 0 || dmg <= 0) return
  ob.hp = Math.max(0, ob.hp - Math.round(dmg))
  if (ob.hp <= 0) {
    const idx = ctx.obstacles.findIndex(o => o.id === ob.id)
    if (idx >= 0) ctx.obstacles.splice(idx, 1)
    ctx.events.push({ kind: 'explosion', x: ob.x, y: ob.y, radius: 28 })
    ctx.events.push({ kind: 'obstacle_destroy', obstacleId: ob.id, x: ob.x, y: ob.y })
  }
}

export function damagePlayerInWorld(
  ctx: ThrowablesContext,
  t: PlayerState,
  amount: number,
  pr: Projectile | undefined,
  isHead: boolean,
  isPierced: boolean,
  attackerId?: number,
  attackerTeam?: TeamId,
  weaponLabel?: string,
): void {
  if (t.respawnTimer > 0 || !t.deployed || amount <= 0) return
  // 复活保护：隐身/无敌期间不结算任何伤害
  if ((t.spawnProtectTimer ?? 0) > 0) return
  const atkId = attackerId ?? pr?.owner ?? 0
  const atkTeam = attackerTeam ?? ctx.ownerTeamOf(atkId)
  const label = weaponLabel ?? pr?.weaponLabel ?? '未知'
  let remaining = amount
  if (t.shieldTimer > 0 && t.shieldHp > 0) {
    const absorbed = Math.min(t.shieldHp, remaining)
    t.shieldHp -= absorbed
    remaining -= absorbed
    if (t.shieldHp <= 0) {
      t.shieldHp = 0
      t.shieldTimer = 0
      ctx.events.push({ kind: 'shield', x: t.pos.x, y: t.pos.y, playerId: t.id })
      ctx.events.push({ kind: 'shield_break', x: t.pos.x, y: t.pos.y, playerId: t.id })
    }
    if (remaining <= 0) return
  }
  t.hp -= remaining
  ctx.events.push({
    kind: 'hit', x: t.pos.x, y: t.pos.y,
    victimId: t.id, attackerId: atkId, headshot: isHead, damage: remaining,
    weaponLabel: label, victimTeam: t.team, isHeadshot: isHead, isPierced,
  })
  ctx.onHitCount()
  if (t.hp > 0) return

  // 致死：替身人偶优先回溯
  if (t.doll && t.doll.timer > 0) {
    ctx.recallDoll(t, 'doll_recall')
    return
  }
  t.hp = 0
  t.alive = false
  t.deaths++
  t.respawnTimer = ctx.config.respawnDelay
  t.shieldHp = 0
  t.shieldTimer = 0
  t.watchtowerTimer = 0
  const mk = ctx.mortars.find(m => m.operatorId === t.id)
  if (mk) mk.operatorId = null
  const killer = ctx.playerById.get(atkId) ?? ctx.players.find(x => x.id === atkId)
  if (killer && atkId !== t.id) {
    killer.kills++
    if (ctx.scores[atkTeam] !== undefined) ctx.scores[atkTeam]++
  }
  ctx.events.push({
    kind: 'kill',
    // 新字段（联机协议/新表现层用）
    attackerId: atkId,
    victimId: t.id,
    weaponLabel: label,
    headshot: isHead,
    // 旧字段（killfeed / 死亡界面直接读名称与队伍，避免显示成「?」）
    killerId: atkId,
    killerName: killer?.name ?? '战场环境',
    killerTeam: atkTeam,
    victimName: t.name,
    victimTeam: t.team,
    isHeadshot: isHead,
    isPierced,
    x: t.pos.x,
    y: t.pos.y,
  })
}

export function explodeInWorld(
  ctx: ThrowablesContext,
  cx: number,
  cy: number,
  radius: number,
  maxDamage: number,
  knockback: number,
  pr?: Projectile,
  ownerId?: number,
  ownerTeam?: TeamId,
  weaponLabel?: string,
  implosion = false,
): void {
  const wCx = wrapX(cx)
  ctx.events.push({ kind: 'explosion', x: wCx, y: cy, radius })
  for (const ob of [...ctx.obstacles]) {
    const dx = wrapDeltaX(wCx, ob.x + ob.w / 2)
    const dOb = wrapDeltaY(ob.y, cy)
    const nearY = clamp(dOb, 0, ob.h)
    const dist = Math.hypot(Math.max(0, Math.abs(dx) - ob.w / 2), dOb - nearY)
    if (dist <= radius * 1.25) damageObstacleInWorld(ctx, ob, maxDamage * (1 - dist / (radius * 1.25)) + 30)
  }
  const hitR = radius * 1.35
  const atkId = ownerId ?? pr?.owner ?? 0
  const atkTeam = ownerTeam ?? ctx.ownerTeamOf(atkId)
  const label = weaponLabel ?? pr?.weaponLabel ?? '爆炸'
  const isGrenade = label === '手榴弹'
  const srcWep = pr && pr.weaponId >= 0 ? WEAPONS[pr.weaponId] : undefined
  // 手雷走全局配置；枪械走各自 WeaponDef；地雷/迫击炮等非枪械来源保持旧行为（不伤友军、可自伤）
  const ffAllowed = isGrenade ? ctx.config.grenadeFriendlyFire : (srcWep ? (srcWep.friendlyFire ?? false) : false)
  const selfAllowed = isGrenade ? ctx.config.grenadeSelfDamage : (srcWep ? (srcWep.selfDamage ?? false) : true)

  for (const t of ctx.players) {
    if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
    const dx = wrapDeltaX(wCx, t.pos.x)
    if (Math.abs(dx) > hitR) continue
    const dy = wrapDeltaY(cy, t.pos.y - 12)
    if (Math.abs(dy) > hitR) continue
    const dist = Math.hypot(dx, dy)
    if (dist > hitR) continue
    const falloff = Math.max(0.2, 1 - dist / hitR)
    const nx = dist > 0.1 ? dx / dist : 0
    const ny = dist > 0.1 ? dy / dist : -1
    const sign = implosion ? -0.85 : 1.0
    t.vel.x += nx * knockback * falloff * sign
    t.vel.y += (ny * knockback - 210) * falloff * sign
    const isSelf = t.id === atkId
    const isTeammate = !isSelf && t.team === atkTeam && t.team !== 'ffa'
    if (isTeammate && !ffAllowed) continue
    if (isSelf && !selfAllowed) continue
    const dmg = Math.round(maxDamage * falloff * (isSelf ? 0.25 : 1))
    const headDist = Math.hypot(dx, wrapDeltaY(cy, t.pos.y - 26))
    const isHead = headDist < ctx.config.headRadius * 1.6 && dist < radius * 0.6
    damagePlayerInWorld(ctx, t, isHead ? Math.round(dmg * 1.35) : dmg, pr, isHead, false, atkId, atkTeam, label)
  }
}

export function stepExplosionsAndThrowables(ctx: ThrowablesContext, dt: number): void {
  const g0 = 1250
  // 1. 手榴弹
  for (const g of ctx.grenades) {
    g.vel.y += g0 * 0.88 * dt
    g.vel.x *= 0.995
    const nx = wrapX(g.pos.x + g.vel.x * dt)
    if (ctx.terrain.isSolidAt(nx, g.pos.y) || findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, nx, g.pos.y)) g.vel.x *= -0.55
    else g.pos.x = nx
    const ny = g.pos.y + g.vel.y * dt
    if (ctx.terrain.isSolidAt(g.pos.x, ny) || findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, g.pos.x, ny)) {
      g.vel.y *= -0.45
      g.vel.x *= 0.78
      if (Math.abs(g.vel.y) < 72) {
        g.vel.y = 0
        g.vel.x *= 0.88
        if (Math.abs(g.vel.x) < 8) g.vel.x = 0
      }
    } else g.pos.y = wrapY(ny)
    g.fuse -= dt
    if (g.fuse <= 0) {
      explodeInWorld(ctx, g.pos.x, g.pos.y, ctx.config.grenadeRadius, ctx.config.grenadeDamage, 16 * 60, undefined, g.owner, undefined, '手榴弹')
      g.fuse = 0
    }
  }

  // 2. 地雷
  for (let i = ctx.landmines.length - 1; i >= 0; i--) {
    const m = ctx.landmines[i]
    if (m.respawnTimer > 0) {
      m.respawnTimer -= dt
      if (m.respawnTimer <= 0) { m.armed = true; m.triggered = false; m.fuse = 0; m.vel = { x: 0, y: 0 } }
      continue
    }
    if (!ctx.terrain.isSolidAt(m.pos.x, m.pos.y + 8) && !findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, m.pos.x, m.pos.y + 8)) {
      m.vel.y += g0 * 0.86 * dt
      const nx = wrapX(m.pos.x + m.vel.x * dt)
      if (!ctx.terrain.isSolidAt(nx, m.pos.y) && !findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, nx, m.pos.y)) m.pos.x = nx
      else m.vel.x = -(m.vel.x) * 0.35
      const ny = m.pos.y + m.vel.y * dt
      if (!ctx.terrain.isSolidAt(m.pos.x, ny + 8) && !findObstacleAt(ctx.obstacles, ctx.obstacleBroadBuckets, m.pos.x, ny + 8)) m.pos.y = wrapY(ny)
      else { m.vel.y = 0; m.vel.x *= 0.35; if (Math.abs(m.vel.x) < 12) m.vel.x = 0 }
    } else {
      m.vel.y = 0
      m.vel.x *= 0.5
      if (Math.abs(m.vel.x) < 12) m.vel.x = 0
    }
    if (m.directHit && !m.triggered) {
      const list = ctx.playerBroadBuckets[bucketIdx(m.pos.x)]
      for (let ti = 0; ti < list.length; ti++) {
        const t = list[ti]
        if (t.respawnTimer > 0 || !t.deployed || !t.alive || t.id === m.owner) continue
        if (t.team === ctx.ownerTeamOf(m.owner) && t.team !== 'ffa') continue
        if (wrapDist(m.pos.x, m.pos.y, t.pos.x, t.pos.y - 10) <= 26) { m.triggered = true; m.fuse = 0.01; break }
      }
    }
    if (!m.armed && !m.triggered) {
      m.armTimer -= dt
      if (m.armTimer <= 0) m.armed = true
      continue
    }
    if (!m.triggered) {
      for (const t of ctx.players) {
        if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
        if (!m.preset && t.id === m.owner) continue
        if (wrapDist(t.pos.x, t.pos.y, m.pos.x, m.pos.y) <= ctx.config.mineTriggerRadius) {
          m.triggered = true
          m.fuse = m.instant ? 0.02 : 0.45
          break
        }
      }
    } else {
      m.fuse -= dt
      if (m.fuse <= 0) {
        const label = m.instant ? '⚡瞬发地雷' : '🚨感应地雷'
        explodeInWorld(ctx, m.pos.x, m.pos.y, 82, ctx.config.mineDamage, 19 * 60, undefined, m.owner === 0 ? undefined : m.owner, undefined, label)
        if (m.preset) m.respawnTimer = ctx.config.mineRespawnTime
        else ctx.landmines.splice(i, 1)
      }
    }
  }

  // 3. 空袭
  for (let i = ctx.airstrikes.length - 1; i >= 0; i--) {
    const st = ctx.airstrikes[i]
    st.timer -= dt
    if (st.timer <= 0) {
      ctx.events.push({ kind: 'airstrike', x: st.pos.x, y: st.pos.y })
      ctx.events.push({ kind: 'airstrike_drop', x: st.pos.x, y: st.pos.y })
      const src = ctx.playerById.get(st.owner) ?? ctx.players.find(p => p.id === st.owner)
      for (let b = -2; b <= 2; b++) {
        const airPr = createProjectile(
          ctx.nextProjId(),
          src ?? ({ id: st.owner, pos: st.pos, vel: { x: 0, y: 0 }, aim: 0, team: 'ffa', name: '空袭' } as unknown as PlayerState),
          st.pos.x + b * 44,
          st.pos.y - 420 - Math.abs(b) * 28,
          ctx.rng.range(-30, 30),
          900 + ctx.rng.range(0, 120),
          {
            damage: ctx.config.airstrikeDamage,
            headshotMult: 1.5,
            terrainRadius: ctx.config.airstrikeRadius,
            explosive: true,
            gravityScale: 0.5,
            weaponLabel: '✈️定点空袭',
            color: '#f43f5e',
            r: 7,
            life: 160 / 60,
          },
        )
        ctx.projectiles.push(airPr)
        ctx.events.push({
          kind: 'projectile_spawn', projectileId: airPr.id, playerId: st.owner, weaponId: -1,
          x: airPr.pos.x, y: airPr.pos.y, vx: airPr.vel.x, vy: airPr.vel.y, bounces: 0, life: airPr.life,
        })
      }
      ctx.airstrikes.splice(i, 1)
    }
  }
}
