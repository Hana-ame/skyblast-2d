// core/map.ts —— 地图数据（编辑器与游戏共用）：平台/掩体/方块 的矩形列表
// 地形=内置底部基岩平地 (y>=2800) + 这些矩形；世界尺寸保持 13200×4400（SURFACE_Y=2800）。
// 封闭式双层立体竞技场 + 拱形高低交错天空岛屿 + 地下狭窄地道迷宫：
//   1. 左右、上下四面完全封闭（顶部完整天花板无任何入口，左右两侧实心边界墙与天花板、底部基岩无缝闭合）；
//   2. 顶部天花板上方（y=0..280）封印旧互动道具，无任何入口；
//   3. 中层（y=1760）左右两侧为主战平台（左端出生点+高掩体柱，右端出生点），全图均匀分布 FFA 出生点；
//   4. 出生点平面（y=1760）以下全部为地下区域，采用厚实岩体与狭窄地道（高 120~160px、竖井宽 160~260px）构建；
//   5. 天空为横跨全图的拱形浮空方块群（有上有下高低交错），正中央方块（x=6600）放置中央旗帜与复活点。
import { WORLD_W, SURFACE_Y } from './wrap.ts'

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

/** 天花板（上限）：完整实心薄板，横跨全图 x=0..13200，顶面 y=280、厚 80（底面 360），完全封闭不设任何入口。 */
export const CEILING_TOP = 280
export const CEILING_THICK = 80
export const CEILING_HOLE_X0 = 6600
export const CEILING_HOLE_X1 = 6600

/** 左右边界墙厚度（全封闭） */
export const WALL_THICK = 60

/** 中层主平台顶面 y（出生点平面，此高度以下算作地下狭窄地道区） */
export const MAIN_DECK_TOP = 1760
export const MAIN_DECK_THICK = 40

/** 正中天空拱顶中央方块顶面 y（正中旗帜与复活点所在平面） */
export const ARCH_CENTER_TOP = 680

/** 统一边缘高亮色（全图方块/平台/掩体一致） */
export const UNIFIED_EDGE_HIGHLIGHT = '#38bdf8'

/** 默认地图：四面全封闭 + 拱形有上有下天空岛屿 + 出生点平面以下全狭窄地下地道网 */
export function defaultMapData(): MapData {
  const solids: MapSolid[] = [
    // ── 1. 四面封闭边界（顶部完整无入口天花板 + 左右全高封闭墙；底部由世界内置 SURFACE_Y=2800 封闭） ──
    { x: 0, y: CEILING_TOP, w: WORLD_W, h: CEILING_THICK, kind: 'platform' },
    { x: 0, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: 'platform' },
    { x: WORLD_W - WALL_THICK, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: SURFACE_Y - (CEILING_TOP + CEILING_THICK), kind: 'platform' },

    // ── 2. 天空拱形浮空方块群（有上有下高低交错，正中 x=6600 放置复活点与旗帜） ──
    ...SKY_ARCH_BLOCKS(),

    // ── 3. 中层地表主平台（y=1760，出生点所在平面）+ 左翼高掩体柱 ──
    // 左翼出生台与主平台（x=500..680 留 180px 狭窄竖井通往地下地道）
    { x: WALL_THICK, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: 'platform' },
    { x: 680, y: MAIN_DECK_TOP, w: 4520, h: MAIN_DECK_THICK, kind: 'platform' },
    // 左翼出生点旁高耸掩体柱（对应设计图左侧出生点旁高框）
    { x: 740, y: 1440, w: 120, h: 320, kind: 'cover' },

    // 右翼主平台与出生台（x=12520..12700 留 180px 狭窄竖井通往地下地道）
    { x: 8000, y: MAIN_DECK_TOP, w: 4520, h: MAIN_DECK_THICK, kind: 'platform' },
    { x: 12700, y: MAIN_DECK_TOP, w: 440, h: MAIN_DECK_THICK, kind: 'platform' },

    // ── 4. 地下区域（y > 1760）：全部采用实心岩体围合成狭窄地道（高 120~160px，竖井宽 160~260px） ──
    ...UNDERGROUND_NARROW_TUNNEL_SOLIDS(),
  ]
  return { name: '封闭拱顶·地下狭道竞技场', solids }
}

