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

/** 默认平地地图：7 个方形掩体 + 6 个浮空平台（与游戏内置一致） */
export function defaultMapData(): MapData {
  const covers: MapSolid[] = [
    { x: 800, y: 2700, w: 120, h: 100, kind: 'cover' },
    { x: 2600, y: 2720, w: 100, h: 80, kind: 'cover' },
    { x: 4600, y: 2680, w: 140, h: 120, kind: 'cover' },
    { x: 5800, y: 2710, w: 120, h: 90, kind: 'cover' },
    { x: 7800, y: 2720, w: 100, h: 80, kind: 'cover' },
    { x: 10600, y: 2690, w: 130, h: 110, kind: 'cover' },
    { x: 12800, y: 2710, w: 110, h: 90, kind: 'cover' },
  ]
  const platforms: MapSolid[] = [
    { x: 2200, y: 2540, w: 300, h: 22, kind: 'platform' },
    { x: 3800, y: 2540, w: 260, h: 22, kind: 'platform' },
    { x: 5400, y: 2540, w: 300, h: 22, kind: 'platform' },
    { x: 7600, y: 2540, w: 280, h: 22, kind: 'platform' },
    { x: 9600, y: 2540, w: 300, h: 22, kind: 'platform' },
    { x: 11800, y: 2540, w: 280, h: 22, kind: 'platform' },
  ]
  return { name: '默认平地', solids: [...covers, ...platforms] }
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
