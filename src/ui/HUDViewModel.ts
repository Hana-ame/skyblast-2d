// ui/HUDViewModel.ts —— 界面逻辑层：HUD 视图模型（只读快照派生，不直接读物理实体）
// 合并扩展：v2 状态（武器名/弹药/备弹/护盾/副武器冷却/比分）
import type { WorldSnapshot } from '../core/snap.ts'
import { WEAPONS } from '../core/weapons.ts'

export interface HUDState {
  tick: number
  hp: number
  ammo: number
  reserve: number
  weaponName: string
  reloading: boolean
  aimDeg: number
  kills: number
  deaths: number
  alive: boolean
  deployed: boolean
  fuel: number
  shieldHp: number
  shieldTimer: number
  secondaryCooldown: number
  projCount: number
  scores: Record<string, number>
}

export class HUDViewModel {
  private state: HUDState = {
    tick: 0, hp: 100, ammo: 0, reserve: 0, weaponName: '', reloading: false,
    aimDeg: 0, kills: 0, deaths: 0, alive: true, deployed: true,
    fuel: 0, shieldHp: 0, shieldTimer: 0, secondaryCooldown: 0,
    projCount: 0, scores: {},
  }

  update(snap: WorldSnapshot, playerId: number): void {
    const p = snap.players.find((x) => x.id === playerId)
    if (!p) return
    const wep = WEAPONS[p.weaponIndex]
    this.state = {
      tick: snap.tick,
      hp: p.hp,
      ammo: p.ammo[p.weaponIndex] ?? 0,
      reserve: p.reserveAmmo[p.weaponIndex] ?? 0,
      weaponName: wep?.shortName ?? '',
      reloading: p.reloading,
      aimDeg: Math.round((p.aim * 180) / Math.PI),
      kills: p.kills,
      deaths: p.deaths,
      alive: p.alive,
      deployed: p.deployed,
      fuel: p.fuel,
      shieldHp: p.shieldHp,
      shieldTimer: p.shieldTimer,
      secondaryCooldown: p.secondaryCooldown,
      projCount: snap.projectiles.length,
      scores: { ...snap.scores },
    }
  }

  get current(): HUDState {
    return this.state
  }
}
