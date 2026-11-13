// core/sim/throwables.ts —— 副武器释放、读条传送、手雷、地雷、空袭与爆炸结算子系统 (stepExplosionsAndThrowables)
import type { Terrain } from '../terrain.ts'
import type { Rng } from '../rng.ts'
import { WEAPONS, SECONDARIES, isSecondaryUnlocked, getPlayerFragMaxCharges } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../wrap.ts'
import { bucketIdx, findObstacleAt, checkBodyOverlapsAt } from './spatial.ts'
import { ensureFreePosition, resolvePenetration } from './playerPhysics.ts'
import { createProjectile } from './projectiles.ts'
import type {
  PlayerState, Projectile, Grenade, Landmine, Airstrike, Obstacle, Mortar, Watchtower, WorldEvent, TeamId,
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
  watchtowers: Watchtower[]
  scores: Record<string, number>
  events: WorldEvent[]
  config: GameConfig
  rng: Rng
  nextProjId: () => number
  nextGrenadeId: () => number
  nextObstacleSeq: () => number
  nextMineId: () => number
  rebuildSpatial: () => void
  onHitCount: () => void
  ownerTeamOf: (id: number) => TeamId
  recallDoll: (p: PlayerState, ev: 'doll_recall') => void
}

/** 推进玩家 Teleport 读条：读条完成后直接出现在右键目标位置 */
export function stepPlayerTeleport(ctx: ThrowablesContext, p: PlayerState, dt: number): void {
  if (!p.teleportTimer || p.teleportTimer <= 0 || !p.teleportTarget) return
  if (!p.alive || p.respawnTimer > 0 || !p.deployed) {
    p.teleportTimer = 0
    p.teleportTarget = null
    return
  }
  p.teleportTimer -= dt
  if (p.teleportTimer > 0) return

  const target = p.teleportTarget
  p.teleportTimer = 0
  p.teleportTarget = null

  const curMortar = ctx.mortars.find(m => m.operatorId === p.id)
  if (curMortar) curMortar.operatorId = null
  if (p.mountedTowerId) {
    const tw = ctx.watchtowers.find(t => t.id === p.mountedTowerId)
    if (tw) tw.operatorId = null
    p.mountedTowerId = null
    p.watchtowerTimer = 0
  }

  p.pos = { x: wrapX(target.x), y: clamp(target.y, 40, 4360) }
  if (p.vel.y > 0) p.vel.y = 0
  resolvePenetration(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p)
  ensureFreePosition(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p)
  ctx.events.push({ kind: 'warp', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: 'Teleport' })
}

