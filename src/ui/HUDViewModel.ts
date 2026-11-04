// ui/HUDViewModel.ts —— 界面逻辑层：HUD 视图模型（只读快照派生，不直接读物理实体）
import type { WorldSnapshot } from '../core/types.ts'

export interface HUDState {
  tick: number
  hp: number
  ammo: number
  aimDeg: number
  kills: number
  deaths: number
  alive: boolean
  projCount: number
}

export class HUDViewModel {
  private state: HUDState = {
    tick: 0, hp: 100, ammo: 8, aimDeg: 0, kills: 0, deaths: 0, alive: true, projCount: 0,
  }

  update(snap: WorldSnapshot, playerId: number): void {
    const p = snap.players.find((x) => x.id === playerId)
    if (!p) return
    this.state = {
      tick: snap.tick,
      hp: p.hp,
      ammo: p.ammo,
      aimDeg: Math.round((p.aim * 180) / Math.PI),
      kills: p.kills,
      deaths: p.deaths,
      alive: p.alive,
      projCount: snap.projectiles.length,
    }
  }

  get current(): HUDState {
    return this.state
  }
}
