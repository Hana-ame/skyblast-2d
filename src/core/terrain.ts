// core/terrain.ts —— 极简平地地图：一整块平地 + 方形掩体 + 几个浮空平台
// 服务器权威：World 持有；地形静态（build 一次，两端一致，不进快照）。
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY } from './wrap.ts'
import type { MapSolid } from './map.ts'
import { defaultMapData } from './map.ts'

export const TILE_SIZE = 20
export const GRID_W = Math.floor(WORLD_W / TILE_SIZE)   // 660
export const GRID_H = Math.floor(WORLD_H / TILE_SIZE)   // 220

export interface TerrainRect { x: number; y: number; w: number; h: number; color: string; borderColor: string; kind: string; label?: string }
export interface ShadowZone { x: number; y: number; w: number; h: number; label: string; alpha: number }

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

  /** 挖空（保留供未来扩展；当前平地地图未使用） */
  carveTunnel(x: number, y: number, w: number, h: number, label = '地下地道'): void {
    this.setGridRect(x, y, w, h, 0)
    this.rects.push({ x, y, w, h, color: '#090d16', borderColor: '#1e293b', kind: 'tunnel_bg', label })
    this.shadows.push({ x, y, w, h, label, alpha: 0.76 })
  }

  build(customSolids?: MapSolid[]): void {
    this.grid.fill(0)
    this.rects.length = 0
    this.shadows.length = 0

    // 一整块平地（双轴环形，无任何边界）
    this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, '#1e293b', '#334155', 'earth')

    if (customSolids) {
      // 自定义地图（编辑器）：按 kind 着色
      for (const r of customSolids) {
        const style = r.kind === 'platform'
          ? { color: '#334155', border: '#38bdf8', kind: 'platform', label: '平台' }
          : r.kind === 'block'
            ? { color: '#334155', border: '#a855f7', kind: 'block', label: '方块' }
            : { color: '#1f2937', border: '#f97316', kind: 'cover', label: '方形掩体' }
        this.addSolidBlock(r.x, r.y, r.w, r.h, style.color, style.border, style.kind, style.label)
      }
      return
    }

    // 默认地图（城市街区）；也可以由编辑器传入自定义 solids
    for (const r of defaultMapData().solids) {
      const style = r.kind === 'platform'
        ? { color: '#334155', border: '#38bdf8', kind: 'platform', label: '平台' }
        : r.kind === 'block'
          ? { color: '#334155', border: '#a855f7', kind: 'block', label: '方块' }
          : { color: '#1f2937', border: '#f97316', kind: 'cover', label: '街区建筑' }
      this.addSolidBlock(r.x, r.y, r.w, r.h, style.color, style.border, style.kind, style.label)
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

/** 预设可破坏障碍物：全部搬到天花板顶面（中心 y=1880，高 80 → 底=1920 贴顶面；空口 5600~7600 内不放） */
export interface ObstacleInit { id: string; x: number; y: number; w: number; h: number; hp: number; label: string; color: string; borderColor: string }

export const OBSTACLE_PRESETS: ObstacleInit[] = [
  { id: 'obs_1', x: 1600, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_2', x: 3400, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_3', x: 4600, y: 240, w: 60, h: 80, hp: 240, label: '方形掩体', color: '#78350f', borderColor: '#f59e0b' },
  { id: 'obs_box_1', x: 5400, y: 238, w: 68, h: 70, hp: 170, label: '重装掩体箱', color: '#365314', borderColor: '#84cc16' },
  { id: 'obs_5', x: 7800, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#7c2d12', borderColor: '#fb923c' },
  { id: 'obs_6', x: 11200, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_7', x: 12500, y: 240, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
]
