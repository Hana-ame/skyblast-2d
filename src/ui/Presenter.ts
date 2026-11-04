// ui/Presenter.ts —— 界面逻辑层：把快照 → 视图模型 → 可读呈现（不调网络/输入内部）
import type { HUDViewModel } from './HUDViewModel.ts'
import type { WorldSnapshot } from '../core/types.ts'

export class Presenter {
  private hud: HUDViewModel

  constructor(hud: HUDViewModel) {
    this.hud = hud
  }

  /** 快照 → HUD 视图模型（供渲染层消费） */
  render(snap: WorldSnapshot, playerId: number): void {
    this.hud.update(snap, playerId)
  }

  /** 生成一行的对局可读摘要（演示/日志用） */
  describe(snap: WorldSnapshot, playerId: number): string {
    const p = snap.players.find((x) => x.id === playerId)
    if (!p) return ''
    return (
      `tick=${String(snap.tick).padStart(4)}  P${playerId}  ` +
      `pos=(${p.pos.x.toFixed(0).padStart(3)},${p.pos.y.toFixed(0).padStart(3)})  ` +
      `aim=${Math.round((p.aim * 180) / Math.PI).toString().padStart(3)}°  ` +
      `hp=${p.hp.toString().padStart(3)}  ammo=${p.ammo}  K/D=${p.kills}/${p.deaths}  ` +
      `proj=${snap.projectiles.length}`
    )
  }
}
