// net/StateSync.ts —— 联机层：客户端预测（Client-Side Prediction）+ 服务器纠错重放（Reconciliation）+ 远端插值（Interpolation）+ 弹丸本地推算（Dead Reckoning）
import type { WorldSnapshot } from '../core/snap.ts'
import type {
  PlayerState, Projectile, Grenade, Landmine, Airstrike, WorldInput, WorldEvent,
} from '../core/types.ts'
import { Terrain } from '../core/terrain.ts'
import { WEAPONS } from '../core/weapons.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY } from '../core/wrap.ts'
import { predictLocalPlayerStep } from '../core/sim/playerPhysics.ts'
import { WATCHTOWERS } from '../core/sim/landmarks.ts'
import { stepClientProjectilesDeadReckoning } from '../core/sim/projectiles.ts'

export interface PendingInputFrame {
  seq: number
  dt: number
  input: WorldInput
}

const WORLD_W = 13200
const WORLD_H = 4400

// 纠错阈值：偏差 >120px（如传送/重生/爆炸击飞）直接硬对齐；0.5~120px 走指数衰减平滑纠错
const SNAP_THRESHOLD = 120
const SMOOTH_THRESHOLD = 0.5

export class StateSync {
  private prev: WorldSnapshot | null = null
  private cur: WorldSnapshot | null = null
  private t = 0
  private localPlayerId = 0
  private terrain: Terrain
  private predictedLocal: PlayerState | null = null
  /** 视觉平滑纠错偏移量（当服务器重放位置与客户端当前预测位置存在轻微偏差时，平滑过渡避免跳帧） */
  reconcileOffset = { x: 0, y: 0 }
  /** 客户端通过事件化同步+本地推算维护的飞行弹丸表（支撑直线/抛物线弹丸事件化同步） */
  private deadReckonedProjectiles = new Map<number, Projectile>()
  private enableProjectileDeadReckoning = false

  constructor(terrain?: Terrain, localPlayerId = 0) {
    if (terrain) {
      this.terrain = terrain
    } else {
      this.terrain = new Terrain()
      this.terrain.build()
    }
    this.localPlayerId = localPlayerId
  }

  setLocalPlayerId(id: number): void {
    this.localPlayerId = id
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain
  }

  setProjectileDeadReckoning(enabled: boolean): void {
    this.enableProjectileDeadReckoning = enabled
  }

  /** 客户端本地立即预测输入（无需等待 RTT 与插值缓冲，按下即响应） */
  applyLocalInput(input: WorldInput, dt = 1 / 60): PlayerState | null {
    if (!this.predictedLocal && this.cur && this.localPlayerId > 0) {
      const found = this.cur.players.find(p => p.id === this.localPlayerId)
      if (found) this.predictedLocal = clonePlayerState(found)
    }
    if (!this.predictedLocal) return null
    predictLocalPlayerStep(
      this.predictedLocal,
      input,
      dt,
      this.terrain,
      this.cur?.obstacles ?? [],
      this.cur?.mortars ?? [],
      WATCHTOWERS,
    )
    return this.predictedLocal
  }

  /** 接收权威快照：若提供 localPlayerId 与未确认输入队列，则执行服务器回滚与重放（Server Reconciliation） */
  push(
    snap: WorldSnapshot,
    localPlayerId = this.localPlayerId,
    pendingInputs?: PendingInputFrame[],
    events?: WorldEvent[],
  ): void {
    if (localPlayerId > 0) this.localPlayerId = localPlayerId
    this.prev = this.cur
    this.cur = snap
    this.t = 0

    // 处理弹丸事件化同步（spawn / bounce / destroy）
    if (events && events.length > 0) {
      this.applyProjectileEvents(events)
    }
    if (this.enableProjectileDeadReckoning) {
      for (let i = 0; i < snap.projectiles.length; i++) {
        const pr = snap.projectiles[i]
        this.deadReckonedProjectiles.set(pr.id, {
          ...pr,
          pos: { x: pr.pos.x, y: pr.pos.y },
          vel: { x: pr.vel.x, y: pr.vel.y },
          hitTargets: [...pr.hitTargets],
        })
      }
    }

    // 本地玩家服务器回滚与未确认输入重放
    if (this.localPlayerId > 0) {
      const authPlayer = snap.players.find(p => p.id === this.localPlayerId)
      if (authPlayer) {
        const replayed = clonePlayerState(authPlayer)
        if (pendingInputs && pendingInputs.length > 0) {
          for (let i = 0; i < pendingInputs.length; i++) {
            const frame = pendingInputs[i]
            predictLocalPlayerStep(
              replayed,
              frame.input,
              frame.dt,
              this.terrain,
              snap.obstacles,
              snap.mortars,
              WATCHTOWERS,
            )
          }
        }
        if (this.predictedLocal && authPlayer.alive && authPlayer.deployed && authPlayer.respawnTimer <= 0) {
          // 当前画面上的本地玩家视觉坐标 = predictedLocal + reconcileOffset
          const prevVisX = wrapX(this.predictedLocal.pos.x + this.reconcileOffset.x)
          const prevVisY = wrapY(this.predictedLocal.pos.y + this.reconcileOffset.y)
          const errX = wrapDeltaX(replayed.pos.x, prevVisX)
          const errY = wrapDeltaY(replayed.pos.y, prevVisY)
          const errDist = Math.hypot(errX, errY)
          if (errDist > SNAP_THRESHOLD) {
            this.reconcileOffset.x = 0
            this.reconcileOffset.y = 0
          } else if (errDist >= SMOOTH_THRESHOLD) {
            this.reconcileOffset.x = errX
            this.reconcileOffset.y = errY
          } else {
            this.reconcileOffset.x = 0
            this.reconcileOffset.y = 0
          }
        } else {
          this.reconcileOffset.x = 0
          this.reconcileOffset.y = 0
        }
        this.predictedLocal = replayed
      }
    }
  }

