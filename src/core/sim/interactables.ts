// core/sim/interactables.ts —— 地图互动设施子系统 (stepMapInteractables)：
//   占领点、迫击炮、瞭望塔、量子传送门、特武/人偶补给箱、弹药包经济与替身人偶回溯
import { getPhysicsParams } from './physics.ts'
import type { Rng } from '../rng.ts'
import { WEAPONS } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { wrapX, wrapDeltaX, wrapDist } from '../wrap.ts'
import { AMMO_SPOTS } from './landmarks.ts'
import { bucketIdx } from './spatial.ts'
import type {
  PlayerState, CapturePoint, AmmoPack, SupplyCrate, Mortar, Watchtower, WarpPortal, WorldEvent, TeamId,
} from '../types.ts'

export interface InteractablesContext {
  players: PlayerState[]
  playerBroadBuckets: PlayerState[][]
  capturePoints: CapturePoint[]
  ammoPacks: AmmoPack[]
  supplyCrates: SupplyCrate[]
  mortars: Mortar[]
  watchtowers: Watchtower[]
  warpPortals: WarpPortal[]
  events: WorldEvent[]
  config: GameConfig
  rng: Rng
  nextAmmoId: () => number
  getAmmoTimer: () => number
  setAmmoTimer: (t: number) => void
}

/** 替身人偶回溯（死亡触发 或 10s 到期触发） */
export function recallDollState(events: WorldEvent[], p: PlayerState): void {
  if (!p.doll) return
  const d = p.doll
  p.doll = null
  p.pos = { x: wrapX(d.pos.x), y: d.pos.y }
  p.vel = { x: 0, y: 0 }
  p.hp = Math.max(1, d.hp)
  p.shieldHp = d.shieldHp
  p.fuel = d.fuel
  p.weaponIndex = d.weaponIndex
  if (WEAPONS[d.weaponIndex] && !WEAPONS[d.weaponIndex].isSupplyOnly) p.lastPrimaryIndex = d.weaponIndex
  p.ammo = [...d.ammo]
  p.reserveAmmo = [...d.reserveAmmo]
  p.respawnTimer = 0
  p.alive = true
  events.push({ kind: 'doll_recall', x: p.pos.x, y: p.pos.y, playerId: p.id })
}

/** 玩家按 E 交互：迫击炮 / 瞭望塔 / 量子传送门 */
export function handlePlayerInteract(ctx: InteractablesContext, p: PlayerState): void {
  if (p.respawnTimer > 0 || !p.alive) return
  // 退出迫击炮
  const cur = ctx.mortars.find(m => m.operatorId === p.id)
  if (cur) {
    cur.operatorId = null
    p.vel.y = -270
    return
  }
  // 上迫击炮
  for (const m of ctx.mortars) {
    if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
      m.operatorId = p.id
      p.pos = { x: m.x, y: m.y - 16 }
      p.vel = { x: 0, y: 0 }
      return
    }
  }
  // 已在塔上 → 下塔（视野加成立即消失）
  if (p.mountedTowerId) {
    const tw = ctx.watchtowers.find(t => t.id === p.mountedTowerId)
    if (tw) tw.operatorId = null
    p.mountedTowerId = null
    p.watchtowerTimer = 0
    p.vel = { x: 0, y: -160 }
    ctx.events.push({ kind: 'warp', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: '离开瞭望塔' })
    return
  }
  // 上塔：锁定在塔顶、不能移动、视野 200%
  for (const tw of ctx.watchtowers) {
    if (tw.operatorId === null && wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
      tw.operatorId = p.id
      p.mountedTowerId = tw.id
      p.pos = { x: tw.x, y: tw.y - 150 + 12 }
      p.vel = { x: 0, y: 0 }
      p.onGround = false
      ctx.events.push({ kind: 'warp', x: tw.x, y: tw.y, playerId: p.id, weaponName: `登上${tw.name}（视野 200%）` })
      return
    }
  }
  // 量子传送门：配对跃迁 + 2.5s 冷却
  for (const wp of ctx.warpPortals) {
    if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
      const dest = ctx.warpPortals.find(w => w.id === wp.targetId)
      if (!dest) continue
      p.pos = { x: dest.x, y: dest.y - 60 }
      p.vel = { x: 0, y: 0 }
      p.warpCooldown = 2.5
      ctx.events.push({ kind: 'warp', x: dest.x, y: dest.y, playerId: p.id, weaponName: wp.name })
      return
    }
  }
}

