// core/terrain.ts —— 地图地形构建：统一标志性装甲板色调与统一边缘高亮色（#38bdf8）
// 服务器权威：World 持有；地形静态（build 一次，两端一致，不进快照）。
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY } from './wrap.ts'
import type { MapSolid } from './map.ts'
import { defaultMapData, UNIFIED_EDGE_HIGHLIGHT } from './map.ts'

export const TILE_SIZE = 20
export const GRID_W = Math.floor(WORLD_W / TILE_SIZE)   // 660
export const GRID_H = Math.floor(WORLD_H / TILE_SIZE)   // 220

export interface TerrainRect { x: number; y: number; w: number; h: number; color: string; borderColor: string; kind: string; label?: string }
export interface ShadowZone { x: number; y: number; w: number; h: number; label: string; alpha: number }

/** 统一地形配色与一致边缘高亮（去除杂乱多色边框与砖块样式） */
const UNIFIED_FILL = '#1e293b'
const UNIFIED_BORDER = UNIFIED_EDGE_HIGHLIGHT

/** 碰撞网格：0=空气 2=不可破坏原始地形（Uint8Array 660×220） */
export class Terrain {
  grid = new Uint8Array(GRID_W * GRID_H)
  rects: TerrainRect[] = []
  shadows: ShadowZone[] = []

  private setGridRect(x: number, y: number, w: number, h: number, val: number): void {
    const gx0 = Math.max(0, Math.floor(x / TILE_SIZE))
    const gy0 = Math.max(0, Math.floor(y / TILE_SIZE))
    const gx1 = Math.min(GRID_W, Math.ceil((x + w) / TILE_SIZE))
    const gy1 = Math.min(GRID_H, Math.ceil((y + h) / TILE_SIZE))
    for (let gy = gy0; gy < gy1; gy++) {
      const row = gy * GRID_W
      for (let gx = gx0; gx < gx1; gx++) this.grid[row + gx] = val
    }
  }

  addSolidBlock(x: number, y: number, w: number, h: number, color: string, borderColor: string, kind: string, label = ''): void {
    this.setGridRect(x, y, w, h, 2)
    this.rects.push({ x, y, w, h, color, borderColor, kind, label })
  }

  /** 装饰图元：只进渲染列表、不写碰撞网格 */
  addDeco(x: number, y: number, w: number, h: number, kind: string, color: string, borderColor = ''): void {
    this.rects.push({ x, y, w, h, color, borderColor, kind, label: '' })
  }

  /** 挖空（保留供扩展） */
  carveTunnel(x: number, y: number, w: number, h: number, label = '地下地道'): void {
    this.setGridRect(x, y, w, h, 0)
    this.rects.push({ x, y, w, h, color: '#090d16', borderColor: UNIFIED_BORDER, kind: 'tunnel_bg', label })
    this.shadows.push({ x, y, w, h, label, alpha: 0.76 })
  }

  build(customSolids?: MapSolid[]): void {
    this.grid.fill(0)
    this.rects.length = 0
    this.shadows.length = 0

    // 底部基岩层（统一色调与统一边缘高亮）
    this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, UNIFIED_FILL, UNIFIED_BORDER, 'earth')

    const list = customSolids ?? defaultMapData().solids
    for (const r of list) {
      const label = r.kind === 'platform' ? '平台' : r.kind === 'block' ? '方块' : '掩体'
      this.addSolidBlock(r.x, r.y, r.w, r.h, UNIFIED_FILL, UNIFIED_BORDER, r.kind, label)
    }
  }

  /** 点是否被原始地形挡住（双轴环形 x/y） */
  isSolidAt(x: number, y: number): boolean {
    const wx = wrapX(x)
    const wy = wrapY(y)
    const gx = Math.floor(wx / TILE_SIZE)
    const gy = Math.floor(wy / TILE_SIZE)
    const gyy = ((gy % GRID_H) + GRID_H) % GRID_H
    if (gx >= 0 && gx < GRID_W && gyy >= 0 && gyy < GRID_H) {
      if (this.grid[gyy * GRID_W + gx] !== 0) return true
    }
    return false
  }
}

/** 预设可破坏障碍物：全部封印在天花板顶面，边缘高亮色统一为 #38bdf8 */
export interface ObstacleInit { id: string; x: number; y: number; w: number; h: number; hp: number; label: string; color: string; borderColor: string }

export const OBSTACLE_PRESETS: ObstacleInit[] = [
  { id: 'obs_1', x: 1600, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#1e293b', borderColor: UNIFIED_BORDER },
  { id: 'obs_2', x: 3400, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#1e293b', borderColor: UNIFIED_BORDER },
  { id: 'obs_3', x: 4600, y: 240, w: 60, h: 80, hp: 240, label: '方形掩体', color: '#1e293b', borderColor: UNIFIED_BORDER },
  { id: 'obs_box_1', x: 5400, y: 238, w: 68, h: 70, hp: 170, label: '重装掩体箱', color: '#1e293b', borderColor: UNIFIED_BORDER },
  { id: 'obs_5', x: 7800, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#1e293b', borderColor: UNIFIED_BORDER },
  { id: 'obs_6', x: 11200, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#1e293b', borderColor: UNIFIED_BORDER },
  { id: 'obs_7', x: 12500, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#1e293b', borderColor: UNIFIED_BORDER },
]
