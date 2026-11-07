// web/textures.ts —— 地形程序化高精度贴图（无外部美术资源，运行时生成 CanvasPattern）
// 每种地形 kind 一张 96px 可平铺贴图，带法线感高光/暗缝/铆钉/矿物颗粒，缓存复用。
type Rnd = () => number

function mulberry32(seed: number): Rnd {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cache = new Map<string, CanvasPattern>()

function makeTex(size: number, seed: number, paint: (c: CanvasRenderingContext2D, rnd: Rnd) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const c = cv.getContext('2d')!
  paint(c, mulberry32(seed))
  return cv
}

function speckle(c: CanvasRenderingContext2D, rnd: Rnd, size: number, count: number, colors: string[], rMin = 1, rMax = 3): void {
  for (let i = 0; i < count; i++) {
    c.fillStyle = colors[Math.floor(rnd() * colors.length)]
    c.globalAlpha = 0.25 + rnd() * 0.5
    const r = rMin + rnd() * (rMax - rMin)
    c.beginPath()
    c.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2)
    c.fill()
  }
  c.globalAlpha = 1
}

/** 岩石/地层：沉积层理 + 石英晶粒 + 立体裂隙 */
function paintEarth(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#1b2436'
  c.fillRect(0, 0, S, S)
  // 水平地层沉积带
  for (let y = 0; y < S; y += 10) {
    c.fillStyle = rnd() > 0.5 ? 'rgba(51, 65, 85, 0.38)' : 'rgba(15, 23, 42, 0.42)'
    c.fillRect(0, y + rnd() * 3, S, 2 + rnd() * 3)
  }
  // 碎石与矿物高光晶粒
  speckle(c, rnd, S, 48, ['#243044', '#2c3a52', '#141c2b', '#334155', '#475569'], 1, 3.4)
  speckle(c, rnd, S, 10, ['#94a3b8'], 0.6, 1.4)
  // 立体双线岩缝
  for (let i = 0; i < 4; i++) {
    let x = rnd() * S
    let y = rnd() * S
    c.strokeStyle = 'rgba(8, 12, 20, 0.7)'
    c.lineWidth = 1.2
    c.beginPath()
    c.moveTo(x, y)
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * 26
      y += (rnd() - 0.2) * 14
      c.lineTo(x, y)
    }
    c.stroke()
  }
}

/** 深岩：玄武岩深层晶脉 */
function paintBedrock(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#0b111e'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 64, ['#080d16', '#131c2b', '#1c2738', '#263449'], 1, 4.2)
  c.strokeStyle = 'rgba(56, 189, 248, 0.12)'
  c.lineWidth = 1.2
  for (let i = 0; i < 5; i++) {
    c.beginPath()
    c.moveTo(rnd() * S, rnd() * S)
    c.lineTo(rnd() * S, rnd() * S)
    c.stroke()
  }
}

/** 砖墙：立体倒角砌块 + 灰浆深槽 */
function paintBrick(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  const rowH = 24
  c.fillStyle = '#0b111c'
  c.fillRect(0, 0, S, S)
  for (let row = 0; row < Math.ceil(S / rowH); row++) {
    const off = row % 2 === 0 ? 0 : -18
    for (let x = off; x < S; x += 36) {
      const shade = 0.88 + rnd() * 0.28
      c.fillStyle = `rgb(${Math.round(44 * shade)},${Math.round(56 * shade)},${Math.round(74 * shade)})`
      c.fillRect(x + 2, row * rowH + 2, 32, rowH - 4)
      // 顶部受光棱与底部背光棱
      c.fillStyle = 'rgba(255,255,255,0.11)'
      c.fillRect(x + 2, row * rowH + 2, 32, 2)
      c.fillStyle = 'rgba(0,0,0,0.28)'
      c.fillRect(x + 2, row * rowH + rowH - 4, 32, 2)
    }
  }
  speckle(c, rnd, S, 22, ['#1a2334', '#38465c'], 0.8, 2.0)
}