  /** 处理高频弹丸事件（发射/反弹/销毁），支撑客户端本地推算弹道 */
  applyProjectileEvents(events: WorldEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      if (e.kind === 'projectile_spawn' && e.projectileId !== undefined) {
        const wid = e.weaponId ?? -1
        const wep = wid >= 0 ? WEAPONS[wid] : undefined
        const rad = e.radius ?? (wep ? (wep.isGravityOrb ? 8.5 : wep.rocket ? 8 : wep.explosive ? 5.5 : wep.id === 4 ? 4.5 : 3.2) : 4)
        this.deadReckonedProjectiles.set(e.projectileId, {
          id: e.projectileId,
          owner: e.playerId ?? 0,
          pos: { x: e.x ?? 0, y: e.y ?? 0 },
          vel: { x: e.vx ?? 0, y: e.vy ?? 0 },
          life: e.life ?? (wep?.lifeSeconds ?? 2.2),
          r: rad,
          damage: wep?.damage ?? 24,
          headshotMult: wep?.headshotMult ?? 1.5,
          explosive: !!wep?.explosive,
          terrainRadius: wep?.terrainRadius ?? 0,
          gravityScale: wep?.gravityScale ?? 0.04,
          pierceOnHeadshot: !!wep?.pierceOnHeadshot,
          pierceAll: !!wep?.pierceAll,
          isGravityOrb: !!wep?.isGravityOrb,
          weaponId: wid,
          curveRate: wep?.curveRate ?? 0,
          weaponLabel: e.weaponLabel ?? wep?.shortName ?? '弹丸',
          color: e.color ?? wep?.color ?? '#fbbf24',
          hitTargets: [e.playerId ?? 0],
          bounces: e.bounces ?? (wep?.bounces ?? 0),
          passWalls: !!wep?.passWalls,
          beam: !!wep?.beam,
          rocket: !!wep?.rocket,
          dragPerSecond: wep?.dragPerSecond ?? 1,
        })
      } else if (e.kind === 'projectile_bounce' && e.projectileId !== undefined) {
        const pr = this.deadReckonedProjectiles.get(e.projectileId)
        if (pr) {
          pr.pos.x = e.x ?? pr.pos.x
          pr.pos.y = e.y ?? pr.pos.y
          pr.vel.x = e.vx ?? pr.vel.x
          pr.vel.y = e.vy ?? pr.vel.y
          if (e.bounces !== undefined) pr.bounces = e.bounces
        }
      } else if (e.kind === 'projectile_destroy' && e.projectileId !== undefined) {
        this.deadReckonedProjectiles.delete(e.projectileId)
      }
    }
  }

  advance(dt: number, interval = 0.1): void {
    this.t = Math.min(1, this.t + dt / interval)
    // 平滑衰减纠错偏移（60Hz 下约 80ms 平滑收敛到 0）
    const decay = Math.pow(0.08, dt * 10)
    this.reconcileOffset.x *= decay
    this.reconcileOffset.y *= decay
    if (Math.abs(this.reconcileOffset.x) < 0.1) this.reconcileOffset.x = 0
    if (Math.abs(this.reconcileOffset.y) < 0.1) this.reconcileOffset.y = 0

    // 客户端本地推算飞行弹丸轨迹
    if (this.deadReckonedProjectiles.size > 0) {
      const list = Array.from(this.deadReckonedProjectiles.values())
      stepClientProjectilesDeadReckoning(list, dt, this.terrain)
      for (let i = 0; i < list.length; i++) {
        if (list[i].life <= 0) this.deadReckonedProjectiles.delete(list[i].id)
      }
    }
  }

  getPredictedLocalPlayer(): PlayerState | null {
    if (!this.predictedLocal) return null
    return {
      ...this.predictedLocal,
      pos: {
        x: wrapX(this.predictedLocal.pos.x + this.reconcileOffset.x),
        y: wrapY(this.predictedLocal.pos.y + this.reconcileOffset.y),
      },
    }
  }

  getDeadReckonedProjectiles(): Projectile[] {
    return Array.from(this.deadReckonedProjectiles.values())
  }

  interpolated(): WorldSnapshot | null {
    if (!this.cur) return null
    const base = (!this.prev || this.t >= 1) ? this.cur : lerpSnap(this.prev, this.cur, this.t)
    if (this.localPlayerId <= 0 && !this.enableProjectileDeadReckoning) return base

    let players = base.players
    if (this.localPlayerId > 0 && this.predictedLocal) {
      const visLocal = this.getPredictedLocalPlayer()!
      players = base.players.map(p => (p.id === this.localPlayerId ? visLocal : p))
    }

    const projectiles =
      this.enableProjectileDeadReckoning && this.deadReckonedProjectiles.size > 0
        ? this.getDeadReckonedProjectiles()
        : base.projectiles

    return {
      ...base,
      players,
      projectiles,
    }
  }
}

