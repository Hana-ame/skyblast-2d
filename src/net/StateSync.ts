// net/StateSync.ts —— 联机层：快照插值（客户端预测+纠错的框架点，骨架先做插值）
// 合并改造：只对连续量（玩家/弹丸/手雷/地雷/空袭信标）插值；
// 离散实体（障碍物/占点/弹药点/补给箱/迫击炮/比分）直接取最新帧——插值会撒谎。
import type { WorldSnapshot } from '../core/snap.ts'
import type { PlayerState, Projectile, Grenade, Landmine, Airstrike } from '../core/types.ts'

export class StateSync {
  private prev: WorldSnapshot | null = null
  private cur: WorldSnapshot | null = null
  private t = 0

  push(snap: WorldSnapshot): void {
    this.prev = this.cur
    this.cur = snap
    this.t = 0
  }

  advance(dt: number, interval = 0.1): void {
    this.t = Math.min(1, this.t + dt / interval)
  }

  interpolated(): WorldSnapshot | null {
    if (!this.cur) return null
    if (!this.prev || this.t >= 1) return this.cur
    return lerpSnap(this.prev, this.cur, this.t)
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

const WORLD_W = 13200
const WORLD_H = 4400

function lerpSnap(a: WorldSnapshot, b: WorldSnapshot, f: number): WorldSnapshot {
  const players: PlayerState[] = b.players.map((pb) => {
    const pa = a.players.find((x) => x.id === pb.id)
    if (!pa) return pb
    return {
      ...pb,
      pos: { x: lerpWrap(pa.pos.x, pb.pos.x, f, WORLD_W), y: lerpWrap(pa.pos.y, pb.pos.y, f, WORLD_H) },
      vel: { x: lerp(pa.vel.x, pb.vel.x, f), y: lerp(pa.vel.y, pb.vel.y, f) },
      doll: pb.doll,
    }
  })
  const projectiles: Projectile[] = b.projectiles.map((p) => {
    const pa = a.projectiles.find((x) => x.id === p.id)
    if (!pa) return p
    return { ...p, pos: { x: lerpWrap(pa.pos.x, p.pos.x, f, WORLD_W), y: lerpWrap(pa.pos.y, p.pos.y, f, WORLD_H) }, vel: { ...p.vel } }
  })
  const grenades: Grenade[] = b.grenades.map((g) => {
    const ga = a.grenades.find((x) => x.id === g.id)
    if (!ga) return g
    return { ...g, pos: { x: lerpWrap(ga.pos.x, g.pos.x, f, WORLD_W), y: lerpWrap(ga.pos.y, g.pos.y, f, WORLD_H) }, vel: { ...g.vel } }
  })
  const landmines: Landmine[] = b.landmines.map((m) => {
    const ma = a.landmines.find((x) => x.id === m.id)
    if (!ma) return m
    return { ...m, pos: { x: lerpWrap(ma.pos.x, m.pos.x, f, WORLD_W), y: lerpWrap(ma.pos.y, m.pos.y, f, WORLD_H) }, vel: { ...m.vel } }
  })
  const airstrikes: Airstrike[] = b.airstrikes.map((s) => {
    const sa = a.airstrikes.find((x) => x.id === s.id)
    if (!sa) return s
    return { ...s, pos: { x: lerpWrap(sa.pos.x, s.pos.x, f, WORLD_W), y: lerpWrap(sa.pos.y, s.pos.y, f, WORLD_H) } }
  })
  // 离散实体直接用最新帧
  return {
    ...b,
    players,
    projectiles,
    grenades,
    landmines,
    airstrikes,
  }
}
