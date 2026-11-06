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
      // 碰撞箱规则：墙体上/下端与楼板搭接 20px（消除 20px 夹缝），窗口留 90px 可通行；
      // 门洞 110px；避免任何 <60px 的夹缝把人卡住。
      const slabTop = f > 0 ? fy - 20 : fy - 20   // 本层顶板（上方楼板底）
      const wallBase = fy - floorHeight + 20       // 本层墙底（与下层板搭接）
      if (f === 0) {
        // 一层：门洞以上整段墙（上端搭接楼板，无夹缝）
        this.addSolidBlock(bx, slabTop, 24, (fy - 110) - slabTop, '#334155', accent, 'wall')
        this.addSolidBlock(bx + width - 24, slabTop, 24, (fy - 110) - slabTop, '#334155', accent, 'wall')
      } else {
        const winBottom = fy - 150
        const winTop = fy - 60
        // 下段墙：向下搭接楼板 20px
        this.addSolidBlock(bx, wallBase - 20, 24, winBottom - (wallBase - 20), '#334155', accent, 'wall')
        this.addSolidBlock(bx + width - 24, wallBase - 20, 24, winBottom - (wallBase - 20), '#334155', accent, 'wall')
        // 上段墙：向上搭接顶板（延伸到 fy，与顶板重叠）
        this.addSolidBlock(bx, winTop, 24, fy - winTop, '#334155', accent, 'wall')
        this.addSolidBlock(bx + width - 24, winTop, 24, fy - winTop, '#334155', accent, 'wall')
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
    this.buildNatureDeco()
  }

  // 设计规则（防卡死）：新增结构之间、结构与既有墙体/平台之间保持 ≥60px 通行间隙；
  // 不制造 <40px 的夹缝；立柱/掩体必须贴地且远离重生点抖动范围（±45px + 身宽 10px）。
  /** 安全区：出生点/据点/炮位/传送门/补给/塔/测试用坐标 —— 新平台不得覆盖 */
  private safeZones(): { x: number; y: number; r: number }[] {
    return [
      // 队伍出生点与据点
      { x: 1100, y: 2740, r: 150 }, { x: 12100, y: 2740, r: 150 },
      { x: 6600, y: 1460, r: 130 }, { x: 6600, y: 2380, r: 130 },
      { x: 1720, y: 1780, r: 100 }, { x: 4150, y: 3500, r: 100 },
      { x: 6600, y: 2740, r: 120 }, { x: 6600, y: 3480, r: 100 }, { x: 11420, y: 1780, r: 100 },
      // 迫击炮/瞭望塔/传送门
      { x: 920, y: 2180, r: 110 }, { x: 4620, y: 1460, r: 110 }, { x: 6600, y: 1080, r: 140 },
      { x: 8520, y: 1460, r: 110 }, { x: 12260, y: 2180, r: 110 },
      { x: 2580, y: 1620, r: 120 }, { x: 5840, y: 1600, r: 120 }, { x: 7360, y: 1600, r: 120 }, { x: 10580, y: 1620, r: 120 },
      { x: 880, y: 2760, r: 90 }, { x: 6320, y: 1040, r: 110 }, { x: 2980, y: 3680, r: 90 },
      { x: 9580, y: 2040, r: 100 }, { x: 6880, y: 3500, r: 90 }, { x: 12280, y: 2140, r: 90 },
      // 补给/弹药/人偶
      { x: 6800, y: 1020, r: 100 }, { x: 4150, y: 3520, r: 90 }, { x: 6600, y: 3500, r: 90 },
      { x: 10150, y: 3520, r: 90 }, { x: 2600, y: 1580, r: 100 }, { x: 10550, y: 1580, r: 100 },
      { x: 4820, y: 2100, r: 90 }, { x: 8560, y: 2760, r: 90 },
      // 测试/玩法敏感位（勿覆盖）
      { x: 1412, y: 2100, r: 80 }, { x: 1300, y: 2100, r: 80 }, { x: 6600, y: 2660, r: 90 },
      { x: 2300, y: 2770, r: 90 }, { x: 1200, y: 2760, r: 80 },
    ]
  }

  /** 仅在空白处加平台：与已有实体保持 ≥24px 间隙、与安全区保持距离 */
  private addPlatformIfClear(x: number, y: number, w: number, h: number, color: string, border: string, kind: string, label = ''): boolean {
    const pad = 24
    const zone = this.safeZones()
    for (const z of zone) {
      if (Math.abs(z.x - (x + w / 2)) < z.r + w / 2 && Math.abs(z.y - y) < z.r + h) return false
    }
    for (const r of this.rects) {
      if (r.kind.startsWith('deco_') || r.kind === 'tunnel_bg') continue
      if (x < r.x + r.w + pad && x + w > r.x - pad && y < r.y + r.h + pad && y + h > r.y - pad) return false
    }
    this.addSolidBlock(x, y, w, h, color, border, kind, label)
    return true
  }

  /** 地表台地/断崖：从地面抬起的整块岩台，制造高低差与跳跃落点 */
  private addHill(x: number, topY: number, w: number, border: string, kind = 'cliff'): boolean {
    const h = SURFACE_Y - topY
    if (h <= 40 || h > 420) return false
    for (const z of this.safeZones()) {
      if (Math.abs(z.x - (x + w / 2)) < z.r + w / 2 && Math.abs(z.y - SURFACE_Y) < z.r + 60) return false
    }
    for (const r of this.rects) {
      if (r.kind === 'earth' || r.kind === 'tunnel_bg' || r.kind.startsWith('deco_')) continue
      if (x < r.x + r.w + 16 && x + w > r.x - 16 && topY < r.y + r.h + 16 && SURFACE_Y > r.y - 16) return false
    }
    this.addSolidBlock(x, topY, w, h, '#1e293b', border, kind, '台地')
    return true
  }

  /** 补充结构（简化版）：地表台地 + 均布中/高平台 + 3 座废墟拱门 + 左中右 3 处洞窟 + 既有节点 */
  private buildExtraStructures(): void {
    // ── A. 地表台地（左中右均匀 5 处，避免细碎台阶）──
    const hills = [
      { x: 160, y: 2680, w: 240, c: '#fb923c' },
      { x: 2500, y: 2640, w: 300, c: '#38bdf8' },
      { x: 6240, y: 2680, w: 240, c: '#10b981' },
      { x: 9000, y: 2660, w: 280, c: '#a855f7' },
      { x: 12640, y: 2680, w: 300, c: '#0ea5e9' },
    ]
    for (const hl of hills) this.addHill(hl.x, hl.y, hl.w, hl.c)

    // ── B. 中层浮空平台（横跨全图均匀 10 块，左右中都有东西可踩）──
    const mids = [
      { x: 320, y: 2360, w: 180, c: '#fb923c' },
      { x: 1600, y: 2440, w: 170, c: '#f43f5e' },
      { x: 2800, y: 2320, w: 190, c: '#38bdf8' },
      { x: 4050, y: 2400, w: 180, c: '#38bdf8' },
      { x: 5300, y: 2300, w: 180, c: '#10b981' },
      { x: 6300, y: 2260, w: 190, c: '#10b981' },
      { x: 7700, y: 2400, w: 180, c: '#a855f7' },
      { x: 9000, y: 2320, w: 190, c: '#a855f7' },
      { x: 10400, y: 2440, w: 170, c: '#38bdf8' },
      { x: 12000, y: 2320, w: 180, c: '#0ea5e9' },
    ]
    for (const m of mids) this.addPlatformIfClear(m.x, m.y, m.w, 22, '#334155', m.c, 'platform', '浮空平台')

    // ── C. 高空平台（4 块：左/中/右都有高层落点）──
    const highs = [
      { x: 900, y: 1760, w: 170, c: '#fb923c' },
      { x: 3600, y: 1840, w: 170, c: '#38bdf8' },
      { x: 6600, y: 1700, w: 180, c: '#10b981' },
      { x: 9800, y: 1760, w: 170, c: '#a855f7' },
      { x: 12400, y: 1840, w: 160, c: '#0ea5e9' },
    ]
    for (const hl of highs) this.addPlatformIfClear(hl.x, hl.y, hl.w, 22, '#334155', hl.c, 'platform', '高空平台')

    // ── D. 废墟拱门（3 座：左 / 中 / 右）──
    const arches = [
      { x: 3820, y: 2380, w: 220, h: 320, c: '#38bdf8' },
      { x: 6300, y: 2320, w: 260, h: 380, c: '#10b981' },
      { x: 9900, y: 2360, w: 200, h: 340, c: '#38bdf8' },
    ]
    for (const a of arches) {
      if (!this.addPlatformIfClear(a.x, a.y, 40, a.h - 70, '#334155', a.c, 'ruin_pillar')) continue
      this.addSolidBlock(a.x + 40, a.y, a.w - 80, 22, '#1e293b', a.c, 'ruin_lintel', '废墟拱门')
      this.addSolidBlock(a.x, a.y, a.w, 22, '#334155', a.c, 'ruin_lintel')
    }

    // ── E. 洞窟层（左/中/右各一处，结构简单：一层大厅 + 1~2 级台阶 + 地表竖井）──
    this.carveTunnel(1200, 2960, 1500, 220, '西区苔藓洞窟')
    this.addSolidBlock(1200, 3160, 1500, 20, '#14532d', '#4ade80', 'cave_floor')
    this.addSolidBlock(1680, 3120, 90, 20, '#1e3a2b', '#4ade80', 'cave_shelf')
    this.carveTunnel(2460, 2800, 100, 200, '苔藓洞窟竖井')
    this.carveTunnel(4620, 3040, 900, 200, '中央水晶洞窟')
    this.addSolidBlock(4620, 3220, 900, 20, '#1e1b4b', '#a78bfa', 'cave_floor')
    this.addSolidBlock(5080, 3170, 80, 20, '#241d4d', '#a78bfa', 'cave_shelf')
    this.carveTunnel(5000, 2800, 100, 250, '水晶洞窟竖井')
    this.carveTunnel(9600, 2980, 1500, 220, '东区水晶洞窟')
    this.addSolidBlock(9600, 3180, 1500, 20, '#1e1b4b', '#a78bfa', 'cave_floor')
    this.addSolidBlock(10100, 3130, 90, 20, '#241d4d', '#a78bfa', 'cave_shelf')
    this.carveTunnel(10700, 2800, 100, 200, '水晶洞窟竖井')

    // ── F. 既有节点：连桥 / 集装箱 / 据点掩体 / 地下立柱（保留）──
    this.addSolidBlock(6180, 2560, 840, 20, '#334155', '#38bdf8', 'bridge', '双子塔中层连桥')
    this.addSolidBlock(6180, 2070, 840, 20, '#334155', '#38bdf8', 'bridge', '双子塔高层连桥')
    this.addSolidBlock(2000, 2600, 280, 20, '#334155', '#f97316', 'bridge', '西翼连接桥')
    this.addSolidBlock(11760, 2600, 280, 20, '#334155', '#0ea5e9', 'bridge', '东翼连接桥')
    const containers = [
      { x: 5000, y: 2720, w: 120, h: 80, c: '#f97316' },
      { x: 7800, y: 2720, w: 120, h: 80, c: '#22d3ee' },
      { x: 9950, y: 2720, w: 100, h: 80, c: '#a855f7' },
      { x: 3850, y: 2740, w: 100, h: 60, c: '#eab308' },
    ]
    for (const c of containers) this.addSolidBlock(c.x, c.y, c.w, c.h, '#1f2937', c.c, 'container')
    const covers = [
      { x: 1560, y: 1780, c: '#f43f5e' },
      { x: 4240, y: 3500, c: '#38bdf8' },
      { x: 6680, y: 3480, c: '#10b981' },
      { x: 11280, y: 1780, c: '#0ea5e9' },
    ]
    for (const c of covers) this.addSolidBlock(c.x, c.y, 60, 60, '#334155', c.c, 'cover')
    this.addSolidBlock(4300, 3440, 60, 120, '#334155', '#38bdf8', 'pillar')
    this.addSolidBlock(6800, 3420, 60, 120, '#334155', '#10b981', 'pillar')
    this.addSolidBlock(9900, 3440, 60, 120, '#334155', '#f43f5e', 'pillar')
  }

  /** 自然装饰层：平台吊藤 / 洞窟钟乳石 / 岩壁苔藓（空洞骑士式绿植氛围，不参与碰撞） */
  private buildNatureDeco(): void {
    const platKinds = new Set(['ledge', 'platform', 'sky_island', 'ruin_lintel', 'bridge'])
    for (const r of [...this.rects]) {
      if (!platKinds.has(r.kind)) continue
      // 每隔一段挂一株藤蔓（确定性：按世界坐标取模）
      const phase = Math.round(r.x / 20) % 3
      if (phase === 0) {
        this.addDeco(r.x + r.w * 0.3, r.y + r.h, 10, 30 + (Math.round(r.x) % 30), 'deco_vine', '#4ade80')
      }
      // 少量岩台苔藓（保持简洁）
      if (phase === 1 && r.w > 170) this.addDeco(r.x + 6, r.y - 6, Math.min(r.w - 12, 50), 10, 'deco_moss', '#4ade80')
    }
    // 洞窟：从顶壁垂下钟乳石 + 地面苔藓
    for (const c of [...this.rects]) {
      if (c.kind !== 'tunnel_bg' || !(c.label ?? '').includes('洞窟')) continue
      for (let x = c.x + 160; x < c.x + c.w - 100; x += 260) {
        const h = 16 + ((Math.round(x) * 7) % 24)
        this.addDeco(x, c.y, 12, h, 'deco_stalactite', '#475569')
      }
      for (let x = c.x + 100; x < c.x + c.w - 60; x += 380) {
        this.addDeco(x, c.y + c.h - 18, 26, 12, 'deco_moss', '#22c55e')
      }
    }
    // 废墟拱门剪影（远景氛围）
    for (const ax of [600, 2400, 4200, 7400, 10600, 12600]) {
      const ay = 2300 + (Math.round(ax / 100) % 3) * 90
      this.addDeco(ax, ay, 120, 70, 'deco_ruin_arch', '#334155')
    }
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
