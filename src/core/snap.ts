// core/snap.ts —— 快照类型（core 与 net/ui 的共享边界）
// 合并改造：v2 的动态实体全量进快照 —— 这是「战略层同步」的根（v2 各端平行宇宙 bug 的解法）
import type { PlayerState, Projectile, Grenade, Landmine, Airstrike, Obstacle, CapturePoint, AmmoPack, SupplyCrate, Mortar, Watchtower, WarpPortal, TeamId } from './types.ts'

export interface ScoreBoard {
  [team: string]: number
}

export interface WorldSnapshot {
  tick: number
  seed: number          // 服务器 RNG 种子（客户端可重放确定性过程）
  players: PlayerState[]
  projectiles: Projectile[]
  grenades: Grenade[]
  landmines: Landmine[]
  airstrikes: Airstrike[]
  obstacles: Obstacle[]              // 可破坏障碍物（含血量；离散实体不做插值）
  capturePoints: CapturePoint[]      // 占点进度（离散状态；progress 可整型化）
  ammoPacks: AmmoPack[]              // 一次性弹药点
  supplyCrates: SupplyCrate[]        // 特武补给箱
  mortars: Mortar[]                  // 迫击炮台状态（operatorId/cooldown）
  scores: ScoreBoard
}

/** 静态地图（hello 阶段一次性下发，不进 20Hz 快照） */
export interface StaticMap {
  watchtowers: Watchtower[]
  warpPortals: WarpPortal[]
}