/** 混凝土（楼板/屋顶/掩体）：模板接缝 + 拉杆孔 + 顶棱高光 */
function paintConcrete(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#3a4658'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 54, ['#334155', '#475569', '#2c3849', '#5a6b82'], 0.9, 2.5)
  // 十字分仓接缝与高光倒角
  c.strokeStyle = 'rgba(15, 23, 42, 0.6)'
  c.lineWidth = 1.2
  c.beginPath()
  c.moveTo(0, S / 2); c.lineTo(S, S / 2)
  c.moveTo(S / 2, 0); c.lineTo(S / 2, S)
  c.stroke()
  c.fillStyle = 'rgba(255,255,255,0.08)'
  c.fillRect(0, 0, S, 2)
  c.fillRect(0, S / 2 + 1, S, 1.5)
  // 模板对拉螺栓孔
  for (const [bx, by] of [[10, 10], [S / 2 - 10, 10], [S / 2 + 10, S / 2 + 10], [S - 10, S / 2 + 10]]) {
    c.fillStyle = 'rgba(15,23,42,0.65)'
    c.beginPath(); c.arc(bx, by, 2, 0, Math.PI * 2); c.fill()
  }
}

/** 金属管道：阳极氧化拉丝 + 双排高光铆钉 */
function paintMetal(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  const g = c.createLinearGradient(0, 0, S, 0)
  g.addColorStop(0, '#123f52')
  g.addColorStop(0.45, '#1e6b85')
  g.addColorStop(0.55, '#1e6b85')
  g.addColorStop(1, '#0e3545')
  c.fillStyle = g
  c.fillRect(0, 0, S, S)
  // 金属拉丝
  for (let i = 0; i < 30; i++) {
    c.strokeStyle = `rgba(255,255,255,${0.025 + rnd() * 0.055})`
    c.lineWidth = 1
    c.beginPath()
    const y = rnd() * S
    c.moveTo(0, y); c.lineTo(S, y)
    c.stroke()
  }
  // 接缝 + 立体铆钉
  c.strokeStyle = 'rgba(8, 20, 28, 0.85)'
  c.lineWidth = 2
  c.beginPath(); c.moveTo(0, 6); c.lineTo(S, 6); c.stroke()
  for (let x = 8; x < S; x += 16) {
    c.fillStyle = 'rgba(0,0,0,0.45)'
    c.beginPath(); c.arc(x, 13.2, 2.2, 0, Math.PI * 2); c.fill()
    c.fillStyle = 'rgba(165, 243, 252, 0.65)'
    c.beginPath(); c.arc(x, 12, 2, 0, Math.PI * 2); c.fill()
  }
  c.fillStyle = 'rgba(34, 211, 238, 0.16)'
  c.fillRect(0, 0, S, 3)
}

/** 管道内壁（暗金属） */
function paintPipeInner(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#0a1420'
  c.fillRect(0, 0, S, S)
  for (let i = 0; i < 20; i++) {
    c.strokeStyle = `rgba(56, 189, 248, ${0.03 + rnd() * 0.05})`
    c.lineWidth = 1
    c.beginPath()
    const y = rnd() * S
    c.moveTo(0, y); c.lineTo(S, y)
    c.stroke()
  }
  speckle(c, rnd, S, 12, ['#0f2233', '#123044'], 1, 2.4)
}

/** 地下泥土/地道 */
function paintTunnel(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#070b12'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 34, ['#0c1119', '#101722', '#131b26'], 1.5, 4)
  c.strokeStyle = 'rgba(90, 110, 130, 0.12)'
  c.lineWidth = 1
  for (let i = 0; i < 3; i++) {
    c.beginPath()
    let x = rnd() * S
    c.moveTo(x, 0)
    for (let y = 0; y < S; y += 12) {
      x += (rnd() - 0.5) * 10
      c.lineTo(x, y)
    }
    c.stroke()
  }
}

/** 高空浮岛：风化浮空岩 + 双层翠绿草皮 + 底缘垂根 */
function paintIsland(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#2d394b'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 42, ['#25303d', '#3b4a5e', '#202a38', '#475569'], 1, 3.2)
  // 双层丰茂草皮
  c.fillStyle = '#15803d'
  c.fillRect(0, 0, S, 8)
  c.fillStyle = '#4ade80'
  for (let x = 0; x < S; x += 3) {
    c.fillRect(x, 0, 2, 2 + rnd() * 4.5)
  }
  // 底部钟乳石暗影痕
  c.fillStyle = 'rgba(10, 14, 22, 0.42)'
  for (let x = 0; x < S; x += 8) c.fillRect(x + rnd() * 3, S - 10, 2.2, 8)
}

