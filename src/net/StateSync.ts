// net/StateSync.ts —— 联机层：快照插值（客户端预测+纠错的框架点，骨架先做插值）
import type { WorldSnapshot } from '../core/types.ts'

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

function lerpSnap(a: WorldSnapshot, b: WorldSnapshot, f: number): WorldSnapshot {
  const players = b.players.map((pb) => {
    const pa = a.players.find((x) => x.id === pb.id)
    if (!pa) return { ...pb, pos: { ...pb.pos }, vel: { ...pb.vel } }
    return {
      ...pb,
      pos: { x: lerp(pa.pos.x, pb.pos.x, f), y: lerp(pa.pos.y, pb.pos.y, f) },
      vel: { x: lerp(pa.vel.x, pb.vel.x, f), y: lerp(pa.vel.y, pb.vel.y, f) },
    }
  })
  return {
    tick: b.tick,
    players,
    projectiles: b.projectiles.map((p) => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel } })),
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}
