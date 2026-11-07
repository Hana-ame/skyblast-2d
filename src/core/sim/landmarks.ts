// core/sim/landmarks.ts —— 战场静态地标与出生点配置（从 world.ts 拆出，消除硬编码常量堆积）
// 布局语义说明：
//   - 世界尺寸 13200×4400（双轴环形无缝衔接），主地面位于 SURFACE_Y = 2800（站立 y = 2740）；
//   - 顶部天花板战术层位于 y = 280（站立 y = 264，正中 x = 5600..7600 留有 2000px 通行空口与拱形落脚方块）；
//   - 所有固定/随机出生点严格位于主地面（GROUND_STAND = 2740），战略互动点（据点/迫击炮/瞭望塔/传送门/跳台）分布于天花板顶面与地面要道。
import { WORLD_W, SURFACE_Y } from '../wrap.ts'
import type { Mortar, Watchtower, WarpPortal, TeamId } from '../types.ts'

export const BODY_HALF_W = 10
export const BODY_TOP = 26      // 眼位（p.y 是脚底基准）
export const BODY_BOTTOM = 16

export const CEILING_STAND = 264    // 天花板顶面（280）上方的站立 y
export const GROUND_STAND = 2740    // 地面（2800）上方的站立 y
export const HOLE_X0 = 5600         // 天花板中央空口左界
export const HOLE_X1 = 7600         // 天花板中央空口右界

export const SPAWN_POINTS: { x: number; y: number; team: TeamId }[] = [
  { x: 1100, y: GROUND_STAND, team: 'red' },
  { x: 12100, y: GROUND_STAND, team: 'blue' },
  { x: 3300, y: GROUND_STAND, team: 'green' },
  { x: 9900, y: GROUND_STAND, team: 'ffa' },
]

export const AMMO_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 1300, y: GROUND_STAND, area: '西区平地' },
  { x: 2100, y: GROUND_STAND, area: '西区平台下' },
  { x: 2900, y: GROUND_STAND, area: '中西平地' },
  { x: 4600, y: CEILING_STAND, area: '天花板·中央西' },
  { x: 5400, y: CEILING_STAND, area: '天花板·空口左' },
  { x: 7800, y: CEILING_STAND, area: '天花板·空口右' },
  { x: 10200, y: CEILING_STAND, area: '天花板·东区' },
]

export const SUPPLY_SPOTS: { x: number; y: number; area: string }[] = [
  { x: 1500, y: GROUND_STAND, area: '西区补给点' },
  { x: 3100, y: GROUND_STAND, area: '中西补给点' },
  { x: 4300, y: CEILING_STAND, area: '天花板·中央西补给点' },
  { x: 5400, y: CEILING_STAND, area: '天花板·空口左补给点' },
  { x: 7800, y: CEILING_STAND, area: '天花板·空口右补给点' },
  { x: 10300, y: CEILING_STAND, area: '天花板·东区补给点' },
]

/** 特殊补给位：只出「替身人偶」（不在常规配装里） */
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

export const RANDOM_SPAWN_CANDIDATES: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = []
  for (let x = 400; x < WORLD_W; x += 620) out.push({ x, y: SURFACE_Y - 60 })
  for (const sp of SPAWN_POINTS) out.push({ x: sp.x, y: sp.y - 60 })
  return out
})()

export const JUMP_PADS: { x: number; y: number; vx: number; vy: number }[] = [
  { x: 1000, y: 280, vx: 210, vy: -810 },
  { x: 4300, y: 280, vx: 180, vy: -870 },
  { x: 10400, y: 280, vx: -180, vy: -870 },
  { x: 13050, y: 280, vx: -210, vy: -810 },
]

export const CP_INITS: { id: string; code: string; name: string; x: number; y: number; ownerTeam: TeamId | null }[] = [
  { id: 'cp_a', code: 'A', name: '据点A·西区', x: 1720, y: CEILING_STAND, ownerTeam: 'red' },
  { id: 'cp_b', code: 'B', name: '据点B·中央西', x: 3900, y: CEILING_STAND, ownerTeam: null },
  { id: 'cp_c', code: 'C', name: '据点C·中央', x: 5400, y: CEILING_STAND, ownerTeam: 'green' },
  { id: 'cp_d', code: 'D', name: '据点D·中东', x: 7800, y: CEILING_STAND, ownerTeam: null },
  { id: 'cp_e', code: 'E', name: '据点E·东区', x: 11420, y: CEILING_STAND, ownerTeam: 'blue' },
]
