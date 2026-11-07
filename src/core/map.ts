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

/** 天花板（上限）：完整实心平面，顶面 y=1920、厚 80（底面 2000）；只在正中留一个空口供上下通行。
 *  空口 x 5600~7600（宽 2000，中心 6600）。 */
export const CEILING_TOP = 1920
export const CEILING_THICK = 80
export const CEILING_HOLE_X0 = 5600
export const CEILING_HOLE_X1 = 7600

/** 默认地图：纯平地（地板，世界内置）+ 一整块天花板（上限，正中留空）。
 *  所有道具（跳台/迫击炮/瞭望塔/旗帜/地雷等）都搬到了天花板顶面（见 sim/world.ts 的坐标）。 */
export function defaultMapData(): MapData {
  const solids: MapSolid[] = [
    // 天花板左板（环形 x 0~5600）
    { x: 0, y: CEILING_TOP, w: CEILING_HOLE_X0, h: CEILING_THICK, kind: 'platform' },
    // 天花板右板（环形 x 7600~13200）
    { x: CEILING_HOLE_X1, y: CEILING_TOP, w: WORLD_W - CEILING_HOLE_X1, h: CEILING_THICK, kind: 'platform' },
  ]
  return { name: '天花板竞技场', solids }
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
