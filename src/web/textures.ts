// web/textures.ts —— 标志性统一战术装甲板贴图（彻底移除碍眼的砖块纹理与杂乱碎裂噪点）
// 所有平台、掩体、方块、地层均采用干净统一的标志性几何装甲板纹理，视觉整洁且具辨识度。

const cache = new Map<string, CanvasPattern>()

function makeTex(size: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const c = cv.getContext('2d')!
  paint(c)
  return cv
}

/** 标志性统一战术复合装甲板贴图（96×96 无缝平铺）：
 *  - 深蓝灰哑光基底 (#172133)
 *  - 48px 规整几何分舱模组线 + 45° 标志性战术微斜角导槽
 *  - 统一青蓝微光铆钉锚点（无砖块交错缝、无杂乱碎石裂纹） */
export function paintUnifiedTechPanel(c: CanvasRenderingContext2D): void {
  const S = 96
  const half = S / 2

  // 1. 干净统一的深空战术基底
  c.fillStyle = '#162032'
  c.fillRect(0, 0, S, S)

  // 2. 双模组微明暗面板（营造标志性科技秩序感，不抢前景视线）
  c.fillStyle = '#1b273d'
  c.fillRect(2, 2, half - 4, half - 4)
  c.fillRect(half + 2, half + 2, half - 4, half - 4)
  c.fillStyle = '#182337'
  c.fillRect(half + 2, 2, half - 4, half - 4)
  c.fillRect(2, half + 2, half - 4, half - 4)

  // 3. 规整的正交分舱暗槽与青蓝微高光棱线
  c.strokeStyle = 'rgba(10, 15, 26, 0.85)'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(0, half); c.lineTo(S, half)
  c.moveTo(half, 0); c.lineTo(half, S)
  c.stroke()

  c.strokeStyle = 'rgba(56, 189, 248, 0.14)'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(0, 1); c.lineTo(S, 1)
  c.moveTo(0, half + 1); c.lineTo(S, half + 1)
  c.moveTo(1, 0); c.lineTo(1, S)
  c.moveTo(half + 1, 0); c.lineTo(half + 1, S)
  c.stroke()

  // 4. 标志性战术角标与锚定暗铆钉（四角对称，无砖墙感）
  for (const [ox, oy] of [[0, 0], [half, 0], [0, half], [half, half]]) {
    // 面板中心极淡的战术十字准星纹
    c.strokeStyle = 'rgba(56, 189, 248, 0.08)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(ox + half / 2 - 5, oy + half / 2)
    c.lineTo(ox + half / 2 + 5, oy + half / 2)
    c.moveTo(ox + half / 2, oy + half / 2 - 5)
    c.lineTo(ox + half / 2, oy + half / 2 + 5)
    c.stroke()

    // 四角定位铆钉
    for (const [rx, ry] of [[7, 7], [half - 7, 7], [7, half - 7], [half - 7, half - 7]]) {
      c.fillStyle = 'rgba(8, 13, 23, 0.8)'
      c.beginPath()
      c.arc(ox + rx, oy + ry, 1.8, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = 'rgba(125, 211, 252, 0.35)'
      c.beginPath()
      c.arc(ox + rx - 0.4, oy + ry - 0.4, 1.0, 0, Math.PI * 2)
      c.fill()
    }
  }
}

/** 地下背景暗道底纹（同样保持简洁统一的暗色几何网格） */
function paintTunnelBg(c: CanvasRenderingContext2D): void {
  const S = 96
  c.fillStyle = '#090e18'
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(56, 189, 248, 0.06)'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(0, S / 2); c.lineTo(S, S / 2)
  c.moveTo(S / 2, 0); c.lineTo(S / 2, S)
  c.stroke()
}

/** kind → 贴图 key：所有实体方块统一映射为 'unifiedPanel'，彻底去除砖块（brick）等杂乱纹理 */
export function texKindOf(kind: string): string {
  if (kind === 'tunnel_bg' || kind === 'pipe_bg' || kind === 'building_bg') return 'tunnel'
  return 'unifiedPanel'
}

let lastPatternCamX = 0
let lastPatternCamY = 0
let patternMatrix: DOMMatrix | null = null

export function getTerrainPattern(ctx: CanvasRenderingContext2D, kind: string): CanvasPattern | null {
  const key = texKindOf(kind)
  const hit = cache.get(key)
  if (hit) return hit
  const cv = key === 'tunnel' ? makeTex(96, paintTunnelBg) : makeTex(96, paintUnifiedTechPanel)
  const pat = ctx.createPattern(cv, 'repeat')
  if (pat) {
    if (typeof DOMMatrix !== 'undefined' && typeof pat.setTransform === 'function') {
      pat.setTransform(new DOMMatrix().translate(-lastPatternCamX, -lastPatternCamY))
    }
    cache.set(key, pat)
  }
  return pat
}

/** 把地形贴图的锚点补偿到相机世界坐标：贴图随世界一起移动 */
export function syncTerrainPatterns(camX: number, camY: number): void {
  if (typeof DOMMatrix === 'undefined') return
  // 复用同一个矩阵对象：只增量平移相机移动量（上次已平移 -lastCamX/-lastCamY），避免每帧 new DOMMatrix 分配
  if (!patternMatrix) patternMatrix = new DOMMatrix()
  patternMatrix.translateSelf(-(camX - lastPatternCamX), -(camY - lastPatternCamY))
  lastPatternCamX = camX
  lastPatternCamY = camY
  const m = patternMatrix
  for (const pat of cache.values()) {
    if (typeof pat.setTransform === 'function') pat.setTransform(m)
  }
}
