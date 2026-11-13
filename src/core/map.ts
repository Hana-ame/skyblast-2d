// core/map.ts —— 地图数据（编辑器与游戏共用）：平台/掩体/方块 的矩形列表
// 世界尺寸 13200×4400：
//   1. 四面完全封闭（顶部完整天花板 y=280..360，底部基岩 BEDROCK_TOP=4160..4400，左右两侧实心边界墙）；
//   2. 地下横向地板采用薄层厚度（厚 120px，保持三层 160px 高通道 y=3440..3600、y=3720..3880、y=4000..4160），
//      主地面位于 y=3280..3440（厚 160px，含 6 处可站人凹陷坑，且有三个凹坑的主地面段 x=680..6000 完整连续不留空洞）；
//   3. 左右基地外第一个挡板方块改矮（高 140px, y=3140..3280），方便出生后轻松跳跃/飞行翻越；
//   4. 空中 27 座 260×260 交错正方形构成的拱桥大幅拉升高度（从两侧 y=2940 高高拱起至正中央 y=980），
//      正中空中（x=6600, y=2200，高度正好为世界/2）悬浮放置高斯枪补给（不放垫脚方块实体）；
//   5. 左右完全严格对称：从两侧内拱高点（L10/R10, y=1240）向左上/右上延伸 80×80 小正方形极限飞行阶梯，
//      直达天花板下方更靠近中间的左、右两座 M249 武器台（左 x=3380、右 x=9720, y=520，左右对称各一把 M249）；
//   6. 中央地下地形去掉 H 中间横着的挡板：中央竖井（x=6460..6740）从地面开口直通最底层 y=4160，最底部正中央放置引力枪；
//   7. 地下通道不放小箱子，采用「上连续下分段」横板组 + 两座跨层竖向长块（y=3600..4000） + 「上分段下连续」横板组对称构成。
import { WORLD_W, WORLD_H } from './wrap.ts'

export type MapSolidKind = 'cover' | 'platform' | 'block'

export interface MapSolid {
  x: number
  y: number
  w: number
  h: number
  kind: MapSolidKind
}

export interface MapData {
  name?: string
  solids: MapSolid[]
}

export const CEILING_TOP = 280
export const CEILING_THICK = 80
export const CEILING_HOLE_X0 = 6600
export const CEILING_HOLE_X1 = 6600

export const BEDROCK_TOP = 4160
export const WALL_THICK = 60
export const TUNNEL_HEIGHT = 160
export const UNDERGROUND_FLOOR_THICK = 120
export const MAIN_DECK_TOP = 3280
export const MAIN_DECK_THICK = 160
export const FIRST_COVER_HEIGHT = 140

export const CENTER_SHAFT_W = 280
export const CENTER_SHAFT_X0 = (WORLD_W - CENTER_SHAFT_W) / 2 // 6460
export const CENTER_SHAFT_X1 = CENTER_SHAFT_X0 + CENTER_SHAFT_W // 6740

export const GROUND_PIT_OPEN_W = 240
export const GROUND_PIT_DEPTH = 80
export const GROUND_PIT_FLOOR_TOP = MAIN_DECK_TOP + GROUND_PIT_DEPTH        // 3360
export const GROUND_PIT_FLOOR_THICK = MAIN_DECK_THICK - GROUND_PIT_DEPTH   // 80

export const SKY_SQUARE_SIZE = 260
export const ARCH_CENTER_TOP = 980

/** 正中空中高斯枪位置参数（保留导出兼容，不生成垫脚方块实体） */
export const GAUSS_CENTER_PERCH_SIZE = 0
export const GAUSS_CENTER_PERCH_X = WORLD_W / 2 // 6600
export const GAUSS_CENTER_PERCH_Y = WORLD_H / 2 // 2200

export const STAIR_SMALL_SQUARE_SIZE = 80
export const M249_PERCH_SIZE = 100
export const M249_PERCH_Y = 520
export const M249_LEFT_PERCH_X = 3380
export const M249_RIGHT_PERCH_X = WORLD_W - M249_LEFT_PERCH_X - M249_PERCH_SIZE // 9720
export const M249_PERCH_X = M249_RIGHT_PERCH_X

export const UNIFIED_EDGE_HIGHLIGHT = '#38bdf8'

function mirrorSolid(s: MapSolid): MapSolid {
  return {
    x: WORLD_W - s.x - s.w,
    y: s.y,
    w: s.w,
    h: s.h,
    kind: s.kind,
  }
}

function mirrorPairs(leftSolids: MapSolid[]): MapSolid[] {
  return [
    ...leftSolids,
    ...leftSolids.map(mirrorSolid),
  ]
}

