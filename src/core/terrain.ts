// core/terrain.ts —— 极简平地地图：一整块平地 + 方形掩体 + 几个浮空平台
// 服务器权威：World 持有；地形静态（build 一次，两端一致，不进快照）。
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY } from './wrap.ts'
import type { MapSolid } from './map.ts'

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

    // 方形掩体（贴地，均匀分布）
    const covers = [
      { x: 800, y: SURFACE_Y - 100, w: 120, h: 100, c: '#f43f5e' },
      { x: 2600, y: SURFACE_Y - 80, w: 100, h: 80, c: '#38bdf8' },
      { x: 4600, y: SURFACE_Y - 120, w: 140, h: 120, c: '#f97316' },
      { x: 5800, y: SURFACE_Y - 90, w: 120, h: 90, c: '#10b981' },
      { x: 7800, y: SURFACE_Y - 80, w: 100, h: 80, c: '#a855f7' },
      { x: 10600, y: SURFACE_Y - 110, w: 130, h: 110, c: '#0ea5e9' },
      { x: 12800, y: SURFACE_Y - 90, w: 110, h: 90, c: '#eab308' },
    ]
    for (const c of covers) this.addSolidBlock(c.x, c.y, c.w, c.h, '#1f2937', c.c, 'cover', '方形掩体')

    // 几个浮空平台（离地 260px，普通喷气可达）
    const platformY = SURFACE_Y - 260
    const platforms = [
      { x: 2200, w: 300, c: '#38bdf8' },
      { x: 3800, w: 260, c: '#10b981' },
      { x: 5400, w: 300, c: '#f97316' },
      { x: 7600, w: 280, c: '#a855f7' },
      { x: 9600, w: 300, c: '#38bdf8' },
      { x: 11800, w: 280, c: '#0ea5e9' },
    ]
    for (const pl of platforms) this.addSolidBlock(pl.x, platformY, pl.w, 22, '#334155', pl.c, 'platform', '平台')
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

/** 预设可破坏障碍物（贴地的方形掩体箱） */
export interface ObstacleInit { id: string; x: number; y: number; w: number; h: number; hp: number; label: string; color: string; borderColor: string }

export const OBSTACLE_PRESETS: ObstacleInit[] = [
  { id: 'obs_1', x: 1600, y: 2720, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_2', x: 3400, y: 2720, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_3', x: 4900, y: 2720, w: 60, h: 80, hp: 240, label: '方形掩体', color: '#78350f', borderColor: '#f59e0b' },
  { id: 'obs_box_1', x: 6420, y: 2730, w: 68, h: 70, hp: 170, label: '重装掩体箱', color: '#365314', borderColor: '#84cc16' },
  { id: 'obs_5', x: 9200, y: 2720, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#7c2d12', borderColor: '#fb923c' },
  { id: 'obs_6', x: 11200, y: 2720, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_7', x: 12500, y: 2720, w: 60, h: 80, hp: 260, label: '方形掩体', color: '#9a3412', borderColor: '#f97316' },
]
