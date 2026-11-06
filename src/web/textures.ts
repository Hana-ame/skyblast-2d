// web/textures.ts —— 地形程序化贴图（无外部美术资源，运行时生成 CanvasPattern）
// 每种地形 kind 一张 96/64px 可平铺贴图，带噪点/接缝/铆钉/砖缝，缓存复用。
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

/** 岩石/地层：横纹 + 碎屑 */
function paintEarth(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#1b2436'
  c.fillRect(0, 0, S, S)
  // 水平地层
  for (let y = 0; y < S; y += 12) {
    c.fillStyle = rnd() > 0.5 ? 'rgba(51, 65, 85, 0.35)' : 'rgba(15, 23, 42, 0.35)'
    c.fillRect(0, y + rnd() * 4, S, 2 + rnd() * 3)
  }
  // 碎石
  speckle(c, rnd, S, 40, ['#243044', '#2c3a52', '#141c2b', '#334155'], 1, 3.2)
  // 裂缝
  c.strokeStyle = 'rgba(10, 14, 22, 0.6)'
  c.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    let x = rnd() * S
    let y = rnd() * S
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

/** 深岩 */
function paintBedrock(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#0c1320'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 55, ['#0a1019', '#131c2b', '#1c2738'], 1, 4)
  c.strokeStyle = 'rgba(40, 52, 70, 0.5)'
  c.lineWidth = 1.5
  for (let i = 0; i < 5; i++) {
    c.beginPath()
    c.moveTo(rnd() * S, rnd() * S)
    c.lineTo(rnd() * S, rnd() * S)
    c.stroke()
  }
}

/** 砖墙 */
function paintBrick(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  const rowH = 24
  c.fillStyle = '#0d1420'
  c.fillRect(0, 0, S, S)
  for (let row = 0; row < Math.ceil(S / rowH); row++) {
    const off = row % 2 === 0 ? 0 : -18
    for (let x = off; x < S; x += 36) {
      const shade = 0.9 + rnd() * 0.25
      c.fillStyle = `rgb(${Math.round(42 * shade)},${Math.round(54 * shade)},${Math.round(70 * shade)})`
      c.fillRect(x + 2, row * rowH + 2, 32, rowH - 4)
      c.fillStyle = 'rgba(255,255,255,0.08)'
      c.fillRect(x + 2, row * rowH + 2, 32, 2)
    }
  }
  speckle(c, rnd, S, 18, ['#1a2334', '#38465c'], 1, 2.2)
}

/** 混凝土（楼板/屋顶/掩体） */
function paintConcrete(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#3a4658'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 48, ['#334155', '#475569', '#2c3849', '#5a6b82'], 1, 2.6)
  // 面板接缝
  c.strokeStyle = 'rgba(15, 23, 42, 0.55)'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(0, S / 2); c.lineTo(S, S / 2)
  c.moveTo(S / 2, 0); c.lineTo(S / 2, S)
  c.stroke()
  c.fillStyle = 'rgba(255,255,255,0.06)'
  c.fillRect(0, 0, S, 2)
}

/** 金属管道 */
function paintMetal(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  const g = c.createLinearGradient(0, 0, S, 0)
  g.addColorStop(0, '#123f52')
  g.addColorStop(0.45, '#1a6076')
  g.addColorStop(0.55, '#1a6076')
  g.addColorStop(1, '#0e3545')
  c.fillStyle = g
  c.fillRect(0, 0, S, S)
  // 拉丝
  for (let i = 0; i < 26; i++) {
    c.strokeStyle = `rgba(255,255,255,${0.02 + rnd() * 0.05})`
    c.lineWidth = 1
    c.beginPath()
    const y = rnd() * S
    c.moveTo(0, y); c.lineTo(S, y)
    c.stroke()
  }
  // 接缝 + 铆钉
  c.strokeStyle = 'rgba(8, 20, 28, 0.8)'
  c.lineWidth = 2
  c.beginPath(); c.moveTo(0, 6); c.lineTo(S, 6); c.stroke()
  for (let x = 8; x < S; x += 16) {
    c.fillStyle = 'rgba(120, 210, 235, 0.55)'
    c.beginPath(); c.arc(x, 12, 2, 0, Math.PI * 2); c.fill()
    c.fillStyle = 'rgba(0,0,0,0.4)'
    c.beginPath(); c.arc(x, 13, 2, 0, Math.PI * 2); c.fill()
  }
  c.fillStyle = 'rgba(34, 211, 238, 0.12)'
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

/** 高空浮岛：岩石 + 顶部草地 */
function paintIsland(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#2e3a4c'
  c.fillRect(0, 0, S, S)
  speckle(c, rnd, S, 36, ['#27323f', '#3c4a5e', '#222c3a'], 1, 3)
  // 草皮
  c.fillStyle = '#1f7a3d'
  c.fillRect(0, 0, S, 7)
  c.fillStyle = 'rgba(74, 222, 128, 0.55)'
  for (let x = 0; x < S; x += 4) {
    c.fillRect(x, 0, 2, 2 + rnd() * 3)
  }
  // 底部滴水痕
  c.fillStyle = 'rgba(10, 14, 22, 0.35)'
  for (let x = 0; x < S; x += 9) c.fillRect(x + rnd() * 4, S - 10, 2, 8)
}

/** 金属格栅/踏板 */
function paintGrate(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#1e2a38'
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(120, 140, 165, 0.35)'
  c.lineWidth = 2
  for (let i = 0; i < S; i += 12) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke()
  }
  c.strokeStyle = 'rgba(0,0,0,0.5)'
  c.lineWidth = 1
  for (let i = 6; i < S; i += 12) {
    c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.stroke()
  }
  speckle(c, rnd, S, 10, ['#2c3a4d'], 1, 2)
}

/** 金属地板（掩体/地堡） */
function paintPlate(c: CanvasRenderingContext2D, rnd: Rnd): void {
  const S = 96
  c.fillStyle = '#2b3747'
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(100, 116, 139, 0.4)'
  c.lineWidth = 1
  for (let y = 0; y < S; y += 24) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke()
  }
  for (let x = 0; x < S; x += 32) {
    c.strokeStyle = 'rgba(15, 23, 42, 0.6)'
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke()
    c.fillStyle = 'rgba(148, 163, 184, 0.35)'
    c.beginPath(); c.arc(x + 8, 12, 1.6, 0, Math.PI * 2); c.fill()
    c.beginPath(); c.arc(x + 8, S - 12, 1.6, 0, Math.PI * 2); c.fill()
  }
  speckle(c, rnd, S, 14, ['#364457'], 1, 2)
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
    case 'bedrock': cv = makeTex(96, 23, paintBedrock); break
    case 'brick': cv = makeTex(96, 31, paintBrick); break
    case 'concrete': cv = makeTex(96, 41, paintConcrete); break
    case 'metal': cv = makeTex(96, 53, paintMetal); break
    case 'pipeInner': cv = makeTex(96, 61, paintPipeInner); break
    case 'tunnel': cv = makeTex(96, 71, paintTunnel); break
    case 'island': cv = makeTex(96, 83, paintIsland); break
    case 'grate': cv = makeTex(96, 97, paintGrate); break
    case 'plate': cv = makeTex(96, 103, paintPlate); break
    default: cv = makeTex(96, 107, paintEarth)
  }
  const pat = ctx.createPattern(cv, 'repeat')
  if (pat) cache.set(key, pat)
  return pat
}

/** 视差星空：生成一次屏幕外渐变点阵（供背景用） */
export function makeStarField(count = 140): { x: number; y: number; r: number; a: number }[] {
  const rnd = mulberry32(777)
  const out: { x: number; y: number; r: number; a: number }[] = []
  for (let i = 0; i < count; i++) {
    out.push({ x: rnd(), y: rnd(), r: 0.5 + rnd() * 1.4, a: 0.15 + rnd() * 0.6 })
  }
  return out
}