// core/sim/landmarks.ts —— 战场静态地标与出生点配置
// 布局语义说明：
//   - 世界尺寸 13200×4400，四面完全封闭（顶部完整天花板 y=280..360 无任何入口，底部基岩 y>=2800，左右两侧实心边界墙）；
//   - 出生点平面（y=1760）以下为地下区域，采用狭窄地道（高 120~160px）与竖井构建；
//   - FFA 出生点在全图均匀设置（覆盖左/右主平台、天空拱形岛群与地下狭窄地道）；
//   - 靠近地图中间的位置设置弹药刷新点（覆盖正中拱顶、近中心左右主平台及地下中央地道）；
//   - 其余互动道具（迫击炮/瞭望塔/传送门/跳台/补给箱/地雷及据点 A/B/D/E）均封印在天花板顶面（CEILING_STAND = 264），不设任何入口；
//   - 所有旗帜初始均处于未占领状态（ownerTeam: null），正中拱顶（x=6600, y=664）放置正中复活点与旗帜 C，占领后可选中或按 E 选中。
import { MAIN_DECK_TOP, ARCH_CENTER_TOP } from '../map.ts'
import type { Mortar, Watchtower, WarpPortal, TeamId } from '../types.ts'

export const BODY_HALF_W = 10
export const BODY_TOP = 26      // 眼位（p.y 是脚底基准）
export const BODY_BOTTOM = 16

export const CEILING_STAND = 264                        // 天花板顶面（280）上方的站立 y（封印区）
export const GROUND_STAND = 2740                        // 底层地面（2800）上方的站立 y
export const MAIN_DECK_STAND = MAIN_DECK_TOP - 16       // 中层左右主平台（1760）站立 y = 1744
export const CENTER_RESPAWN_X = 6600                    // 地图正中央复活点与旗帜 x
export const CENTER_RESPAWN_Y = ARCH_CENTER_TOP - 16    // 正中央拱顶方块（680）站立 y = 664
export const HOLE_X0 = 6600
export const HOLE_X1 = 6600

/** 正中央复活点（与中央旗帜 cp_c 同位置，占领后可选中或按 E 选中） */
export const CENTER_RESPAWN_POINT = {
  id: 'cp_c',
  code: 'C',
  name: '正中复活点',
  x: CENTER_RESPAWN_X,
  y: CENTER_RESPAWN_Y,
}

