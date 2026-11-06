// core/terrain.ts —— 13200×4400 环形大世界地形（移植 SkyBlast v2 src/world/terrain.js）
// 服务器权威：World 持有一份；地形是静态的（两端 build 一次即一致，不进快照）。
// 可破坏障碍物是动态实体（有 hp），由 World 管理、进快照。
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY } from './wrap.ts'

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

  /** 装饰图元：只进渲染列表、不写碰撞网格（窗户/路灯/缆线/天线/蒸汽口/警示条/桶/管道/梯子/标牌） */
  addDeco(x: number, y: number, w: number, h: number, kind: string, color: string, borderColor = ''): void {
    this.rects.push({ x, y, w, h, color, borderColor, kind, label: '' })
  }

  /** 挖空（地道/掩体）：网格清 0 + 背景图元 + 阴影区 */
  carveTunnel(x: number, y: number, w: number, h: number, label = '地下地道'): void {
    this.setGridRect(x, y, w, h, 0)
    this.rects.push({ x, y, w, h, color: '#090d16', borderColor: '#1e293b', kind: 'tunnel_bg', label })
    this.shadows.push({ x, y, w, h, label, alpha: 0.76 })
  }

  /** 多层楼房：楼板/外墙/天井/射击窗（v2 布局原样保留） */
  private buildMultiStoryBuilding(bx: number, groundY: number, width: number, floors: number, floorHeight: number, name: string, accent: string): void {
    const totalH = floors * floorHeight
    const topY = groundY - totalH
    this.rects.push({ x: bx, y: topY, w: width, h: totalH, color: '#111827', borderColor: accent, kind: 'building_bg', label: name })
    this.shadows.push({ x: bx + 20, y: topY + 20, w: width - 40, h: totalH - 20, label: `${name}室内`, alpha: 0.62 })
    this.addSolidBlock(bx - 20, topY, width + 40, 24, '#334155', accent, 'building_roof', `${name}天台`)
    for (let f = 0; f < floors; f++) {
      const fy = groundY - f * floorHeight
      if (f > 0) {
        if (f % 2 === 0) this.addSolidBlock(bx + 120, fy - 20, width - 120, 20, '#475569', '#64748b', 'floor_slab')
        else this.addSolidBlock(bx, fy - 20, width - 120, 20, '#475569', '#64748b', 'floor_slab')
      }
      const wallTop = fy - floorHeight + 20
      const wallH = floorHeight - 20
      if (f === 0) {
        this.addSolidBlock(bx, wallTop, 24, Math.max(20, wallH - 110), '#334155', accent, 'wall')
        this.addSolidBlock(bx + width - 24, wallTop, 24, Math.max(20, wallH - 110), '#334155', accent, 'wall')
      } else {
        this.addSolidBlock(bx, wallTop, 24, 40, '#334155', accent, 'wall')
        this.addSolidBlock(bx, fy - 60, 24, 40, '#334155', accent, 'wall')
        this.addSolidBlock(bx + width - 24, wallTop, 24, 40, '#334155', accent, 'wall')
        this.addSolidBlock(bx + width - 24, fy - 60, 24, 40, '#334155', accent, 'wall')
      }
    }
  }

  private buildHollowPipe(px: number, py: number, length: number, height: number, label: string): void {
    const t = 22
    this.rects.push({ x: px, y: py, w: length, h: height, color: '#0f172a', borderColor: '#06b6e4', kind: 'pipe_bg', label })
    this.shadows.push({ x: px, y: py + t, w: length, h: height - t * 2, label, alpha: 0.68 })
    this.addSolidBlock(px, py, length, t, '#164e63', '#22d3ee', 'pipe_wall', label)
    this.addSolidBlock(px, py + height - t, length, t, '#164e63', '#22d3ee', 'pipe_wall', label)
  }

  build(): void {
    this.grid.fill(0)
    this.rects.length = 0
    this.shadows.length = 0

    // 全环面：不设任何基岩边界——上下/左右都无缝循环，出界即 wrap
    // 地表至深层岩体（主碰撞体；y 越过 0/4400 由 wrapY 语义闭合）
    this.addSolidBlock(0, SURFACE_Y, WORLD_W, WORLD_H - SURFACE_Y, '#1e293b', '#334155', 'earth')

    // 地下主干道（贯通全图、双轴跨缝）+ 深层暗道（打通 y=0 缝：跨过底缝即回到高空）
    this.carveTunnel(0, 3560, WORLD_W, 160, '环球地下主干地道')
    this.carveTunnel(0, 4020, WORLD_W, 560, '深层暗影环带')   // 4020→4400 + 0→180，上下贯通
    // 垂直自由通道（贯穿岩体的无障碍竖井：上下飞越的直接通路）
    for (const sx of [700, 2900, 5200, 7800, 10100, 12400]) {
      this.carveTunnel(sx, SURFACE_Y, 160, WORLD_H - SURFACE_Y, '环球垂直升降井')
      for (let sy = SURFACE_Y + 180; sy < WORLD_H; sy += 220) {
        const off = (sy / 220) % 2 === 0 ? 0 : 90
        this.addSolidBlock(sx + off, sy, 70, 20, '#475569', '#94a3b8', 'step')
      }
    }

    // 3 座大型地下掩体
    this.carveTunnel(3600, 3320, 1100, 460, '西区地下战略掩体')
    this.addSolidBlock(3760, 3560, 780, 24, '#334155', '#38bdf8', 'bunker_floor')
    this.carveTunnel(6000, 3260, 1200, 560, '中央地下核心掩体')
    this.addSolidBlock(6160, 3540, 880, 24, '#334155', '#10b981', 'bunker_floor')
    this.carveTunnel(9600, 3320, 1100, 460, '东区地下装甲掩体')
    this.addSolidBlock(9760, 3560, 780, 24, '#334155', '#f43f5e', 'bunker_floor')

    // 6 座多层楼房
    this.buildMultiStoryBuilding(1400, SURFACE_Y, 640, 4, 240, '西翼指挥大楼', '#f43f5e')
    this.buildMultiStoryBuilding(3200, SURFACE_Y, 560, 3, 240, '西区工业厂房', '#f97316')
    this.buildMultiStoryBuilding(5500, SURFACE_Y, 680, 5, 240, '中央双子北塔', '#38bdf8')
    this.buildMultiStoryBuilding(7020, SURFACE_Y, 680, 5, 240, '中央双子南塔', '#10b981')
    this.buildMultiStoryBuilding(9300, SURFACE_Y, 560, 3, 240, '东区通信大楼', '#a855f7')
    this.buildMultiStoryBuilding(11100, SURFACE_Y, 640, 4, 240, '东翼要塞大楼', '#0ea5e9')

    // 5 段中空工业管道
    this.buildHollowPipe(2180, 2240, 860, 160, '西区高架输送管道')
    this.buildHollowPipe(4100, 2460, 1180, 160, '中西部主干工业管道')
    this.buildHollowPipe(6240, 1820, 720, 160, '中央双塔空中连廊管道')
    this.buildHollowPipe(7960, 2460, 1180, 160, '中东部主干工业管道')
    this.buildHollowPipe(10040, 2240, 860, 160, '东区高架输送管道')

    // 7 座高空浮岛
    const sky = [
      { x: 600, y: 2180, w: 620, c: '#f43f5e' },
      { x: 2300, y: 1620, w: 560, c: '#fb923c' },
      { x: 4300, y: 1460, w: 680, c: '#38bdf8' },
      { x: 6150, y: 1080, w: 900, c: '#10b981' },
      { x: 8200, y: 1460, w: 680, c: '#a855f7' },
      { x: 10300, y: 1620, w: 560, c: '#38bdf8' },
      { x: 11980, y: 2180, w: 620, c: '#0ea5e9' },
    ]
    for (const s of sky) this.addSolidBlock(s.x, s.y, s.w, 36, '#334155', s.c, 'sky_island')

    this.buildExtraStructures()
    this.buildDecorations()
  }

  /** 补充结构：连桥 / 高空平台 / 地面集装箱 / 据点掩体 / 地下立柱 */
  private buildExtraStructures(): void {
    // 双子塔中层 / 高层连桥
    this.addSolidBlock(6180, 2560, 840, 20, '#334155', '#38bdf8', 'bridge', '双子塔中层连桥')
    this.addSolidBlock(6180, 1360, 840, 20, '#334155', '#38bdf8', 'bridge', '双子塔高层连桥')
    // 西翼 / 东翼 连接桥
    this.addSolidBlock(2000, 2600, 280, 20, '#334155', '#f97316', 'bridge', '西翼连接桥')
    this.addSolidBlock(11760, 2600, 280, 20, '#334155', '#0ea5e9', 'bridge', '东翼连接桥')

    // 高空战术平台
    const platforms = [
      { x: 2700, y: 1180, w: 300, c: '#fb923c' },
      { x: 3700, y: 1900, w: 260, c: '#38bdf8' },
      { x: 5250, y: 2060, w: 220, c: '#10b981' },
      { x: 5400, y: 1000, w: 220, c: '#a855f7' },
      { x: 8800, y: 1860, w: 300, c: '#a855f7' },
      { x: 9600, y: 1240, w: 320, c: '#38bdf8' },
      { x: 11500, y: 1860, w: 280, c: '#0ea5e9' },
      { x: 12900, y: 1500, w: 260, c: '#f43f5e' },
    ]
    for (const p of platforms) this.addSolidBlock(p.x, p.y, p.w, 22, '#334155', p.c, 'platform')

    // 地面集装箱 / 掩体堆
    const containers = [
      { x: 5000, y: 2720, w: 120, h: 80, c: '#f97316' },
      { x: 7650, y: 2720, w: 120, h: 80, c: '#22d3ee' },
      { x: 9800, y: 2720, w: 100, h: 80, c: '#a855f7' },
      { x: 3850, y: 2740, w: 100, h: 60, c: '#eab308' },
    ]
    for (const c of containers) this.addSolidBlock(c.x, c.y, c.w, c.h, '#1f2937', c.c, 'container')

    // 据点掩体
    const covers = [
      { x: 1620, y: 1780, c: '#f43f5e' },
      { x: 4200, y: 3500, c: '#38bdf8' },
      { x: 6650, y: 3480, c: '#10b981' },
      { x: 11360, y: 1780, c: '#0ea5e9' },
    ]
    for (const c of covers) this.addSolidBlock(c.x, c.y, 60, 60, '#334155', c.c, 'cover')

    // 地下立柱（掩体大厅内）
    this.addSolidBlock(4300, 3400, 60, 120, '#334155', '#38bdf8', 'pillar')
    this.addSolidBlock(6650, 3300, 60, 120, '#334155', '#10b981', 'pillar')
    this.addSolidBlock(9900, 3400, 60, 120, '#334155', '#f43f5e', 'pillar')
  }

  /** 装饰层：窗户/路灯/缆线/天线/蒸汽口/警示条/油桶/管道/梯子/标牌（不参与碰撞） */
  private buildDecorations(): void {
    const buildings = [
      { bx: 1400, w: 640, floors: 4, name: '西翼指挥大楼' },
      { bx: 3200, w: 560, floors: 3, name: '西区工业厂房' },
      { bx: 5500, w: 680, floors: 5, name: '中央双子北塔' },
      { bx: 7020, w: 680, floors: 5, name: '中央双子南塔' },
      { bx: 9300, w: 560, floors: 3, name: '东区通信大楼' },
      { bx: 11100, w: 640, floors: 4, name: '东翼要塞大楼' },
    ]
    const warm = ['#fbbf24', '#fde68a', '#fb923c', '#f97316']
    buildings.forEach((b, bi) => {
      const topY = SURFACE_Y - b.floors * 240
      // 天线
      this.addDeco(b.bx + b.w / 2 - 3, topY - 64, 6, 64, 'deco_antenna', '#94a3b8')
      // 楼面窗户
      for (let f = 0; f < b.floors; f++) {
        const fy = SURFACE_Y - f * 240
        for (let k = 0; k < 3; k++) {
          const lit = (bi + f + k) % 3 !== 0
          const wx = b.bx + 40 + k * Math.max(60, (b.w - 120) / 3)
          this.addDeco(wx, fy - 170, 42, 40, lit ? 'deco_window_lit' : 'deco_window_dark', lit ? warm[(bi + k) % warm.length] : '#0f172a')
        }
      }
      // 屋顶警示条
      this.addDeco(b.bx - 16, topY + 20, b.w + 32, 6, 'deco_stripe', '#f59e0b')
    })

    // 地表路灯
    for (let x = 400; x < WORLD_W; x += 720) {
      this.addDeco(x, SURFACE_Y - 52, 8, 52, 'deco_lamp', '#fbbf24')
    }

    // 高空缆线（悬垂）
    const cables = [
      { x: 6180, y: 1900, w: 840 },
      { x: 2040, y: 2400, w: 300 },
      { x: 11740, y: 2400, w: 260 },
      { x: 2300, y: 1600, w: 800 },
      { x: 8200, y: 1460, w: 1100 },
    ]
    for (const c of cables) this.addDeco(c.x, c.y, c.w, 60, 'deco_cable', '#64748b')

    // 地下掩体蒸汽口
    for (const v of [3780, 6180, 9780]) this.addDeco(v, 3550, 26, 26, 'deco_vent', '#94a3b8')

    // 油桶（掩体入口/集装箱旁）
    for (const b of [1560, 2100, 3200, 4300, 5400, 6300, 7200, 9800, 11300, 12600]) {
      this.addDeco(b, SURFACE_Y - 30, 16, 30, 'deco_barrel', '#f59e0b')
    }

    // 地表管道跑线
    for (const p of [{ x: 2400, w: 620 }, { x: 8450, w: 520 }, { x: 12100, w: 300 }]) {
      this.addDeco(p.x, SURFACE_Y - 22, p.w, 10, 'deco_pipe_run', '#22d3ee')
    }

    // 竖井梯子
    for (const sx of [700, 2900, 5200, 7800, 10100, 12400]) {
      this.addDeco(sx + 2, SURFACE_Y + 24, 14, 1200, 'deco_ladder', '#94a3b8')
    }

    // 据点标牌
    for (const cp of [
      { x: 1620, y: 1840, t: 'A' }, { x: 4050, y: 3560, t: 'B' },
      { x: 6500, y: 2800, t: 'C' }, { x: 6500, y: 3540, t: 'D' }, { x: 11360, y: 1840, t: 'E' },
    ]) {
      this.addDeco(cp.x - 30, cp.y - 130, 60, 22, 'deco_sign', '#22d3ee', cp.t)
    }

    // 管道支架
    for (const px of [2180, 4100, 6240, 7960, 10040]) {
      this.addDeco(px - 10, 2240 + 160, 20, 30, 'deco_bracket', '#22d3ee')
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

/** 预设可破坏障碍物（v2 布局原样保留；barricade 副武器动态生成的在 World 里） */
export interface ObstacleInit { id: string; x: number; y: number; w: number; h: number; hp: number; label: string; color: string; borderColor: string }

export const OBSTACLE_PRESETS: ObstacleInit[] = [
  { id: 'obs_1', x: 1320, y: 2680, w: 48, h: 120, hp: 260, label: '大楼防爆门', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_2', x: 2080, y: 2680, w: 48, h: 120, hp: 260, label: '大楼防爆门', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_3', x: 3120, y: 2680, w: 48, h: 120, hp: 240, label: '厂房装甲墙', color: '#78350f', borderColor: '#f59e0b' },
  { id: 'obs_4', x: 5420, y: 2680, w: 52, h: 120, hp: 300, label: '双塔重型闸门', color: '#7c2d12', borderColor: '#fb923c' },
  { id: 'obs_5', x: 7740, y: 2680, w: 52, h: 120, hp: 300, label: '双塔重型闸门', color: '#7c2d12', borderColor: '#fb923c' },
  { id: 'obs_6', x: 11020, y: 2680, w: 48, h: 120, hp: 260, label: '要塞防爆门', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_7', x: 11780, y: 2680, w: 48, h: 120, hp: 260, label: '要塞防爆门', color: '#9a3412', borderColor: '#f97316' },
  { id: 'obs_8', x: 2600, y: 2264, w: 36, h: 112, hp: 180, label: '管道密封闸', color: '#155e75', borderColor: '#22d3ee' },
  { id: 'obs_9', x: 4680, y: 2484, w: 36, h: 112, hp: 180, label: '管道密封闸', color: '#155e75', borderColor: '#22d3ee' },
  { id: 'obs_10', x: 6580, y: 1844, w: 36, h: 112, hp: 180, label: '高空管道路障', color: '#155e75', borderColor: '#22d3ee' },
  { id: 'obs_11', x: 8540, y: 2484, w: 36, h: 112, hp: 180, label: '管道密封闸', color: '#155e75', borderColor: '#22d3ee' },
  { id: 'obs_12', x: 10460, y: 2264, w: 36, h: 112, hp: 180, label: '管道密封闸', color: '#155e75', borderColor: '#22d3ee' },
  { id: 'obs_ug_1', x: 3580, y: 3560, w: 44, h: 160, hp: 320, label: '地下掩体西闸门', color: '#4c1d95', borderColor: '#a855f7' },
  { id: 'obs_ug_2', x: 4700, y: 3560, w: 44, h: 160, hp: 320, label: '地下掩体东闸门', color: '#4c1d95', borderColor: '#a855f7' },
  { id: 'obs_ug_3', x: 5980, y: 3560, w: 48, h: 160, hp: 360, label: '中央地核防爆墙', color: '#065f46', borderColor: '#10b981' },
  { id: 'obs_ug_4', x: 7200, y: 3560, w: 48, h: 160, hp: 360, label: '中央地核防爆墙', color: '#065f46', borderColor: '#10b981' },
  { id: 'obs_ug_5', x: 9580, y: 3560, w: 44, h: 160, hp: 320, label: '东区地下西闸门', color: '#881337', borderColor: '#f43f5e' },
  { id: 'obs_ug_6', x: 10700, y: 3560, w: 44, h: 160, hp: 320, label: '东区地下东闸门', color: '#881337', borderColor: '#f43f5e' },
  { id: 'obs_box_1', x: 6420, y: 2730, w: 68, h: 70, hp: 170, label: '重装掩体箱', color: '#365314', borderColor: '#84cc16' },
  { id: 'obs_box_2', x: 6720, y: 2730, w: 68, h: 70, hp: 170, label: '重装掩体箱', color: '#365314', borderColor: '#84cc16' },
  { id: 'obs_box_3', x: 6560, y: 1010, w: 80, h: 70, hp: 190, label: '浮岛核心护盾箱', color: '#1e3a8a', borderColor: '#60a5fa' },
]