function clonePlayerState(p: PlayerState): PlayerState {
  return {
    ...p,
    pos: { x: p.pos.x, y: p.pos.y },
    vel: { x: p.vel.x, y: p.vel.y },
    ammo: [...p.ammo],
    reserveAmmo: [...p.reserveAmmo],
    selectedSpawnId: p.selectedSpawnId,
    doll: p.doll
      ? {
          ...p.doll,
          pos: { x: p.doll.pos.x, y: p.doll.pos.y },
          ammo: [...p.doll.ammo],
          reserveAmmo: [...p.doll.reserveAmmo],
        }
      : null,
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

/** 环形世界感知的 x/y 插值：先取跨缝最短位移再线性过渡，避免跨缝时横穿全屏 */
function lerpWrap(a: number, b: number, f: number, W: number): number {
  let dx = b - a
  if (dx > W * 0.5) dx -= W
  if (dx < -W * 0.5) dx += W
  return ((a + dx * f) % W + W) % W
}

// 复用 Map 容器，避免每帧新建 Map 产生垃圾回收压力
const prevPlayerMap = new Map<number, PlayerState>()
const prevProjMap = new Map<number, Projectile>()
const prevGrenMap = new Map<number, Grenade>()
const prevMineMap = new Map<number, Landmine>()
const prevAirMap = new Map<number, Airstrike>()

function lerpSnap(a: WorldSnapshot, b: WorldSnapshot, f: number): WorldSnapshot {
  prevPlayerMap.clear()
  for (let i = 0; i < a.players.length; i++) prevPlayerMap.set(a.players[i].id, a.players[i])

  prevProjMap.clear()
  for (let i = 0; i < a.projectiles.length; i++) prevProjMap.set(a.projectiles[i].id, a.projectiles[i])

  prevGrenMap.clear()
  for (let i = 0; i < a.grenades.length; i++) prevGrenMap.set(a.grenades[i].id, a.grenades[i])

  prevMineMap.clear()
  for (let i = 0; i < a.landmines.length; i++) prevMineMap.set(a.landmines[i].id, a.landmines[i])

  prevAirMap.clear()
  for (let i = 0; i < a.airstrikes.length; i++) prevAirMap.set(a.airstrikes[i].id, a.airstrikes[i])

  const players: PlayerState[] = b.players.map((pb) => {
    const pa = prevPlayerMap.get(pb.id)
    if (!pa) return pb
    return {
      ...pb,
      pos: { x: lerpWrap(pa.pos.x, pb.pos.x, f, WORLD_W), y: lerpWrap(pa.pos.y, pb.pos.y, f, WORLD_H) },
      vel: { x: lerp(pa.vel.x, pb.vel.x, f), y: lerp(pa.vel.y, pb.vel.y, f) },
      doll: pb.doll,
    }
  })
  const projectiles: Projectile[] = b.projectiles.map((p) => {
    const pa = prevProjMap.get(p.id)
    if (!pa) return p
    return { ...p, pos: { x: lerpWrap(pa.pos.x, p.pos.x, f, WORLD_W), y: lerpWrap(pa.pos.y, p.pos.y, f, WORLD_H) }, vel: { ...p.vel } }
  })
  const grenades: Grenade[] = b.grenades.map((g) => {
    const ga = prevGrenMap.get(g.id)
    if (!ga) return g
    return { ...g, pos: { x: lerpWrap(ga.pos.x, g.pos.x, f, WORLD_W), y: lerpWrap(ga.pos.y, g.pos.y, f, WORLD_H) }, vel: { ...g.vel } }
  })
  const landmines: Landmine[] = b.landmines.map((m) => {
    const ma = prevMineMap.get(m.id)
    if (!ma) return m
    return { ...m, pos: { x: lerpWrap(ma.pos.x, m.pos.x, f, WORLD_W), y: lerpWrap(ma.pos.y, m.pos.y, f, WORLD_H) }, vel: { ...m.vel } }
  })
  const airstrikes: Airstrike[] = b.airstrikes.map((s) => {
    const sa = prevAirMap.get(s.id)
    if (!sa) return s
    return { ...s, pos: { x: lerpWrap(sa.pos.x, s.pos.x, f, WORLD_W), y: lerpWrap(sa.pos.y, s.pos.y, f, WORLD_H) } }
  })
  return {
    ...b,
    players,
    projectiles,
    grenades,
    landmines,
    airstrikes,
  }
}
