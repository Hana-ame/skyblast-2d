// core/sim/landmarks.ts —— 战场静态地标与出生点配置
//   - 正中空中、高度正好为世界/2 的位置（x=6600, y=2200，无垫脚方块实体）放置高斯枪（weaponId=4）；
//   - 左右两侧阶梯顶端（x=3430, y=504 与 x=9770, y=504）对称放置两把 M249（weaponId=5）；
//   - 地下正中央最底部（x=6600, y=4144）放置引力枪（weaponId=6）。
import {
  MAIN_DECK_TOP, ARCH_CENTER_TOP, BEDROCK_TOP,
  M249_LEFT_PERCH_X, M249_RIGHT_PERCH_X, M249_PERCH_Y, M249_PERCH_SIZE,
} from '../map.ts'
import type { Mortar, Watchtower, WarpPortal, TeamId } from '../types.ts'

export const BODY_HALF_W = 10
export const BODY_TOP = 26
export const BODY_BOTTOM = 16

export const CEILING_STAND = 264
export const GROUND_STAND = BEDROCK_TOP - 60
export const MAIN_DECK_STAND = MAIN_DECK_TOP - 16       // 3264
export const CENTER_RESPAWN_X = 6600
export const CENTER_RESPAWN_Y = ARCH_CENTER_TOP - 16    // 964
export const GAUSS_CENTER_X = 6600                      // 世界正中心 x = 6600
export const GAUSS_CENTER_Y = 2200                      // 世界高度正中心 y = WORLD_H / 2 = 2200（空中无垫脚方块）
export const M249_LEFT_SKY_X = M249_LEFT_PERCH_X + M249_PERCH_SIZE / 2   // 3430
export const M249_RIGHT_SKY_X = M249_RIGHT_PERCH_X + M249_PERCH_SIZE / 2 // 9770
export const M249_SKY_X = M249_RIGHT_SKY_X
export const M249_SKY_Y = M249_PERCH_Y - 16             // 504
export const GRAVITY_BOTTOM_X = 6600
export const GRAVITY_BOTTOM_Y = BEDROCK_TOP - 16        // 4144
export const HOLE_X0 = 6600
export const HOLE_X1 = 6600

export const CENTER_RESPAWN_POINT = {
  id: 'cp_c',
  code: 'C',
  name: '正中复活点',
  x: CENTER_RESPAWN_X,
  y: CENTER_RESPAWN_Y,
}