/** 全图均匀分布的 FFA 出生点列表（横跨左中右主平台、天空拱岛与地下狭窄地道） */
export const FFA_SPAWN_POINTS: { x: number; y: number; team: TeamId; label: string }[] = [
  { x: 1180, y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·西翼平台' },
  { x: 2400, y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·中西平台' },
  { x: 3100, y: 700 - 16, team: 'ffa', label: 'FFA·西拱浮岛' },
  { x: 4380, y: 560 - 16, team: 'ffa', label: 'FFA·左峰拱岛' },
  { x: 4500, y: 2500 - 16, team: 'ffa', label: 'FFA·西区地道' },
  { x: 5500, y: 760 - 16, team: 'ffa', label: 'FFA·中西拱岛' },
  { x: 7780, y: 560 - 16, team: 'ffa', label: 'FFA·右峰拱岛' },
  { x: 8500, y: 2500 - 16, team: 'ffa', label: 'FFA·东区地道' },
  { x: 9990, y: 920 - 16, team: 'ffa', label: 'FFA·东拱浮岛' },
  { x: 10800, y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·中东平台' },
  { x: 12020, y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·东翼平台' },
]

/** 固定出生点：包含左右队伍主基地、正中复活点，以及在全图均匀分布的 FFA 出生点 */
export const SPAWN_POINTS: { x: number; y: number; team: TeamId }[] = [
  { x: 260, y: MAIN_DECK_STAND, team: 'red' },
  { x: 12940, y: MAIN_DECK_STAND, team: 'blue' },
  { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, team: 'green' },
  ...FFA_SPAWN_POINTS.map(({ x, y, team }) => ({ x, y, team })),
]

/** 弹药刷新点：全部设置在靠近地图中间的位置（正中拱顶、近中心拱岛、左右主平台内侧端点及地下中央地道） */
export const AMMO_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 4950, y: MAIN_DECK_STAND, area: '中心西·主平台内侧弹药点' },
  { x: 5500, y: 760 - 16, area: '中心西·拱桥弹药点' },
  { x: 6320, y: CENTER_RESPAWN_Y, area: '正中拱顶·西侧弹药点' },
  { x: 6880, y: CENTER_RESPAWN_Y, area: '正中拱顶·东侧弹药点' },
  { x: 7780, y: 560 - 16, area: '中心东·拱桥弹药点' },
  { x: 8250, y: MAIN_DECK_STAND, area: '中心东·主平台内侧弹药点' },
  { x: 6500, y: 2800 - 16, area: '地下中央狭道·核心弹药点' },
]

/** 特武补给箱刷新点：全部封印在天花板顶面 */
export const SUPPLY_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 1500, y: CEILING_STAND, area: '天花板·西区补给点' },
  { x: 3100, y: CEILING_STAND, area: '天花板·中西补给点' },
  { x: 4300, y: CEILING_STAND, area: '天花板·中央西补给点' },
  { x: 5400, y: CEILING_STAND, area: '天花板·中区左补给点' },
  { x: 7800, y: CEILING_STAND, area: '天花板·中区右补给点' },
  { x: 10300, y: CEILING_STAND, area: '天花板·东区补给点' },
]

/** 特殊补给位（替身人偶）：全部封印在天花板顶面 */
export const DOLL_SUPPLY_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 4600, y: CEILING_STAND, area: '天花板·中央西特殊补给点' },
  { x: 8560, y: CEILING_STAND, area: '天花板·东区特殊补给点' },
]

/** 公共迫击炮：全部封印在天花板顶面 */
export const MORTARS_INIT: Omit<Mortar, 'cooldown' | 'operatorId'>[] = [
  { id: 'mortar_left', name: '西区迫击炮', x: 920, y: CEILING_STAND, angle: -Math.PI * 0.28, power: 24.0 },
  { id: 'mortar_mid_w', name: '中央西迫击炮', x: 3300, y: CEILING_STAND, angle: -Math.PI * 0.30, power: 23.0 },
  { id: 'mortar_center', name: '中央迫击炮', x: 5400, y: CEILING_STAND, angle: -Math.PI * 0.35, power: 24.5 },
  { id: 'mortar_mid_e', name: '中央东迫击炮', x: 7800, y: CEILING_STAND, angle: -Math.PI * 0.70, power: 23.0 },
  { id: 'mortar_right', name: '东区迫击炮', x: 12260, y: CEILING_STAND, angle: -Math.PI * 0.72, power: 24.0 },
]

/** 预设感应地雷：全部封印在天花板顶面 */
export const MINE_PRESETS: { x: number; y: number }[] = [
  { x: 1720, y: CEILING_STAND }, { x: 3900, y: CEILING_STAND }, { x: 5400, y: CEILING_STAND },
  { x: 7800, y: CEILING_STAND }, { x: 10200, y: CEILING_STAND }, { x: 11420, y: CEILING_STAND },
]

/** 瞭望塔：全部封印在天花板顶面 */
export const WATCHTOWERS: Watchtower[] = [
  { id: 'tower_1', name: '西部瞭望塔', x: 3700, y: CEILING_STAND, operatorId: null },
  { id: 'tower_2', name: '中西瞭望塔', x: 5400, y: CEILING_STAND, operatorId: null },
  { id: 'tower_3', name: '中央东瞭望塔', x: 7800, y: CEILING_STAND, operatorId: null },
  { id: 'tower_4', name: '东部瞭望塔', x: 11900, y: CEILING_STAND, operatorId: null },
]

