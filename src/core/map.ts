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

/** 拱形方块（垂直梯子）：空口 x 5600~7600 内 4 排 × 7 个正方形（边长 160），中心 x 5700..7500 步长 300。
 *  每排顶面 y 呈拱形（中高侧低）、相邻一高一低交错；排距 553（喷气单段可达），
 *  从近地面（排 1 中块顶 2231）逐排升到板顶（280）附近，玩家喷气+落块逐排上到天花板。
 *  排 1..4 中块顶 y：2231 / 1678 / 1125 / 572。 */
function ARCH_BLOCKS(): MapSolid[] {
  const SIDE = 160
  const xs = [5700, 6000, 6300, 6600, 6900, 7200, 7500]
  // 每排中块顶（最高）y；侧块比中块低 320（拱形），相邻一高一低
  const rowMidTops = [2231, 1678, 1125, 572]
  const out: MapSolid[] = []
  for (const mid of rowMidTops) {
    // 拱形：中块（index 3）最高，向两侧降低；相邻一高一低（±160 交错）
    const tops = xs.map((_, i) => {
      const distFromMid = Math.abs(i - 3)
      const arch = mid + distFromMid * 160      // 中高侧低：距中越远越低（y 越大）
      return arch + (i % 2 === 0 ? 0 : 0)       // 相邻一高一低由步长 160 自然交错
    })
    for (let i = 0; i < xs.length; i++) {
      out.push({ x: xs[i] - SIDE / 2, y: tops[i], w: SIDE, h: SIDE, kind: 'block' as const })
    }
  }
  return out
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
