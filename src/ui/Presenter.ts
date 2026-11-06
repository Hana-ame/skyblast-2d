// ui/Presenter.ts —— 界面逻辑层：把快照 → 视图模型 → 可读呈现（不调网络/输入内部）
// 合并扩展：describe 输出 v2 状态（武器/备弹/护盾/比分）；onIntent 桥接 UI 动作回抛意图总线
import type { HUDViewModel } from './HUDViewModel.ts'
import type { WorldSnapshot } from '../core/snap.ts'
import { WEAPONS } from '../core/weapons.ts'

export class Presenter {
  private hud: HUDViewModel
  private onIntentCb: ((s: WorldSnapshot) => void) | null = null

  constructor(hud: HUDViewModel) {
    this.hud = hud
  }

  /** 快照 → HUD 视图模型（供渲染层消费） */
  render(snap: WorldSnapshot, playerId: number): void {
    this.hud.update(snap, playerId)
  }

  /** UI 产生的动作 → 回抛意图总线（界面层不直接调网络） */
  onIntent(cb: (s: WorldSnapshot) => void): void {
    this.onIntentCb = cb
  }

  /** 生成一行的对局可读摘要（演示/日志用） */
  describe(snap: WorldSnapshot, playerId: number): string {
    const p = snap.players.find((x) => x.id === playerId)
    if (!p) return ''
    const wep = WEAPONS[p.weaponIndex]
    return (
      `tick=${String(snap.tick).padStart(4)}  P${playerId}  ` +
      `pos=(${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)})  ` +
      `aim=${Math.round((p.aim * 180) / Math.PI)}°  ` +
      `hp=${p.hp}  ${wep?.shortName ?? '?'}=${p.ammo[p.weaponIndex] ?? 0}/${p.reserveAmmo[p.weaponIndex] ?? 0}  ` +
      `shield=${p.shieldTimer > 0 ? p.shieldHp : '-'}  dollCharges=${p.dollCharges}  ` +
      `K/D=${p.kills}/${p.deaths}  proj=${snap.projectiles.length}  ` +
      `obs=${snap.obstacles.length}  ` +
      `score R/B/G=${snap.scores.red ?? 0}/${snap.scores.blue ?? 0}/${snap.scores.green ?? 0}`
    )
  }
}