/** 量子传送门：全部封印在天花板顶面 */
export const WARP_PORTALS: WarpPortal[] = [
  { id: 'warp_1', name: 'W1 西区传送门', x: 880, y: CEILING_STAND, targetId: 'warp_2', color: '#06b6d4' },
  { id: 'warp_2', name: 'W2 中西传送门', x: 3150, y: CEILING_STAND, targetId: 'warp_1', color: '#06b6d4' },
  { id: 'warp_3', name: 'W3 中央传送门', x: 4700, y: CEILING_STAND, targetId: 'warp_4', color: '#a855f7' },
  { id: 'warp_4', name: 'W4 中东传送门', x: 10000, y: CEILING_STAND, targetId: 'warp_3', color: '#a855f7' },
  { id: 'warp_5', name: 'W5 中央东传送门', x: 5400, y: CEILING_STAND, targetId: 'warp_6', color: '#10b981' },
  { id: 'warp_6', name: 'W6 东区传送门', x: 12280, y: CEILING_STAND, targetId: 'warp_5', color: '#10b981' },
]

/** 随机安全出生候选点（与均匀分布的 FFA 出生点及各层安全平台对齐，绝不进入天花板封印区） */
export const RANDOM_SPAWN_CANDIDATES: { x: number; y: number }[] = [
  { x: 1180, y: MAIN_DECK_STAND - 20 },
  { x: 2400, y: MAIN_DECK_STAND - 20 },
  { x: 3600, y: MAIN_DECK_STAND - 20 },
  { x: 4700, y: MAIN_DECK_STAND - 20 },
  { x: 3100, y: 700 - 36 },
  { x: 4380, y: 560 - 36 },
  { x: 5500, y: 760 - 36 },
  { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y - 24 },
  { x: 7780, y: 560 - 36 },
  { x: 8940, y: 740 - 36 },
  { x: 9990, y: 920 - 36 },
  { x: 8500, y: MAIN_DECK_STAND - 20 },
  { x: 9600, y: MAIN_DECK_STAND - 20 },
  { x: 10800, y: MAIN_DECK_STAND - 20 },
  { x: 12020, y: MAIN_DECK_STAND - 20 },
  { x: 4500, y: 2500 - 24 },
  { x: 6500, y: 2800 - 24 },
  { x: 8500, y: 2500 - 24 },
]

/** 弹射跳台：全部封印在天花板顶面 */
export const JUMP_PADS: { x: number; y: number; vx: number; vy: number }[] = [
  { x: 1000, y: 280, vx: 210, vy: -810 },
  { x: 4300, y: 280, vx: 180, vy: -870 },
  { x: 10400, y: 280, vx: -180, vy: -870 },
  { x: 13050, y: 280, vx: -210, vy: -810 },
]

/** 占领点旗帜：
 *  - cp_a / cp_b / cp_d / cp_e 封印在天花板顶面，且全部处于未占领状态（ownerTeam: null）；
 *  - cp_c 位于地图正中央拱顶方块（x=6600, y=664），与正中复活点在一起，初始同样处于未占领状态（ownerTeam: null），
 *    占领后可被选中或按 E 选中作为复活点。 */
export const CP_INITS: { id: string; code: string; name: string; x: number; y: number; ownerTeam: TeamId | null }[] = [
  { id: 'cp_a', code: 'A', name: '据点A·西区', x: 1720, y: CEILING_STAND, ownerTeam: null },
  { id: 'cp_b', code: 'B', name: '据点B·中央西', x: 3900, y: CEILING_STAND, ownerTeam: null },
  { id: 'cp_c', code: 'C', name: '正中复活点', x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, ownerTeam: null },
  { id: 'cp_d', code: 'D', name: '据点D·中东', x: 7800, y: CEILING_STAND, ownerTeam: null },
  { id: 'cp_e', code: 'E', name: '据点E·东区', x: 11420, y: CEILING_STAND, ownerTeam: null },
]