export function spawnSingleAmmoPack(ctx: InteractablesContext): void {
  if (ctx.ammoPacks.length >= ctx.config.ammoPackMaxActive) return
  const available: number[] = []
  for (let i = 0; i < AMMO_SPOTS.length; i++) {
    if (!ctx.ammoPacks.some(a => a.x === AMMO_SPOTS[i].x)) available.push(i)
  }
  if (available.length === 0) return
  const spot = AMMO_SPOTS[ctx.rng.pick(available)]
  ctx.ammoPacks.push({ id: ctx.nextAmmoId(), x: spot.x, y: spot.y, area: spot.area })
}

export function stepMapInteractables(ctx: InteractablesContext, dt: number): void {
  // 1. 占领点
  const capR = ctx.config.captureRadius
  for (const cp of ctx.capturePoints) {
    const presence: Partial<Record<TeamId, number>> = {}
    for (let i = 0; i < ctx.players.length; i++) {
      const p = ctx.players[i]
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
      if (Math.abs(wrapDeltaX(p.pos.x, cp.x)) >= capR) continue
      if (Math.abs(p.pos.y - cp.y) >= capR) continue
      if (wrapDist(p.pos.x, p.pos.y, cp.x, cp.y) < capR) {
        presence[p.team] = (presence[p.team] || 0) + 1
      }
    }
    const teams = Object.keys(presence) as TeamId[]
    if (teams.length === 1) {
      const t = teams[0]
      if (cp.ownerTeam !== t) {
        cp.capturingTeam = t
        cp.progress += ctx.config.captureRate * dt * (presence[t] || 0)
        if (cp.progress >= 100) {
          cp.progress = 100
          cp.ownerTeam = t
          ctx.events.push({ kind: 'capture', pointCode: cp.code, team: t, x: cp.x, y: cp.y })
        }
      }
    }
  }

  // 2. 迫击炮冷却
  for (const m of ctx.mortars) {
    if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt)
  }

  // 3. 补给箱
  for (const crate of ctx.supplyCrates) {
    if (!crate.active && crate.respawnTimer > 0) {
      crate.respawnTimer -= dt
      if (crate.respawnTimer <= 0) crate.active = true
    }
    if (!crate.active) continue
    for (let i = 0; i < ctx.players.length; i++) {
      const p = ctx.players[i]
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
      if (Math.abs(wrapDeltaX(p.pos.x, crate.x)) >= 56 || Math.abs(p.pos.y - crate.y) >= 56) continue
      if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 56) {
        crate.active = false
        crate.respawnTimer = ctx.config.supplyRespawnTime
        if (crate.kind === 'doll') {
          p.dollCharges = Math.min(ctx.config.dollMaxCharges, p.dollCharges + 1)
        } else {
          p.weaponIndex = crate.weaponId
          p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (WEAPONS[crate.weaponId].fuelMult ?? 1))
          p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize
          p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve
        }
        ctx.events.push({ kind: 'supply_pickup', playerId: p.id, weaponName: crate.weaponName, x: crate.x, y: crate.y })
        break
      }
    }
  }

  // 4. 弹药刷新与拾取
  let timer = ctx.getAmmoTimer() + dt
  if (timer >= ctx.config.ammoPackInterval) {
    timer = 0
    spawnSingleAmmoPack(ctx)
  }
  ctx.setAmmoTimer(timer)

  for (let i = ctx.ammoPacks.length - 1; i >= 0; i--) {
    const pack = ctx.ammoPacks[i]
    for (let pi = 0; pi < ctx.players.length; pi++) {
      const p = ctx.players[pi]
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
      if (Math.abs(wrapDeltaX(p.pos.x, pack.x)) >= 52 || Math.abs(p.pos.y - pack.y) >= 52) continue
      if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 52) {
        const wep = WEAPONS[p.weaponIndex]
        p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve)
        ctx.ammoPacks.splice(i, 1)
        ctx.events.push({ kind: 'ammo_pickup', playerId: p.id, x: pack.x, y: pack.y })
        break
      }
    }
  }
}