/** 默认地图：高耸交错方形拱桥(y=2940→980) + 正中无垫脚悬浮高斯枪(6600,2200) + 近中双M249阶梯 + 矮首挡板完整三凹坑地面 + 无中横板直通底端引力枪 */
export function defaultMapData(): MapData {
  const leftThickGroundWithPits: MapSolid[] = [
    { x: WALL_THICK, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: 'platform' },
    { x: 740, y: MAIN_DECK_TOP - FIRST_COVER_HEIGHT, w: 120, h: FIRST_COVER_HEIGHT, kind: 'cover' },
    { x: 680, y: MAIN_DECK_TOP, w: 980, h: MAIN_DECK_THICK, kind: 'platform' },
    { x: 1660, y: GROUND_PIT_FLOOR_TOP, w: GROUND_PIT_OPEN_W, h: GROUND_PIT_FLOOR_THICK, kind: 'platform' },
    { x: 1900, y: MAIN_DECK_TOP, w: 960, h: MAIN_DECK_THICK, kind: 'platform' },
    { x: 2860, y: GROUND_PIT_FLOOR_TOP, w: GROUND_PIT_OPEN_W, h: GROUND_PIT_FLOOR_THICK, kind: 'platform' },
    { x: 3100, y: MAIN_DECK_TOP, w: 1260, h: MAIN_DECK_THICK, kind: 'platform' },
    { x: 4360, y: GROUND_PIT_FLOOR_TOP, w: GROUND_PIT_OPEN_W, h: GROUND_PIT_FLOOR_THICK, kind: 'platform' },
    { x: 4600, y: MAIN_DECK_TOP, w: 1400, h: MAIN_DECK_THICK, kind: 'platform' },
  ]

  const solids: MapSolid[] = [
    // 1. 四面封闭边界
    { x: 0, y: CEILING_TOP, w: WORLD_W, h: CEILING_THICK, kind: 'platform' },
    ...mirrorPairs([
      { x: 0, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: BEDROCK_TOP - (CEILING_TOP + CEILING_THICK), kind: 'platform' },
    ]),

    // 2. 空中交错正方形拱桥 (y=2940→980) + 左右对称双 M249 阶梯（正中高斯枪无垫脚方块实体）
    ...SKY_ARCH_BLOCKS(),
    ...SYMMETRIC_CORNER_STAIRCASE_BLOCKS(),

    // 3. 完整连续无空洞的主地面（y=3280..3440）+ 左右对称改矮的首个挡板方块 + 6 处可站人凹陷坑
    ...mirrorPairs(leftThickGroundWithPits),

    // 4. 三层薄地板地下隧道（y=3440..4160）
    ...UNDERGROUND_THREE_LAYER_TUNNEL_SOLIDS(),
  ]
  return { name: '高耸方形拱桥·正中悬浮高斯枪·五据点·三层薄板竞技场', solids }
}

function SKY_ARCH_BLOCKS(): MapSolid[] {
  const S = SKY_SQUARE_SIZE
  const leftSquares: MapSolid[] = [
    { x: 1080, y: 2940, w: S, h: S, kind: 'block' },
    { x: 1500, y: 2660, w: S, h: S, kind: 'block' },
    { x: 1920, y: 2380, w: S, h: S, kind: 'block' },
    { x: 2340, y: 2480, w: S, h: S, kind: 'block' },
    { x: 2760, y: 2180, w: S, h: S, kind: 'block' },
    { x: 3180, y: 1900, w: S, h: S, kind: 'block' },
    { x: 3600, y: 2000, w: S, h: S, kind: 'block' },
    { x: 4020, y: 1700, w: S, h: S, kind: 'block' },
    { x: 4440, y: 1420, w: S, h: S, kind: 'block' },
    { x: 4860, y: 1520, w: S, h: S, kind: 'block' },
    { x: 5280, y: 1240, w: S, h: S, kind: 'block' },
    { x: 5700, y: 1340, w: S, h: S, kind: 'block' },
    { x: 6120, y: 1080, w: S, h: S, kind: 'block' },
  ]
  return [
    ...mirrorPairs(leftSquares),
    { x: 6470, y: ARCH_CENTER_TOP, w: S, h: S, kind: 'block' },
  ]
}