export function useSecondaryInWorld(
  ctx: ThrowablesContext,
  p: PlayerState,
  s: { type: string; targetX: number; targetY: number },
): void {
  if (p.respawnTimer > 0 || p.secondaryCooldown > 0 || !p.alive) return
  const def = SECONDARIES[s.type]
  if (!def) return
  if (s.type === 'frag') {
    if (p.fragCharges <= 0) return
    p.fragCharges--
    p.secondaryCooldown = Math.max(p.secondaryCooldown, 0.8)
    const throwSpeed = 760
    ctx.grenades.push({
      id: ctx.nextGrenadeId(),
      owner: p.id,
      pos: { x: wrapX(p.pos.x + Math.cos(p.aim) * 20), y: p.pos.y - 16 + Math.sin(p.aim) * 20 },
      vel: { x: Math.cos(p.aim) * throwSpeed + p.vel.x * 0.25, y: Math.sin(p.aim) * throwSpeed - 96 + p.vel.y * 0.2 },
      fuse: ctx.config.grenadeFuse, bounces: 0,
    })
    return
  }
  if (s.type === 'doll') {
    if (p.dollCharges <= 0) return
    p.dollCharges--
    p.secondaryCooldown = def.cd
    p.doll = {
      pos: { x: p.pos.x, y: p.pos.y }, hp: p.hp, shieldHp: p.shieldHp, fuel: p.fuel,
      weaponIndex: p.weaponIndex, ammo: [...p.ammo], reserveAmmo: [...p.reserveAmmo],
      timer: ctx.config.dollDuration,
    }
    ctx.events.push({ kind: 'doll_recall', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: 'anchor' })
    return
  }

  // 连死阶梯解锁校验（含冲锋枪 +1 挡加权，或当前已合法装备该副手）
  if (!isSecondaryUnlocked(s.type, p.deathStreak ?? 0, p.dollCharges ?? 0, p.weaponIndex) && p.secondary !== s.type) return

  if (s.type === 'obstacle') {
    // 10.0s 冷却，不设同屏/同玩家数量上限，可无限生成
    p.secondaryCooldown = def.cd
    const w = 56
    const h = 76
    const dist = 76
    const cx = wrapX(p.pos.x + Math.cos(p.aim) * dist)
    const cy = Math.max(80, Math.min(4300 - h, (p.pos.y - 16) + Math.sin(p.aim) * dist))
    const ox = wrapX(cx - w / 2)
    let oy = cy - h / 2
    for (let sStep = 0; sStep < 24; sStep++) {
      if (ctx.terrain.isSolidAt(wrapX(ox + w / 2), oy + h - 1) && !ctx.terrain.isSolidAt(wrapX(ox + w / 2), oy - 2)) {
        oy -= 2
      } else break
    }
    const obKind: Obstacle['kind'] = 'box'
    const ob: Obstacle = {
      id: `p_obs_${p.id}_${ctx.nextObstacleSeq()}`,
      x: ox,
      y: oy,
      w,
      h,
      hp: ctx.config.obstacleDefaultHp,
      maxHp: ctx.config.obstacleDefaultHp,
      kind: obKind,
      color: '#334155',
      borderColor: '#38bdf8',
      label: '战术掩体',
    }
    ctx.obstacles.push(ob)
    ctx.rebuildSpatial()
    if (checkBodyOverlapsAt(ctx.terrain, ctx.obstacles, p.pos.x, p.pos.y, ctx.obstacleBroadBuckets)) {
      resolvePenetration(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p)
      ensureFreePosition(ctx.terrain, ctx.obstacles, ctx.obstacleBroadBuckets, p)
    }
    return
  }

  if (s.type === 'shield') {
    // 护盾只允许出现一个：固定 100HP（ctx.config.shieldHp），不可叠加
    if (p.shieldTimer > 0 && p.shieldHp > 0) return
    p.secondaryCooldown = def.cd
    p.shieldHp = ctx.config.shieldHp
    p.shieldTimer = ctx.config.shieldDuration
    ctx.events.push({ kind: 'shield', x: p.pos.x, y: p.pos.y, playerId: p.id })
    return
  }

  if (s.type === 'teleport') {
    if (p.teleportTimer && p.teleportTimer > 0) return
    p.secondaryCooldown = def.cd
    let tx = wrapX(p.pos.x + Math.cos(p.aim) * 280)
    let ty = clamp(p.pos.y + Math.sin(p.aim) * 280, 40, 4360)
    if (Number.isFinite(s.targetX) && Number.isFinite(s.targetY) && (s.targetX !== 0 || s.targetY !== 0)) {
      tx = wrapX(s.targetX)
      ty = clamp(s.targetY, 40, 4360)
    }
    const castTime = ctx.config.teleportCastTime ?? 0.35
    p.teleportTimer = Math.max(0.05, castTime)
    p.teleportTarget = { x: tx, y: ty }
    return
  }
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
  const atkId = attackerId ?? pr?.owner ?? 0
  const atkTeam = attackerTeam ?? ctx.ownerTeamOf(atkId)
  const label = weaponLabel ?? pr?.weaponLabel ?? '未知'

  // 护盾（100HP）且伤害不溢出：只要护盾尚存，本次受击全部由护盾承担，超出护盾剩余量的溢出伤害不扣生命值
  if (t.shieldTimer > 0 && t.shieldHp > 0) {
    const absorbed = Math.min(t.shieldHp, amount)
    t.shieldHp = Math.max(0, t.shieldHp - amount)
    ctx.events.push({
      kind: 'hit', x: t.pos.x, y: t.pos.y,
      victimId: t.id, attackerId: atkId, headshot: isHead, damage: absorbed,
      weaponLabel: label, victimTeam: t.team, isHeadshot: isHead, isPierced,
    })
    ctx.onHitCount()
    if (t.shieldHp <= 0) {
      t.shieldHp = 0
      t.shieldTimer = 0
      ctx.events.push({ kind: 'shield', x: t.pos.x, y: t.pos.y, playerId: t.id })
      ctx.events.push({ kind: 'shield_break', x: t.pos.x, y: t.pos.y, playerId: t.id })
    }
    return
  }

  t.hp -= amount
  ctx.events.push({
    kind: 'hit', x: t.pos.x, y: t.pos.y,
    victimId: t.id, attackerId: atkId, headshot: isHead, damage: amount,
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
  // 若本命内已有击杀 (lifeKills > 0)，本次阵亡只终结本命击杀而不算进「连死」(保持连死为 0)；仅零击杀阵亡才累加连死
  if ((t.lifeKills ?? 0) > 0) {
    t.deathStreak = 0
    t.lifeKills = 0
  } else {
    t.deathStreak = (t.deathStreak ?? 0) + 1
  }
  // 连死后不要自动选择最新解锁的副武器：仅当当前副武器不再满足解锁条件时才统一退回手榴弹 ('frag')
  if (!SECONDARIES[t.secondary] || !isSecondaryUnlocked(t.secondary, t.deathStreak, t.dollCharges, t.weaponIndex)) {
    t.secondary = 'frag'
  }
  t.respawnTimer = ctx.config.respawnDelay
  t.shieldHp = 0
  t.shieldTimer = 0
  t.watchtowerTimer = 0
  t.teleportTimer = 0
  t.teleportTarget = null
  const mk = ctx.mortars.find(m => m.operatorId === t.id)
  if (mk) mk.operatorId = null
  const killer = ctx.playerById.get(atkId) ?? ctx.players.find(x => x.id === atkId)
  if (killer && atkId !== t.id) {
    killer.kills++
    killer.lifeKills = (killer.lifeKills ?? 0) + 1
    killer.deathStreak = 0
    // 杀人后连死归零：若当前副武器因杀人失效，统一返回手榴弹 ('frag')，且手榴弹上限同步回 1
    if (!SECONDARIES[killer.secondary] || !isSecondaryUnlocked(killer.secondary, killer.deathStreak, killer.dollCharges, killer.weaponIndex)) {
      killer.secondary = 'frag'
    }
    const killerMaxFrags = getPlayerFragMaxCharges(killer.deathStreak, ctx.config.fragMaxCharges)
    if (killer.fragCharges > killerMaxFrags) killer.fragCharges = killerMaxFrags
    if (ctx.scores[atkTeam] !== undefined) ctx.scores[atkTeam]++
  }
  ctx.events.push({
    kind: 'kill',
    attackerId: atkId,
    victimId: t.id,
    weaponLabel: label,
    headshot: isHead,
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
  for (let i = ctx.obstacles.length - 1; i >= 0; i--) {
    const ob = ctx.obstacles[i];
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
  const ffAllowed = isGrenade ? ctx.config.grenadeFriendlyFire : (srcWep ? (srcWep.friendlyFire ?? false) : false)
  const selfAllowed = isGrenade ? ctx.config.grenadeSelfDamage : (srcWep ? (srcWep.selfDamage ?? false) : true)
  // 取爆炸衰减指数：优先用弹丸对应武器；无 pr 时按武器名回退（保证同一武器参数一致）
  let blastExp = srcWep?.blastFalloffExponent ?? 1
  if (!srcWep && label) {
    const byLabel = WEAPONS.find(w => w.shortName === label || w.name === label)
    if (byLabel?.blastFalloffExponent) blastExp = byLabel.blastFalloffExponent
  }

  for (const t of ctx.players) {
    if (t.respawnTimer > 0 || !t.deployed || !t.alive) continue
    const dx = wrapDeltaX(wCx, t.pos.x)
    if (Math.abs(dx) > hitR) continue
    const dy = wrapDeltaY(cy, t.pos.y - 12)
    if (Math.abs(dy) > hitR) continue
    const dist = Math.hypot(dx, dy)
    if (dist > hitR) continue
    // 衰减：默认线性；武器可配 blastFalloffExponent >1（火箭筒 1.8）→ 近爆点更保伤、边缘掉得更快。
    // 只影响玩家伤害曲线，不改爆炸半径 terrainRadius。
    const tNorm = Math.min(1, dist / hitR)
    const falloff = Math.max(0.2, 1 - Math.pow(tNorm, blastExp))
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

  // 2. 地雷（场景预设感应地雷）
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
        explodeInWorld(ctx, m.pos.x, m.pos.y, m.preset ? 82 : 104, m.preset ? ctx.config.mineDamage : Math.round(ctx.config.mineDamage * 1.25), 19 * 60, undefined, m.owner === 0 ? undefined : m.owner, undefined, label)
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