/** 金属格栅/踏板 */
function paintGrate(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#1e2a38'
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(148, 163, 184, 0.4)'
  c.lineWidth = 2
  for (let i = 0; i < S; i += 12) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke()
  }
  c.strokeStyle = 'rgba(0,0,0,0.55)'
  c.lineWidth = 1
  for (let i = 6; i < S; i += 12) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke()
  }
  speckle(c, rnd, S, 10, ['#2c3a4d'], 1, 2)
}

/** 金属装甲板（地堡/集装箱）：防滑压花 + 沉头螺栓 */
function paintPlate(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#2b3747'
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(100, 116, 139, 0.42)'
  c.lineWidth = 1
  for (let y = 0; y < S; y += 24) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke()
  }
  for (let x = 0; x < S; x += 32) {
    c.strokeStyle = 'rgba(15, 23, 42, 0.65)'
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke()
    c.fillStyle = 'rgba(186, 230, 253, 0.38)'
    c.beginPath(); c.arc(x + 8, 12, 1.7, 0, Math.PI * 2); c.fill()
    c.beginPath(); c.arc(x + 8, S - 12, 1.7, 0, Math.PI * 2); c.fill()
  }
  speckle(c, rnd, S, 16, ['#364457', '#1e293b'], 1, 2)
}

/** kind → 贴图 key */
export function texKindOf(kind: string): string {
  switch (kind) {
    case 'earth': return 'earth'
    case 'bedrock': return 'bedrock'
    case 'wall': return 'brick'
    case 'building_roof':
    case 'floor_slab':
    case 'building_bg': return 'concrete'
    case 'pipe_wall': return 'metal'
    case 'pipe_bg': return 'pipeInner'
    case 'tunnel_bg': return 'tunnel'
    case 'sky_island': return 'island'
    case 'step': return 'grate'
    case 'bunker_floor': return 'plate'
    case 'bridge': return 'metal'
    case 'platform': return 'island'
    case 'ledge': return 'concrete'
    case 'cliff': return 'brick'
    case 'ruin_pillar':
    case 'ruin_lintel': return 'brick'
    case 'cave_floor':
    case 'cave_shelf': return 'plate'
    case 'container': return 'plate'
    case 'cover': return 'brick'
    case 'pillar': return 'concrete'
    default: return 'earth'
  }
}

export function getTerrainPattern(ctx: CanvasRenderingContext2D, kind: string): CanvasPattern | null {
  const key = texKindOf(kind)
  const hit = cache.get(key)
  if (hit) return hit
  let cv: HTMLCanvasElement
  switch (key) {
    case 'earth': cv = makeTex(96, 11, paintEarth); break
    case 'bedrock': cv = makeTex(96, 17, paintBedrock); break
    case 'brick': cv = makeTex(96, 23, paintBrick); break
    case 'concrete': cv = makeTex(96, 29, paintConcrete); break
    case 'metal': cv = makeTex(96, 37, paintMetal); break
    case 'pipeInner': cv = makeTex(96, 41, paintPipeInner); break
    case 'tunnel': cv = makeTex(96, 47, paintTunnel); break
    case 'island': cv = makeTex(96, 53, paintIsland); break
    case 'grate': cv = makeTex(96, 59, paintGrate); break
    case 'plate': cv = makeTex(96, 67, paintPlate); break
    default: cv = makeTex(96, 11, paintEarth)
  }
  const pat = ctx.createPattern(cv, 'repeat')
  if (pat) cache.set(key, pat)
  return pat
}
/** 把地形贴图的锚点补偿到相机世界坐标：贴图随世界一起移动（否则花纹固定在屏幕上会"滑动"） */
export function syncTerrainPatterns(camX: number, camY: number): void {
  const m = new DOMMatrix().translate(-camX, -camY)
  for (const pat of cache.values()) pat.setTransform(m)
}