/** 天空拱形方块群（有上有下高低交错）：
 *  从左翼平台上方拾级而上，在顶部形成高低交错的拱顶（两侧高点 y=560，左中 y=760、正中央方块 x=6200..7000 顶面 y=680），
 *  再拾级而下连接右翼平台。正中央方块承载正中复活点与旗帜。 */
function SKY_ARCH_BLOCKS(): MapSolid[] {
  return [
    // 左侧阶梯上升段
    { x: 1200, y: 1280, w: 200, h: 360, kind: 'block' },
    { x: 1680, y: 1080, w: 420, h: 240, kind: 'block' },
    { x: 2740, y: 700, w: 720, h: 220, kind: 'block' },
    // 拱顶左峰（高）
    { x: 3940, y: 560, w: 880, h: 220, kind: 'block' },
    // 左中交错块（下沉，体现“有上有下”）
    { x: 5220, y: 760, w: 560, h: 220, kind: 'block' },
    // 正中央主方块（x=6200..7000，中心 x=6600，顶面 y=680：放置正中旗帜与复活点）
    { x: 6200, y: ARCH_CENTER_TOP, w: 800, h: 220, kind: 'block' },
    // 拱顶右峰（高，体现“有上有下”）
    { x: 7420, y: 560, w: 720, h: 220, kind: 'block' },
    // 右中交错块（下沉）
    { x: 8580, y: 740, w: 720, h: 240, kind: 'block' },
    // 右侧阶梯下降段
    { x: 9700, y: 920, w: 580, h: 260, kind: 'block' },
    { x: 10680, y: 1080, w: 440, h: 280, kind: 'block' },
    { x: 11480, y: 1240, w: 200, h: 360, kind: 'block' },
    { x: 12020, y: 1320, w: 200, h: 340, kind: 'block' },
  ]
}

/** 地下狭窄地道结构（y=1800..2800）：
 *  - 浅层狭道（y=1800..1960，净高 160px）：紧贴左右主平台下方，带顶部悬挂掩体块；
 *  - 左右 L 型深层狭道：由 x=500..680 与 x=12520..12700 竖井直通 y=2360..2500（净高 140px）横向暗道；
 *  - 中央地下狭道网（x=2500..10700）：由上层狭道（y=2140..2260，高 120px）、中层狭道（y=2370..2500，高 130px）、
 *    底层狭道（y=2660..2800，高 140px）及 7 座大型地下岩体与多条狭窄竖井交织而成。 */