/** FFA 出生点数量翻倍（12 → 24，左右严格对称且全部对齐各自平台中心） */
export const FFA_SPAWN_POINTS: { x: number; y: number; team: TeamId; label: string }[] = [
  { x: 1170,  y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·西翼地面' },
  { x: 1630,  y: 2660 - 16,       team: 'ffa', label: 'FFA·西低方岛' },
  { x: 2050,  y: 2380 - 16,       team: 'ffa', label: 'FFA·西中方岛' },
  { x: 2380,  y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·中西地面' },
  { x: 2470,  y: 2480 - 16,       team: 'ffa', label: 'FFA·西外方岛' },
  { x: 3310,  y: 1900 - 16,       team: 'ffa', label: 'FFA·西中拱岛' },
  { x: 3730,  y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·西中地面' },
  { x: 3730,  y: 2000 - 16,       team: 'ffa', label: 'FFA·西高方岛' },
  { x: 4210,  y: 3600 - 16,       team: 'ffa', label: 'FFA·西区上层地道' },
  { x: 4300,  y: 3880 - 16,       team: 'ffa', label: 'FFA·西区中层地道' },
  { x: 4570,  y: 1420 - 16,       team: 'ffa', label: 'FFA·中西高方岛' },
  { x: 5300,  y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·中心西地面' },
  { x: 7900,  y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·中心东地面' },
  { x: 8630,  y: 1420 - 16,       team: 'ffa', label: 'FFA·中东高方岛' },
  { x: 8900,  y: 3880 - 16,       team: 'ffa', label: 'FFA·东区中层地道' },
  { x: 8990,  y: 3600 - 16,       team: 'ffa', label: 'FFA·东区上层地道' },
  { x: 9470,  y: 2000 - 16,       team: 'ffa', label: 'FFA·东高方岛' },
  { x: 9470,  y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·东中地面' },
  { x: 9890,  y: 1900 - 16,       team: 'ffa', label: 'FFA·东中拱岛' },
  { x: 10730, y: 2480 - 16,       team: 'ffa', label: 'FFA·东外方岛' },
  { x: 10820, y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·中东地面' },
  { x: 11150, y: 2380 - 16,       team: 'ffa', label: 'FFA·东中方岛' },
  { x: 11570, y: 2660 - 16,       team: 'ffa', label: 'FFA·东低方岛' },
  { x: 12030, y: MAIN_DECK_STAND, team: 'ffa', label: 'FFA·东翼地面' },
]

export const SPAWN_POINTS: { x: number; y: number; team: TeamId }[] = [
  { x: 260, y: MAIN_DECK_STAND, team: 'red' },
  { x: 12940, y: MAIN_DECK_STAND, team: 'blue' },
  { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, team: 'green' },
  ...FFA_SPAWN_POINTS.map(({ x, y, team }) => ({ x, y, team })),
]

export const AMMO_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 4950, y: MAIN_DECK_STAND,  area: '中心西·主地面内侧弹药点' },
  { x: 4570, y: 1420 - 16,        area: '中心西·中拱方岛弹药点' },
  { x: 5410, y: 1240 - 16,        area: '中心西·内拱方岛弹药点' },
  { x: 6250, y: 1080 - 16,        area: '正中西侧·拱顶方岛弹药点' },
  { x: 6950, y: 1080 - 16,        area: '正中东侧·拱顶方岛弹药点' },
  { x: 7790, y: 1240 - 16,        area: '中心东·内拱方岛弹药点' },
  { x: 8630, y: 1420 - 16,        area: '中心东·中拱方岛弹药点' },
  { x: 8250, y: MAIN_DECK_STAND,  area: '中心东·主地面内侧弹药点' },
  { x: 4200, y: 3600 - 16,        area: '地下西区·一层通道弹药点' },
  { x: 9000, y: 3600 - 16,        area: '地下东区·一层通道弹药点' },
  { x: 3090, y: 4160 - 16,        area: '地下西区·底层通道弹药点' },
  { x: 10110, y: 4160 - 16,       area: '地下东区·底层通道弹药点' },
]

export const SUPPLY_SPOTS: { x: number; y: number; area: string; weaponId?: number }[] = [
  { x: 1500,            y: CEILING_STAND,    area: '天花板·西区补给点', weaponId: 4 },
  { x: 10300,           y: CEILING_STAND,    area: '天花板·东区补给点', weaponId: 4 },
  { x: GAUSS_CENTER_X,  y: GAUSS_CENTER_Y,   area: '正中空中(世界/2)·高斯枪补给点', weaponId: 4 },
  { x: M249_LEFT_SKY_X, y: M249_SKY_Y,       area: '左翼阶梯·天花板下M249补给点', weaponId: 5 },
  { x: M249_RIGHT_SKY_X, y: M249_SKY_Y,      area: '右翼阶梯·天花板下M249补给点', weaponId: 5 },
  { x: GRAVITY_BOTTOM_X, y: GRAVITY_BOTTOM_Y, area: '地下中央竖井最底部·引力枪补给点', weaponId: 6 },
]

export const DOLL_SUPPLY_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 4600, y: CEILING_STAND, area: '天花板·中央西特殊补给点' },
  { x: 8560, y: CEILING_STAND, area: '天花板·东区特殊补给点' },
]

export const MORTARS_INIT: Omit<Mortar, 'cooldown' | 'operatorId'>[] = [
  { id: 'mortar_left', name: '西区迫击炮', x: 920, y: CEILING_STAND, angle: -Math.PI * 0.28, power: 24.0 },
  { id: 'mortar_mid_w', name: '中央西迫击炮', x: 3300, y: CEILING_STAND, angle: -Math.PI * 0.30, power: 23.0 },
  { id: 'mortar_center', name: '中央迫击炮', x: 5400, y: CEILING_STAND, angle: -Math.PI * 0.35, power: 24.5 },
  { id: 'mortar_mid_e', name: '中央东迫击炮', x: 7800, y: CEILING_STAND, angle: -Math.PI * 0.70, power: 23.0 },
  { id: 'mortar_right', name: '东区迫击炮', x: 12260, y: CEILING_STAND, angle: -Math.PI * 0.72, power: 24.0 },
]

export const MINE_PRESETS: { x: number; y: number }[] = [
  { x: 1720, y: CEILING_STAND }, { x: 3900, y: CEILING_STAND }, { x: 5400, y: CEILING_STAND },
  { x: 7800, y: CEILING_STAND }, { x: 10200, y: CEILING_STAND }, { x: 11420, y: CEILING_STAND },
]

export const WATCHTOWERS: Watchtower[] = [
  { id: 'tower_1', name: '西部瞭望塔', x: 3700, y: CEILING_STAND, operatorId: null },
  { id: 'tower_2', name: '中西瞭望塔', x: 5400, y: CEILING_STAND, operatorId: null },
  { id: 'tower_3', name: '中央东瞭望塔', x: 7800, y: CEILING_STAND, operatorId: null },
  { id: 'tower_4', name: '东部瞭望塔', x: 11900, y: CEILING_STAND, operatorId: null },
]

export const WARP_PORTALS: WarpPortal[] = [
  { id: 'warp_1', name: 'W1 西区传送门', x: 880, y: CEILING_STAND, targetId: 'warp_2', color: '#06b6d4' },
  { id: 'warp_2', name: 'W2 中西传送门', x: 3150, y: CEILING_STAND, targetId: 'warp_1', color: '#06b6d4' },
  { id: 'warp_3', name: 'W3 中央传送门', x: 4700, y: CEILING_STAND, targetId: 'warp_4', color: '#a855f7' },
  { id: 'warp_4', name: 'W4 中东传送门', x: 10000, y: CEILING_STAND, targetId: 'warp_3', color: '#a855f7' },
  { id: 'warp_5', name: 'W5 中央东传送门', x: 5400, y: CEILING_STAND, targetId: 'warp_6', color: '#10b981' },
  { id: 'warp_6', name: 'W6 东区传送门', x: 12280, y: CEILING_STAND, targetId: 'warp_5', color: '#10b981' },
]

/** 随机出生候选点数量翻倍（20 → 40，全部位于安全地面/方岛上方） */
export const RANDOM_SPAWN_CANDIDATES: { x: number; y: number }[] = [
  { x: 1170,  y: MAIN_DECK_STAND - 20 },
  { x: 1480,  y: MAIN_DECK_STAND - 20 },
  { x: 2100,  y: MAIN_DECK_STAND - 20 },
  { x: 2380,  y: MAIN_DECK_STAND - 20 },
  { x: 2680,  y: MAIN_DECK_STAND - 20 },
  { x: 3350,  y: MAIN_DECK_STAND - 20 },
  { x: 3730,  y: MAIN_DECK_STAND - 20 },
  { x: 4120,  y: MAIN_DECK_STAND - 20 },
  { x: 4900,  y: MAIN_DECK_STAND - 20 },
  { x: 5300,  y: MAIN_DECK_STAND - 20 },
  { x: 5720,  y: MAIN_DECK_STAND - 20 },
  { x: 1630,  y: 2660 - 36 },
  { x: 2050,  y: 2380 - 36 },
  { x: 2470,  y: 2480 - 36 },
  { x: 2890,  y: 2180 - 36 },
  { x: 3310,  y: 1900 - 36 },
  { x: 3730,  y: 2000 - 36 },
  { x: 4150,  y: 1700 - 36 },
  { x: 4570,  y: 1420 - 36 },
  { x: 4990,  y: 1520 - 36 },
  { x: 5410,  y: 1240 - 36 },
  { x: 5830,  y: 1340 - 36 },
  { x: 6250,  y: 1080 - 36 },
  { x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y - 24 },
  { x: 6950,  y: 1080 - 36 },
  { x: 7370,  y: 1340 - 36 },
  { x: 7790,  y: 1240 - 36 },
  { x: 8210,  y: 1520 - 36 },
  { x: 8630,  y: 1420 - 36 },
  { x: 9050,  y: 1700 - 36 },
  { x: 9470,  y: 2000 - 36 },
  { x: 9890,  y: 1900 - 36 },
  { x: 10310, y: 2180 - 36 },
  { x: 10730, y: 2480 - 36 },
  { x: 11150, y: 2380 - 36 },
  { x: 11570, y: 2660 - 36 },
  { x: 7480,  y: MAIN_DECK_STAND - 20 },
  { x: 8300,  y: MAIN_DECK_STAND - 20 },
  { x: 9470,  y: MAIN_DECK_STAND - 20 },
  { x: 10820, y: MAIN_DECK_STAND - 20 },
]

export const JUMP_PADS: { x: number; y: number; vx: number; vy: number }[] = [
  { x: 1000, y: 280, vx: 210, vy: -810 },
  { x: 4300, y: 280, vx: 180, vy: -870 },
  { x: 10400, y: 280, vx: -180, vy: -870 },
  { x: 13050, y: 280, vx: -210, vy: -810 },
]

/** 可占领/按 E 选中的旗帜复活点数量翻倍（5 → 10，全部严格对齐各自平台正中心） */
export const CP_INITS: { id: string; code: string; name: string; x: number; y: number; ownerTeam: TeamId | null }[] = [
  { id: 'cp_a', code: 'A', name: '据点A·地下中西', x: 5470,             y: 3880 - 16,        ownerTeam: null },
  { id: 'cp_b', code: 'B', name: '据点B·西拱半路', x: 3730,             y: 2000 - 16,        ownerTeam: null },
  { id: 'cp_c', code: 'C', name: '正中复活点',     x: CENTER_RESPAWN_X, y: CENTER_RESPAWN_Y, ownerTeam: null },
  { id: 'cp_d', code: 'D', name: '据点D·东拱半路', x: 9470,             y: 2000 - 16,        ownerTeam: null },
  { id: 'cp_e', code: 'E', name: '据点E·地下中东', x: 7730,             y: 3880 - 16,        ownerTeam: null },
  { id: 'cp_f', code: 'F', name: '据点F·西外地面', x: 2380,             y: MAIN_DECK_STAND,  ownerTeam: null },
  { id: 'cp_g', code: 'G', name: '据点G·西内地面', x: 3730,             y: MAIN_DECK_STAND,  ownerTeam: null },
  { id: 'cp_h', code: 'H', name: '据点H·东内地面', x: 9470,             y: MAIN_DECK_STAND,  ownerTeam: null },
  { id: 'cp_i', code: 'I', name: '据点I·东外地面', x: 10820,            y: MAIN_DECK_STAND,  ownerTeam: null },
  { id: 'cp_j', code: 'J', name: '据点J·西区地道', x: 1590,             y: 3600 - 16,        ownerTeam: null },
]
