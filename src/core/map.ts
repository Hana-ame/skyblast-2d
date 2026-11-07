// core/map.ts —— 地图数据（编辑器与游戏共用）：平台/掩体/方块 的矩形列表
// 地形=一张平地 + 这些矩形；双轴环形世界坐标（13200×4400，地表 y=2800）。
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

/** 默认地图：城市街区（用户 2026-11-07 通过编辑器提供；中段被截断处已按对称补全） */
export function defaultMapData(): MapData {
  const solids: MapSolid[] = [
    // 地面层街区（x 4840~9840）
    { x: 4840, y: 2680, w: 240, h: 120, kind: 'cover' },
    { x: 5280, y: 2620, w: 240, h: 160, kind: 'cover' },
    { x: 5660, y: 2720, w: 160, h: 80, kind: 'cover' },
    { x: 6200, y: 2680, w: 180, h: 120, kind: 'cover' },
    { x: 6680, y: 2720, w: 240, h: 80, kind: 'cover' },
    { x: 7380, y: 2700, w: 240, h: 100, kind: 'cover' },
    { x: 7820, y: 2660, w: 220, h: 140, kind: 'cover' },
    { x: 8340, y: 2660, w: 220, h: 140, kind: 'cover' },
    { x: 8860, y: 2660, w: 300, h: 140, kind: 'cover' },
    { x: 9480, y: 2620, w: 360, h: 180, kind: 'cover' },
    // 中层建筑（截断处按街区节奏补全 x 5600~8000）
    { x: 5600, y: 1980, w: 220, h: 140, kind: 'cover' },
    { x: 5900, y: 2080, w: 260, h: 120, kind: 'cover' },
    { x: 6200, y: 1900, w: 180, h: 160, kind: 'cover' },
    { x: 6500, y: 2000, w: 240, h: 120, kind: 'cover' },
    { x: 6820, y: 1880, w: 200, h: 140, kind: 'cover' },
    { x: 7100, y: 2020, w: 260, h: 140, kind: 'cover' },
    { x: 7420, y: 1900, w: 240, h: 140, kind: 'cover' },
    { x: 7720, y: 2060, w: 220, h: 120, kind: 'cover' },
    // 中层建筑（用户提供，x 8060~9800）
    { x: 8260, y: 1940, w: 260, h: 140, kind: 'cover' },
    { x: 8060, y: 1840, w: 140, h: 180, kind: 'cover' },
    { x: 8700, y: 1960, w: 220, h: 160, kind: 'cover' },
    { x: 9140, y: 1860, w: 140, h: 180, kind: 'cover' },
    { x: 8980, y: 2080, w: 120, h: 140, kind: 'cover' },
    { x: 9400, y: 1980, w: 140, h: 140, kind: 'cover' },
    { x: 9200, y: 2180, w: 220, h: 160, kind: 'cover' },
    { x: 9620, y: 2100, w: 180, h: 100, kind: 'cover' },
    // 高空长桥
    { x: 3240, y: 1340, w: 1920, h: 80, kind: 'cover' },
    { x: 5200, y: 1320, w: 4800, h: 80, kind: 'cover' },
  ]
  return { name: '自定义地图', solids }
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