function SYMMETRIC_CORNER_STAIRCASE_BLOCKS(): MapSolid[] {
  const s = STAIR_SMALL_SQUARE_SIZE
  const leftStaircase: MapSolid[] = [
    { x: 4780, y: 1040, w: s, h: s, kind: 'block' },
    { x: 4320, y: 860,  w: s, h: s, kind: 'block' },
    { x: 3860, y: 680,  w: s, h: s, kind: 'block' },
    { x: M249_LEFT_PERCH_X, y: M249_PERCH_Y, w: M249_PERCH_SIZE, h: M249_PERCH_SIZE, kind: 'block' },
  ]
  return mirrorPairs(leftStaircase)
}

function UNDERGROUND_THREE_LAYER_TUNNEL_SOLIDS(): MapSolid[] {
  const leftUnderground: MapSolid[] = [
    { x: WALL_THICK, y: 3440, w: 440, h: 560, kind: 'block' },
    { x: 680,  y: 3600, w: 1820, h: UNDERGROUND_FLOOR_THICK, kind: 'platform' },
    { x: 680,  y: 3880, w: 820,  h: UNDERGROUND_FLOOR_THICK, kind: 'platform' },
    { x: 1680, y: 3880, w: 820,  h: UNDERGROUND_FLOOR_THICK, kind: 'platform' },
    { x: 2680, y: 3600, w: 280,  h: 400, kind: 'block' },
    { x: 3220, y: 3600, w: 280,  h: 400, kind: 'block' },
    { x: 3680, y: 3600, w: 1060, h: UNDERGROUND_FLOOR_THICK, kind: 'platform' },
    { x: 4940, y: 3600, w: 1060, h: UNDERGROUND_FLOOR_THICK, kind: 'platform' },
    { x: 3680, y: 3880, w: 2320, h: UNDERGROUND_FLOOR_THICK, kind: 'platform' },
    { x: 6180, y: MAIN_DECK_TOP, w: 280, h: 4000 - MAIN_DECK_TOP, kind: 'block' },
  ]

  return mirrorPairs(leftUnderground)
}

export function carveTunnelInSolids(
  solids: MapSolid[],
  carve: { x: number; y: number; w: number; h: number },
  minSize = 20,
): MapSolid[] {
  const cx0 = carve.x
  const cy0 = carve.y
  const cx1 = carve.x + carve.w
  const cy1 = carve.y + carve.h
  const out: MapSolid[] = []
  for (const s of solids) {
    const sx0 = s.x
    const sy0 = s.y
    const sx1 = s.x + s.w
    const sy1 = s.y + s.h
    if (sx1 <= cx0 || sx0 >= cx1 || sy1 <= cy0 || sy0 >= cy1) {
      out.push(s)
      continue
    }
    if (cy0 - sy0 >= minSize) {
      out.push({ x: sx0, y: sy0, w: s.w, h: cy0 - sy0, kind: s.kind })
    }
    if (sy1 - cy1 >= minSize) {
      out.push({ x: sx0, y: cy1, w: s.w, h: sy1 - cy1, kind: s.kind })
    }
    const midY0 = Math.max(sy0, cy0)
    const midY1 = Math.min(sy1, cy1)
    const midH = midY1 - midY0
    if (midH >= minSize) {
      if (cx0 - sx0 >= minSize) {
        out.push({ x: sx0, y: midY0, w: cx0 - sx0, h: midH, kind: s.kind })
      }
      if (sx1 - cx1 >= minSize) {
        out.push({ x: cx1, y: midY0, w: sx1 - cx1, h: midH, kind: s.kind })
      }
    }
  }
  return out
}

export function sanitizeMapData(raw: unknown): MapData | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { name?: unknown; solids?: unknown }
  const solidsRaw = Array.isArray(o.solids) ? o.solids : []
  const solids: MapSolid[] = []
  for (const s of solidsRaw) {
    if (!s || typeof s !== 'object') continue
    const r = s as Record<string, unknown>
    const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h)
    if (![x, y, w, h].every(Number.isFinite)) continue
    if (w <= 0 || h <= 0) continue
    const kind: MapSolidKind = r.kind === 'platform' || r.kind === 'block' ? r.kind : 'cover'
    solids.push({ x, y, w, h, kind })
    if (solids.length >= 2000) break
  }
  if (solids.length === 0) return null
  return { name: typeof o.name === 'string' ? o.name : '自定义地图', solids }
}

/** 校验从 localStorage 加载的地图是否为有效的当前默认地图或用户自定义地图（自动过滤旧版内置默认地图快照） */
export function isCompatibleSavedMap(m: MapData | null | undefined): m is MapData {
  if (!m || !Array.isArray(m.solids) || m.solids.length === 0) return false
  const name = m.name ?? ''
  if (name === defaultMapData().name || name === '自定义地图' || name === '自定义封闭竞技场') return true
  if (name.includes('拱桥') || name.includes('竞技场')) return false
  return true
}
