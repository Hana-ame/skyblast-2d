// core/map.ts —— 地图数据（编辑器与游戏共用）：平台/掩体/方块 的矩形列表
// 地形=一张平地 + 这些矩形；双轴环形世界坐标（13200×4400，地表 y=2800）。
// 上下限设定：下限=地板（世界内置整块平地 y>=2800），上限=天花板（用户指定完整平面、正中留空）。
import { WORLD_W } from './wrap.ts'

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

/** 天花板（上限）：完整实心薄板，放到世界最上面，顶面 y=280、厚 80（底面 360）；只在正中留一个空口供上下通行。
 *  板上方（y 0~280）是空区，放瞭望塔等互动元素（它们从板顶向上）。
 *  空口 x 5600~7600（宽 2000，中心 6600）。 */
export const CEILING_TOP = 280
export const CEILING_THICK = 80
export const CEILING_HOLE_X0 = 5600
export const CEILING_HOLE_X1 = 7600

/** 默认地图：纯平地（地板，世界内置）+ 一整块天花板（上限，正中留空）。
 *  空口内加一排正方形不可摧毁方块落脚点，呈拱形（中间高、两侧低），隔一个放一个、相邻一高一低。
 *  所有道具（跳台/迫击炮/瞭望塔/旗帜/地雷等）都搬到了天花板顶面（见 sim/world.ts 的坐标）。 */
export function defaultMapData(): MapData {
  const solids: MapSolid[] = [
    // 天花板左板（环形 x 0~5600）
    { x: 0, y: CEILING_TOP, w: CEILING_HOLE_X0, h: CEILING_THICK, kind: 'platform' },
    // 天花板右板（环形 x 7600~13200）
    { x: CEILING_HOLE_X1, y: CEILING_TOP, w: WORLD_W - CEILING_HOLE_X1, h: CEILING_THICK, kind: 'platform' },
    // 空口拱形方块落脚点：正方形 160×160，不可摧毁（block=实心地形），中间高两侧低、相邻一高一低
    ...ARCH_BLOCKS(),
  ]
  return { name: '天花板竞技场', solids }
}

/** 拱形方块（落脚点，非梯子）：空口 x 5600~7600 内一排 7 个正方形（边长 160），中心 x 5700..7500 步长 300。
 *  顶面 y 从两侧 2700 升到中间 2400（拱形），相邻方块一高一低交错（间隔放置）。
 *  玩家从地面喷气可跳上方块（落脚），但**上不去天花板**（用户：天花板纯上限，不让玩家爬上去）。
 *  方块贴近地面、位于空口内，玩家跳方块落脚观赏，不构成通往天花板（板顶 280）的梯子。 */
function ARCH_BLOCKS(): MapSolid[] {
  const SIDE = 160
  const xs = [5700, 6000, 6300, 6600, 6900, 7200, 7500]
  const tops = [2700, 2500, 2620, 2400, 2620, 2500, 2700]
  return xs.map((x, i) => ({ x: x - SIDE / 2, y: tops[i], w: SIDE, h: SIDE, kind: 'block' as const }))
}

/** 校验/清洗外部地图 JSON（编辑器导入、localStorage） */
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