function UNDERGROUND_NARROW_TUNNEL_SOLIDS(): MapSolid[] {
  return [
    // ── A. 左右浅层狭道顶部悬挂掩体块（对应设计图主平台横线下方的掩体块） ──
    { x: 1800, y: 1800, w: 260, h: 60, kind: 'cover' },
    { x: 3000, y: 1800, w: 260, h: 70, kind: 'cover' },
    { x: 4100, y: 1800, w: 220, h: 60, kind: 'cover' },
    { x: 9000, y: 1800, w: 180, h: 60, kind: 'cover' },
    { x: 10000, y: 1800, w: 240, h: 60, kind: 'cover' },
    { x: 11100, y: 1800, w: 340, h: 70, kind: 'block' },

    // ── B. 左右两侧地下实心岩层（围合出左侧 x=500..680 与右侧 x=12520..12700 的 L 型狭窄地道） ──
    // 左端外侧全高地下实心墙（x=60..500, y=1800..2660，底部预留 y=2660..2800 底层贯通狭道）
    { x: WALL_THICK, y: 1800, w: 440, h: 860, kind: 'block' },
    // 左侧浅层狭道（y=1800..2040）与深层 L 狭道（y=2360..2500）之间的厚实岩层（预留 x=1280..1440 联络竖井）
    { x: 680, y: 2040, w: 600, h: 320, kind: 'block' },
    { x: 1440, y: 2040, w: 1060, h: 320, kind: 'block' },
    // 左侧深层 L 狭道（y=2360..2500）与底层狭道（y=2660..2800）之间的隔层岩体
    { x: 680, y: 2500, w: 1820, h: 160, kind: 'block' },

    // 右端外侧全高地下实心墙（x=12700..13140, y=1800..2660）
    { x: 12700, y: 1800, w: 440, h: 860, kind: 'block' },
    // 右侧浅层狭道（y=1800..2040）与深层 L 狭道（y=2360..2500）之间的厚实岩层（预留 x=11760..11920 联络竖井）
    { x: 10700, y: 2040, w: 1060, h: 320, kind: 'block' },
    { x: 11920, y: 2040, w: 600, h: 320, kind: 'block' },
    // 右侧深层 L 狭道（y=2360..2500）与底层狭道（y=2660..2800）之间的隔层岩体
    { x: 10700, y: 2500, w: 1820, h: 160, kind: 'block' },

    // ── C. 中央地下顶盖与中央下沉狭窄井道（y=1800..2160） ──
    // 左中顶盖岩层（x=2500..5200, y=2040..2160，厚 120px，上方为浅层狭道，下方为 y=2160..2280 地下上层狭道）
    { x: 2500, y: 2040, w: 2700, h: 120, kind: 'platform' },
    // 右中顶盖岩层（x=8000..10700, y=2040..2160，厚 120px）
    { x: 8000, y: 2040, w: 2700, h: 120, kind: 'platform' },
    // 中央咽喉区左肩巨石（x=5380..6260, y=1800..2160，留出 x=5200..5380 宽 180px 的西侧下沉竖井）
    { x: 5380, y: 1800, w: 880, h: 360, kind: 'block' },
    // 中央咽喉区右肩巨石（留出 x=6260..6660 中央竖井、x=7020..7360 东侧竖井及 x=7820..8000 边缘竖井）
    { x: 6660, y: 1800, w: 360, h: 360, kind: 'block' },
    { x: 7360, y: 1800, w: 460, h: 360, kind: 'block' },

    // ── D. 中央地下迷宫核心岩体群（围合出上 y=2160..2280、中 y=2380..2500、下 y=2660..2800 三层狭窄横道与多条狭窄竖井） ──
    // 1. 左侧竖直巨岩（左留 x=2500..2660 竖井，右留 x=3220..3380 竖井）
    { x: 2660, y: 2280, w: 560, h: 380, kind: 'block' },
    // 2. 左中上层横岩（上留 y=2160..2280 狭道，下留 y=2380..2500 狭道）
    { x: 3380, y: 2280, w: 2240, h: 100, kind: 'block' },
    // 3. 左中下层横岩（上留 y=2380..2500 狭道，下留 y=2660..2800 底层狭道）
    { x: 3380, y: 2500, w: 2240, h: 160, kind: 'block' },
    // 4. 正中竖直巨柱（左留 x=5620..5820 竖井，右留 x=6380..6640 核心中央竖井）
    { x: 5820, y: 2280, w: 560, h: 380, kind: 'block' },
    // 5. 右中上层横岩（预留 x=7020..7180 狭窄竖井供垂直机动与射击）
    { x: 6640, y: 2280, w: 380, h: 100, kind: 'block' },
    { x: 7180, y: 2280, w: 1920, h: 100, kind: 'block' },
    // 6. 右中下层横岩（预留 x=7020..7180 狭窄竖井）
    { x: 6640, y: 2500, w: 380, h: 160, kind: 'block' },
    { x: 7180, y: 2500, w: 1920, h: 160, kind: 'block' },
    // 7. 右侧竖直巨岩（左留 x=9100..9260 竖井，右留 x=10540..10700 竖井）
    { x: 9260, y: 2280, w: 1280, h: 380, kind: 'block' },
  ]
}

/** 在指定矩形区域内挖掘狭窄地道（供地图编辑器“挖地道”工具与自定义地图处理使用）：
 *  将与 carveRect 相交的实心块自动切割为不重叠的上下左右子块。 */
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
    // 顶部剩余
    if (cy0 - sy0 >= minSize) {
      out.push({ x: sx0, y: sy0, w: s.w, h: cy0 - sy0, kind: s.kind })
    }
    // 底部剩余
    if (sy1 - cy1 >= minSize) {
      out.push({ x: sx0, y: cy1, w: s.w, h: sy1 - cy1, kind: s.kind })
    }
    // 中间高度段 [max(sy0, cy0), min(sy1, cy1)] 的左右剩余
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
