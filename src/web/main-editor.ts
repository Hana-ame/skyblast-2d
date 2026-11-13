// web/main-editor.ts —— 增强版战术地图编辑器：
//   - 统一标志性复合装甲贴图（无砖块纹理）与统一边缘高亮色 (#38bdf8)
//   - 支持“挖狭窄地道 (carve)”工具，直接在地下实心岩层中切割狭窄通道
//   - 支持选择/移动/8向手柄缩放、属性数值精调、对称镜像、快速预设印章、全景小地图导航与高清全景 PNG 导出
import {
  defaultMapData, sanitizeMapData, carveTunnelInSolids,
  MAIN_DECK_TOP, BEDROCK_TOP, CEILING_TOP, CEILING_THICK, WALL_THICK, UNIFIED_EDGE_HIGHLIGHT,
} from '../core/map.ts'
import type { MapData, MapSolid, MapSolidKind } from '../core/map.ts'
import { WORLD_W, WORLD_H } from '../core/wrap.ts'
import { SPAWN_POINTS, FFA_SPAWN_POINTS, AMMO_SPOTS, CENTER_RESPAWN_POINT } from '../core/sim/world.ts'
import { getTerrainPattern, syncTerrainPatterns } from './textures.ts'

const SNAP = 20
const EDITOR_KEY = 'pvp-editor-map'
const GAME_KEY = 'pvp-custom-map'

const canvas = document.getElementById('editorCanvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const statusEl = document.getElementById('status') as HTMLElement
const brushInput = document.getElementById('brushSize') as HTMLInputElement
const brushLabel = document.getElementById('brushLabel') as HTMLElement

const camera = { x: WORLD_W / 2, y: BEDROCK_TOP / 2, zoom: 0.11 }
let brushKind: MapSolidKind = 'platform'
let brushTiles = 1
let map: MapData = loadInitial()

type Tool = 'draw' | 'select' | 'carve' | 'erase'
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'
let tool: Tool = 'draw'
let snapEnabled = true
let showGrid = true
let showTexture = true
let showLandmarks = true

const undoStack: string[] = []
const redoStack: string[] = []
const MAX_HISTORY = 80
let selected = -1

let dragState: {
  mode: HandleId
  startX: number
  startY: number
  orig: MapSolid
} | null = null
let drawStart: { x: number; y: number } | null = null
let drawCur: { x: number; y: number } | null = null
let erasing = false
let panning = false
let spaceDown = false
let panLast = { x: 0, y: 0 }
let mouseWorld = { x: 0, y: 0 }

const MINIMAP_W = 280
const MINIMAP_H = Math.round(MINIMAP_W * (WORLD_H / WORLD_W))
const MINIMAP_PAD = 16

function resize(): void {
  canvas.width = window.innerWidth || 1280
  canvas.height = window.innerHeight || 800
}
window.addEventListener('resize', resize)
resize()
fitToWindow()

function loadInitial(): MapData {
  try {
    const a = localStorage.getItem(EDITOR_KEY)
    if (a) {
      const m = sanitizeMapData(JSON.parse(a))
      if (m && m.name === defaultMapData().name) return m
    }
    const b = localStorage.getItem(GAME_KEY)
    if (b) {
      const m = sanitizeMapData(JSON.parse(b))
      if (m && m.name === defaultMapData().name) return m
    }
  } catch { /* ignore */ }
  return defaultMapData()
}

function pushHistory(): void {
  undoStack.push(JSON.stringify(map))
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
}

function undo(): void {
  const prev = undoStack.pop()
  if (!prev) return
  redoStack.push(JSON.stringify(map))
  map = JSON.parse(prev) as MapData
  selected = -1
  updateStatus()
  updateSelectionInfo()
}

function redo(): void {
  const next = redoStack.pop()
  if (!next) return
  undoStack.push(JSON.stringify(map))
  map = JSON.parse(next) as MapData
  selected = -1
  updateStatus()
  updateSelectionInfo()
}

const KIND_LABEL: Record<MapSolidKind, string> = {
  platform: '平台',
  cover: '掩体',
  block: '岩块',
}

function updateSelectionInfo(): void {
  const el = document.getElementById('selectionInfo')
  const inspX = document.getElementById('inspX') as HTMLInputElement | null
  const inspY = document.getElementById('inspY') as HTMLInputElement | null
  const inspW = document.getElementById('inspW') as HTMLInputElement | null
  const inspH = document.getElementById('inspH') as HTMLInputElement | null
  const s = selected >= 0 ? map.solids[selected] : null
  if (el) {
    el.textContent = s
      ? `已选中 #${selected} [${KIND_LABEL[s.kind]}] (${Math.round(s.x)}, ${Math.round(s.y)}) ${Math.round(s.w)}×${Math.round(s.h)} · 可拖拽8向手柄缩放`
      : '未选中方块（切换“选择/缩放”点选方块，可拖拽 8 个边缘手柄缩放）'
  }
  if (inspX && inspY && inspW && inspH) {
    if (s) {
      inspX.value = String(Math.round(s.x))
      inspY.value = String(Math.round(s.y))
      inspW.value = String(Math.round(s.w))
      inspH.value = String(Math.round(s.h))
      inspX.disabled = inspY.disabled = inspW.disabled = inspH.disabled = false
    } else {
      inspX.value = inspY.value = inspW.value = inspH.value = ''
      inspX.disabled = inspY.disabled = inspW.disabled = inspH.disabled = true
    }
  }
}

function hitTest(wx: number, wy: number): number {
  for (let i = map.solids.length - 1; i >= 0; i--) {
    const s = map.solids[i]
    if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return i
  }
  return -1
}

function getResizeHandles(s: MapSolid): { id: HandleId; x: number; y: number }[] {
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  return [
    { id: 'nw', x: s.x, y: s.y },
    { id: 'n', x: cx, y: s.y },
    { id: 'ne', x: s.x + s.w, y: s.y },
    { id: 'e', x: s.x + s.w, y: cy },
    { id: 'se', x: s.x + s.w, y: s.y + s.h },
    { id: 's', x: cx, y: s.y + s.h },
    { id: 'sw', x: s.x, y: s.y + s.h },
    { id: 'w', x: s.x, y: cy },
  ]
}

function hitTestHandle(wx: number, wy: number): HandleId | null {
  if (selected < 0 || !map.solids[selected]) return null
  const s = map.solids[selected]
  const tol = Math.max(18, 10 / camera.zoom)
  for (const h of getResizeHandles(s)) {
    if (Math.abs(wx - h.x) <= tol && Math.abs(wy - h.y) <= tol) return h.id
  }
  if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return 'move'
  return null
}

function fitToWindow(): void {
  const margin = 48
  const availW = Math.max(400, canvas.width - 420 - margin)
  const availH = Math.max(300, canvas.height - margin * 2)
  camera.zoom = Math.max(0.05, Math.min(availW / WORLD_W, availH / (BEDROCK_TOP + 300)))
  camera.x = WORLD_W / 2 - (180 / camera.zoom)
  camera.y = (BEDROCK_TOP + 200) / 2
}

function updateStatus(): void {
  if (statusEl) statusEl.textContent = `${map.solids.length} 块 · 统一高亮 ${UNIFIED_EDGE_HIGHLIGHT}`
}

function snap(v: number): number {
  return snapEnabled ? Math.round(v / SNAP) * SNAP : Math.round(v)
}

function sx(wx: number): number { return canvas.width / 2 + (wx - camera.x) * camera.zoom }
function sy(wy: number): number { return canvas.height / 2 + (wy - camera.y) * camera.zoom }

function screenToWorld(px: number, py: number): { x: number; y: number } {
  return { x: camera.x + (px - canvas.width / 2) / camera.zoom, y: camera.y + (py - canvas.height / 2) / camera.zoom }
}

function render(): void {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
  sky.addColorStop(0, '#040812')
  sky.addColorStop(0.55, '#091326')
  sky.addColorStop(1, '#0e1b33')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 地下区域暗色背景衬底（y = MAIN_DECK_TOP..BEDROCK_TOP）
  const ugTop = sy(MAIN_DECK_TOP)
  const gy = sy(BEDROCK_TOP)
  ctx.fillStyle = 'rgba(7, 11, 20, 0.55)'
  ctx.fillRect(sx(0), ugTop, WORLD_W * camera.zoom, gy - ugTop)

  // 底部基岩（统一纹理 + 统一 #38bdf8 高亮）
  ctx.fillStyle = '#131c2e'
  ctx.fillRect(sx(0), gy, WORLD_W * camera.zoom, (WORLD_H - BEDROCK_TOP) * camera.zoom)
  ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
  ctx.lineWidth = 2
  ctx.strokeRect(sx(0), gy, WORLD_W * camera.zoom, (WORLD_H - BEDROCK_TOP) * camera.zoom)

  // 世界外框
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx(0), sy(0), WORLD_W * camera.zoom, BEDROCK_TOP * camera.zoom)

  // 网格
  if (showGrid && camera.zoom > 0.08) {
    const step = camera.zoom > 0.22 ? 200 : 400
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= WORLD_W; x += step) {
      const px = sx(x)
      ctx.moveTo(px, sy(0)); ctx.lineTo(px, sy(BEDROCK_TOP))
    }
    for (let y = 0; y <= BEDROCK_TOP; y += step) {
      const py = sy(y)
      ctx.moveTo(sx(0), py); ctx.lineTo(sx(WORLD_W), py)
    }
    ctx.stroke()
  }

  // 地下分界参考线（y=1760：出生点以下为地下狭窄地道区）
  ctx.save()
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
  ctx.lineWidth = 1.2
  ctx.setLineDash([8, 6])
  ctx.beginPath()
  ctx.moveTo(sx(0), ugTop)
  ctx.lineTo(sx(WORLD_W), ugTop)
  ctx.stroke()
  ctx.fillStyle = 'rgba(125, 211, 252, 0.78)'
  ctx.font = 'bold 11px Inter, sans-serif'
  ctx.fillText('▼ 主地面 (y=2400..2640 厚240px+凹陷坑) 以下：地板下贯通地道与四层深邃地下狭道区 (y=2640..4160)', sx(140), ugTop - 6)
  ctx.restore()

  // 地图实心方块（统一标志性复合装甲贴图 + 统一边缘高亮色 #38bdf8）
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.scale(camera.zoom, camera.zoom)
  syncTerrainPatterns(camera.x, camera.y)
  for (const s of map.solids) {
    const left = s.x - camera.x
    const top = s.y - camera.y
    if (showTexture) {
      const pat = getTerrainPattern(ctx, s.kind)
      ctx.fillStyle = pat ?? '#162032'
    } else {
      ctx.fillStyle = '#182438'
    }
    ctx.fillRect(left, top, s.w, s.h)
    // 顶部受光棱与底部暗棱
    ctx.fillStyle = 'rgba(56, 189, 248, 0.28)'
    ctx.fillRect(left, top, s.w, 3)
    ctx.fillStyle = 'rgba(2, 6, 23, 0.45)'
    ctx.fillRect(left, top + s.h - 3, s.w, 3)
    // 统一边缘高亮色 (#38bdf8)
    ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
    ctx.lineWidth = Math.max(1.5, 2 / camera.zoom)
    ctx.strokeRect(left + 1, top + 1, s.w - 2, s.h - 2)
  }
  ctx.restore()

  // 选中高亮 + 8个缩放控制手柄
  if (selected >= 0 && map.solids[selected]) {
    const sel = map.solids[selected]
    ctx.save()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2.5
    ctx.setLineDash([6, 4])
    ctx.strokeRect(sx(sel.x), sy(sel.y), sel.w * camera.zoom, sel.h * camera.zoom)
    ctx.setLineDash([])
    for (const h of getResizeHandles(sel)) {
      const hx = sx(h.x)
      const hy = sy(h.y)
      ctx.fillStyle = '#fbbf24'
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 1.5
      ctx.fillRect(hx - 4.5, hy - 4.5, 9, 9)
      ctx.strokeRect(hx - 4.5, hy - 4.5, 9, 9)
    }
    ctx.restore()
  }

  // 地标参考层（左右基地、正中复活点旗帜、均匀分布的 FFA 出生点、近中心弹药刷新点）
  if (showLandmarks) {
    // 1. 均匀分布的 FFA 出生点与左右基地
    for (const sp of SPAWN_POINTS) {
      const px = sx(sp.x)
      const py = sy(sp.y)
      ctx.save()
      if (sp.team === 'ffa') {
        ctx.fillStyle = '#facc15'
        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(px, py, 5.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        if (camera.zoom >= 0.09) {
          ctx.fillStyle = '#fde047'
          ctx.font = 'bold 10px Inter, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('FFA', px, py - 8)
        }
      } else if (sp.team === 'red' || sp.team === 'blue') {
        const isLeft = sp.x < WORLD_W / 2
        ctx.fillStyle = isLeft ? 'rgba(14,165,233,0.4)' : 'rgba(244,63,94,0.4)'
        ctx.strokeStyle = isLeft ? '#38bdf8' : '#f43f5e'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.ellipse(px, py - 10, Math.max(8, 34 * camera.zoom), Math.max(12, 50 * camera.zoom), 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }

    // 2. 正中央旗帜与复活点
    {
      const cx = sx(CENTER_RESPAWN_POINT.x)
      const cy = sy(CENTER_RESPAWN_POINT.y)
      ctx.save()
      ctx.fillStyle = '#10b981'
      ctx.strokeStyle = '#ecfdf5'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#6ee7b7'
      ctx.font = 'bold 11px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('🚩 正中复活点 C', cx, cy - 11)
      ctx.restore()
    }

    // 3. 靠近中间的弹药刷新点
    for (const am of AMMO_SPOTS) {
      const ax = sx(am.x)
      const ay = sy(am.y)
      ctx.save()
      ctx.fillStyle = '#22c55e'
      ctx.strokeStyle = '#052e16'
      ctx.lineWidth = 1.5
      ctx.fillRect(ax - 5, ay - 5, 10, 10)
      ctx.strokeRect(ax - 5, ay - 5, 10, 10)
      if (camera.zoom >= 0.09) {
        ctx.fillStyle = '#86efac'
        ctx.font = 'bold 10px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('弹药', ax, ay - 8)
      }
      ctx.restore()
    }
  }

  // 绘制或挖地道预览框
  if (drawStart && drawCur) {
    const x = Math.min(drawStart.x, drawCur.x)
    const y = Math.min(drawStart.y, drawCur.y)
    const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles
    const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles
    ctx.save()
    if (tool === 'carve') {
      ctx.fillStyle = 'rgba(244, 63, 94, 0.28)'
      ctx.strokeStyle = '#fb7185'
      ctx.setLineDash([6, 4])
    } else {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)'
      ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
    }
    ctx.lineWidth = 2
    ctx.fillRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom)
    ctx.strokeRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom)
    ctx.restore()
  }

  // 光标格
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
  ctx.strokeRect(sx(mouseWorld.x), sy(mouseWorld.y), SNAP * camera.zoom, SNAP * camera.zoom)

  // 右下角全景交互缩略图 (Minimap)
  renderMinimap()

  // 底部状态坐标栏
  ctx.fillStyle = 'rgba(226, 232, 240, 0.92)'
  ctx.font = 'bold 12px Inter, system-ui, sans-serif'
  ctx.fillText(
    `坐标 (${Math.round(mouseWorld.x)}, ${Math.round(mouseWorld.y)}) · 缩放 ${(camera.zoom * 100).toFixed(0)}% · FFA出生点 ${FFA_SPAWN_POINTS.length} 处 · 中心弹药点 ${AMMO_SPOTS.length} 处`,
    420,
    canvas.height - 14,
  )

  requestAnimationFrame(render)
}

function renderMinimap(): void {
  const mx = canvas.width - MINIMAP_W - MINIMAP_PAD
  const my = canvas.height - MINIMAP_H - MINIMAP_PAD
  ctx.save()
  ctx.fillStyle = 'rgba(2, 6, 23, 0.9)'
  ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
  ctx.lineWidth = 1.5
  ctx.fillRect(mx, my, MINIMAP_W, MINIMAP_H)
  ctx.strokeRect(mx, my, MINIMAP_W, MINIMAP_H)

  const scaleX = MINIMAP_W / WORLD_W
  const scaleY = MINIMAP_H / WORLD_H

  // 缩略图内的所有地形块
  ctx.fillStyle = '#1e293b'
  ctx.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
  ctx.lineWidth = 0.6
  for (const s of map.solids) {
    const rx = mx + s.x * scaleX
    const ry = my + s.y * scaleY
    const rw = Math.max(1, s.w * scaleX)
    const rh = Math.max(1, s.h * scaleY)
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeRect(rx, ry, rw, rh)
  }

  // FFA 出生点与中心弹药点
  ctx.fillStyle = '#facc15'
  for (const sp of FFA_SPAWN_POINTS) {
    ctx.fillRect(mx + sp.x * scaleX - 1.5, my + sp.y * scaleY - 1.5, 3, 3)
  }
  ctx.fillStyle = '#22c55e'
  for (const am of AMMO_SPOTS) {
    ctx.fillRect(mx + am.x * scaleX - 1.5, my + am.y * scaleY - 1.5, 3, 3)
  }

  // 当前相机视口框
  const vw = (canvas.width / camera.zoom) * scaleX
  const vh = (canvas.height / camera.zoom) * scaleY
  const vx = mx + (camera.x - canvas.width / 2 / camera.zoom) * scaleX
  const vy = my + (camera.y - canvas.height / 2 / camera.zoom) * scaleY
  ctx.strokeStyle = '#fbbf24'
  ctx.lineWidth = 1.2
  ctx.strokeRect(vx, vy, vw, vh)
  ctx.restore()
}

function addRect(kind: MapSolidKind, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return
  map.solids.push({ x, y, w, h, kind })
  selected = map.solids.length - 1
  updateStatus()
  updateSelectionInfo()
}

function eraseAt(wx: number, wy: number): void {
  const before = map.solids.length
  map.solids = map.solids.filter(s => !(wx >= s.x - SNAP && wx < s.x + s.w + SNAP && wy >= s.y - SNAP && wy < s.y + s.h + SNAP))
  if (map.solids.length !== before) {
    selected = -1
    updateStatus()
    updateSelectionInfo()
  }
}

function clampToWorld(v: number, max: number): number {
  return Math.max(0, Math.min(max, snap(v)))
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect()
  const sxPx = e.clientX - rect.left
  const syPx = e.clientY - rect.top

  // 点击右下角全景小地图：直接跳转相机
  const mx = canvas.width - MINIMAP_W - MINIMAP_PAD
  const my = canvas.height - MINIMAP_H - MINIMAP_PAD
  if (sxPx >= mx && sxPx <= mx + MINIMAP_W && syPx >= my && syPx <= my + MINIMAP_H) {
    camera.x = ((sxPx - mx) / MINIMAP_W) * WORLD_W
    camera.y = ((syPx - my) / MINIMAP_H) * WORLD_H
    return
  }

  const p = screenToWorld(sxPx, syPx)
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = true
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  const wx = clampToWorld(p.x, WORLD_W - SNAP)
  const wy = clampToWorld(p.y, BEDROCK_TOP - SNAP)
  if (e.button === 2) {
    pushHistory()
    erasing = true
    eraseAt(wx, wy)
    return
  }
  if (e.button === 0) {
    if (tool === 'erase') {
      pushHistory()
      erasing = true
      eraseAt(wx, wy)
      return
    }
    if (tool === 'select') {
      const handle = hitTestHandle( p.x, p.y )
      if (handle && selected >= 0 && map.solids[selected]) {
        pushHistory()
        dragState = { mode: handle, startX: wx, startY: wy, orig: { ...map.solids[selected] } }
        return
      }
      const hit = hitTest(wx, wy)
      selected = hit
      updateSelectionInfo()
      if (hit >= 0) {
        pushHistory()
        dragState = { mode: 'move', startX: wx, startY: wy, orig: { ...map.solids[hit] } }
      }
      return
    }
    // draw 或 carve（挖狭窄地道）
    drawStart = { x: wx, y: wy }
    drawCur = { x: wx, y: wy }
  }
})

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect()
  const p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  mouseWorld = { x: clampToWorld(p.x, WORLD_W - SNAP), y: clampToWorld(p.y, BEDROCK_TOP - SNAP) }
  if (panning) {
    camera.x -= (e.clientX - panLast.x) / camera.zoom
    camera.y -= (e.clientY - panLast.y) / camera.zoom
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  if (erasing) { eraseAt(mouseWorld.x, mouseWorld.y); return }
  if (dragState && selected >= 0 && map.solids[selected]) {
    const sel = map.solids[selected]
    const dx = mouseWorld.x - dragState.startX
    const dy = mouseWorld.y - dragState.startY
    const o = dragState.orig
    if (dragState.mode === 'move') {
      sel.x = Math.max(0, Math.min(WORLD_W - sel.w, snap(o.x + dx)))
      sel.y = Math.max(0, Math.min(BEDROCK_TOP - sel.h, snap(o.y + dy)))
    } else {
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h
      if (dragState.mode.includes('w')) x0 = Math.min(x1 - SNAP, snap(o.x + dx))
      if (dragState.mode.includes('e')) x1 = Math.max(x0 + SNAP, snap(o.x + o.w + dx))
      if (dragState.mode.includes('n')) y0 = Math.min(y1 - SNAP, snap(o.y + dy))
      if (dragState.mode.includes('s')) y1 = Math.max(y0 + SNAP, snap(o.y + o.h + dy))
      sel.x = Math.max(0, x0)
      sel.y = Math.max(0, y0)
      sel.w = Math.max(SNAP, Math.min(WORLD_W - sel.x, x1 - sel.x))
      sel.h = Math.max(SNAP, Math.min(BEDROCK_TOP - sel.y, y1 - sel.y))
    }
    updateSelectionInfo()
    return
  }
  if (drawStart) drawCur = { x: mouseWorld.x, y: mouseWorld.y }
})

window.addEventListener('mouseup', (e) => {
  if (panning) { panning = false; return }
  if (dragState) { dragState = null; return }
  if (erasing) { erasing = false; return }
  if (e.button === 0 && drawStart && drawCur) {
    pushHistory()
    const x = Math.min(drawStart.x, drawCur.x)
    const y = Math.min(drawStart.y, drawCur.y)
    const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles
    const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles
    if (tool === 'carve') {
      map.solids = carveTunnelInSolids(map.solids, { x, y, w, h }, SNAP)
      selected = -1
      updateStatus()
      updateSelectionInfo()
    } else {
      addRect(brushKind, x, y, w, h)
    }
    drawStart = null
    drawCur = null
  }
})

canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  const factor = Math.exp(-e.deltaY * 0.0012)
  camera.zoom = Math.max(0.05, Math.min(1.6, camera.zoom * factor))
  const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  camera.x += before.x - after.x
  camera.y += before.y - after.y
}, { passive: false })

function duplicateSelected(): void {
  if (selected < 0 || !map.solids[selected]) return
  pushHistory()
  const s = map.solids[selected]
  map.solids.push({
    x: Math.min(WORLD_W - s.w, s.x + 80),
    y: Math.min(BEDROCK_TOP - s.h, s.y + 80),
    w: s.w,
    h: s.h,
    kind: s.kind,
  })
  selected = map.solids.length - 1
  updateStatus()
  updateSelectionInfo()
}

function mirrorSelectedAcrossCenter(): void {
  if (selected < 0 || !map.solids[selected]) return
  pushHistory()
  const s = map.solids[selected]
  const mx = Math.max(0, Math.min(WORLD_W - s.w, WORLD_W - s.x - s.w))
  map.solids.push({ x: mx, y: s.y, w: s.w, h: s.h, kind: s.kind })
  selected = map.solids.length - 1
  updateStatus()
  updateSelectionInfo()
}

function symmetrizeMapLeftToRight(): void {
  pushHistory()
  const mid = WORLD_W / 2
  const kept: MapSolid[] = []
  const mirrored: MapSolid[] = []
  for (const s of map.solids) {
    // 保留横跨全图或跨越中轴线的块，以及左半场块
    if (s.x <= mid && s.x + s.w >= mid) {
      kept.push({ ...s })
    } else if (s.x + s.w <= mid) {
      kept.push({ ...s })
      mirrored.push({
        x: WORLD_W - s.x - s.w,
        y: s.y,
        w: s.w,
        h: s.h,
        kind: s.kind,
      })
    }
  }
  map.solids = [...kept, ...mirrored]
  selected = -1
  updateStatus()
  updateSelectionInfo()
}

/** 导出高清全景 PNG */
function exportPanoramaPng(): void {
  const outW = 3300
  const outH = 1100
  const off = document.createElement('canvas')
  off.width = outW
  off.height = outH
  const c = off.getContext('2d')!
  const scale = outW / WORLD_W

  const sky = c.createLinearGradient(0, 0, 0, outH)
  sky.addColorStop(0, '#040812')
  sky.addColorStop(0.55, '#091326')
  sky.addColorStop(1, '#0e1b33')
  c.fillStyle = sky
  c.fillRect(0, 0, outW, outH)

  c.save()
  c.scale(scale, scale)

  // 地下背景带
  c.fillStyle = 'rgba(7, 11, 20, 0.72)'
  c.fillRect(0, MAIN_DECK_TOP, WORLD_W, BEDROCK_TOP - MAIN_DECK_TOP)

  // 底部基岩
  const pat = getTerrainPattern(c, 'earth')
  c.fillStyle = pat ?? '#162032'
  c.fillRect(0, BEDROCK_TOP, WORLD_W, WORLD_H - BEDROCK_TOP)
  c.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
  c.lineWidth = 6
  c.strokeRect(3, BEDROCK_TOP + 3, WORLD_W - 6, WORLD_H - BEDROCK_TOP - 6)

  // 全部地形块（统一贴图 + #38bdf8 边缘高亮）
  for (const s of map.solids) {
    c.fillStyle = getTerrainPattern(c, s.kind) ?? '#162032'
    c.fillRect(s.x, s.y, s.w, s.h)
    c.fillStyle = 'rgba(56, 189, 248, 0.30)'
    c.fillRect(s.x, s.y, s.w, 6)
    c.strokeStyle = UNIFIED_EDGE_HIGHLIGHT
    c.lineWidth = 5
    c.strokeRect(s.x + 2.5, s.y + 2.5, s.w - 5, s.h - 5)
  }

  // 绘制基地、均匀分布 FFA 出生点、正中旗帜复活点、近中心弹药刷新点
  for (const sp of SPAWN_POINTS) {
    if (sp.team === 'ffa') {
      c.fillStyle = '#facc15'
      c.beginPath()
      c.arc(sp.x, sp.y - 12, 26, 0, Math.PI * 2)
      c.fill()
    } else if (sp.team === 'red' || sp.team === 'blue') {
      const isLeft = sp.x < WORLD_W / 2
      c.fillStyle = isLeft ? 'rgba(14,165,233,0.45)' : 'rgba(244,63,94,0.45)'
      c.strokeStyle = isLeft ? '#38bdf8' : '#f43f5e'
      c.lineWidth = 8
      c.beginPath()
      c.ellipse(sp.x, sp.y - 42, 48, 68, 0, 0, Math.PI * 2)
      c.fill()
      c.stroke()
    }
  }
  for (const am of AMMO_SPOTS) {
    c.fillStyle = '#22c55e'
    c.fillRect(am.x - 22, am.y - 28, 44, 32)
  }
  c.fillStyle = '#10b981'
  c.beginPath()
  c.arc(CENTER_RESPAWN_POINT.x, CENTER_RESPAWN_POINT.y - 24, 36, 0, Math.PI * 2)
  c.fill()
  c.restore()

  const url = off.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'skyblast-2d-panorama.png'
  a.click()
}

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  if (e.code === 'Space') spaceDown = true
  if (e.code === 'Digit1') selectKind('platform')
  if (e.code === 'Digit2') selectKind('cover')
  if (e.code === 'Digit3') selectKind('block')
  if (e.code === 'KeyQ') selectTool('draw')
  if (e.code === 'KeyW') selectTool('select')
  if (e.code === 'KeyT') selectTool('carve')
  if (e.code === 'KeyE') selectTool('erase')
  if (e.code === 'KeyF') fitToWindow()

  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && e.code === 'KeyZ') {
    e.preventDefault()
    if (e.shiftKey) redo(); else undo()
    return
  }
  if (ctrl && e.code === 'KeyY') { e.preventDefault(); redo(); return }
  if (ctrl && e.code === 'KeyD') { e.preventDefault(); duplicateSelected(); return }

  if ((e.code === 'Delete' || e.code === 'Backspace') && selected >= 0 && map.solids[selected]) {
    e.preventDefault()
    pushHistory()
    map.solids.splice(selected, 1)
    selected = -1
    updateStatus()
    updateSelectionInfo()
  }

  if (selected >= 0 && map.solids[selected] && e.code.startsWith('Arrow')) {
    e.preventDefault()
    const step = e.shiftKey ? SNAP * 5 : SNAP
    const sel = map.solids[selected]
    if (e.code === 'ArrowLeft') sel.x = Math.max(0, sel.x - step)
    if (e.code === 'ArrowRight') sel.x = Math.min(WORLD_W - sel.w, sel.x + step)
    if (e.code === 'ArrowUp') sel.y = Math.max(0, sel.y - step)
    if (e.code === 'ArrowDown') sel.y = Math.min(BEDROCK_TOP - sel.h, sel.y + step)
    updateSelectionInfo()
  }
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false
})

function selectKind(kind: MapSolidKind): void {
  brushKind = kind
  for (const b of document.querySelectorAll('[data-kind]')) {
    b.classList.toggle('active', b.getAttribute('data-kind') === kind)
  }
  if (selected >= 0 && map.solids[selected]) {
    map.solids[selected].kind = kind
    updateSelectionInfo()
  }
}
for (const b of document.querySelectorAll('[data-kind]')) {
  b.addEventListener('click', () => selectKind(b.getAttribute('data-kind') as MapSolidKind))
}

function selectTool(t: Tool): void {
  tool = t
  for (const b of document.querySelectorAll('[data-tool]')) {
    b.classList.toggle('active', b.getAttribute('data-tool') === t)
  }
  updateSelectionInfo()
}
for (const b of document.querySelectorAll('[data-tool]')) {
  b.addEventListener('click', () => selectTool(b.getAttribute('data-tool') as Tool))
}

// Inspector 数值输入同步
for (const [id, key] of [['inspX', 'x'], ['inspY', 'y'], ['inspW', 'w'], ['inspH', 'h']] as const) {
  const inp = document.getElementById(id) as HTMLInputElement | null
  inp?.addEventListener('change', () => {
    if (selected < 0 || !map.solids[selected]) return
    pushHistory()
    const v = Math.max(key === 'w' || key === 'h' ? SNAP : 0, Number(inp.value) || 0)
    map.solids[selected][key] = v
    updateSelectionInfo()
  })
}

// 预设构件印章
document.getElementById('stampTunnelH')?.addEventListener('click', () => {
  pushHistory()
  const cx = snap(camera.x - 400)
  const cy = snap(Math.max(MAIN_DECK_TOP + 40, camera.y - 120))
  map.solids.push(
    { x: cx, y: cy, w: 800, h: 60, kind: 'block' },
    { x: cx, y: cy + 200, w: 800, h: 60, kind: 'block' },
  )
  updateStatus()
})
document.getElementById('stampShaftV')?.addEventListener('click', () => {
  pushHistory()
  const cx = snap(camera.x - 140)
  const cy = snap(Math.max(MAIN_DECK_TOP + 40, camera.y - 200))
  map.solids.push(
    { x: cx, y: cy, w: 60, h: 400, kind: 'block' },
    { x: cx + 220, y: cy, w: 60, h: 400, kind: 'block' },
  )
  updateStatus()
})
document.getElementById('stampArchBlock')?.addEventListener('click', () => {
  pushHistory()
  addRect('block', snap(camera.x - 320), snap(Math.min(1400, camera.y - 110)), 640, 220)
})
document.getElementById('stampPillar')?.addEventListener('click', () => {
  pushHistory()
  addRect('cover', snap(camera.x - 60), snap(camera.y - 160), 120, 320)
})

document.getElementById('btnMirrorSel')?.addEventListener('click', mirrorSelectedAcrossCenter)
document.getElementById('btnSymmetrize')?.addEventListener('click', symmetrizeMapLeftToRight)
document.getElementById('btnDuplicate')?.addEventListener('click', duplicateSelected)
document.getElementById('btnExportPng')?.addEventListener('click', exportPanoramaPng)

const snapToggle = document.getElementById('snapToggle') as HTMLInputElement | null
snapToggle?.addEventListener('change', () => { snapEnabled = snapToggle.checked })
const gridToggle = document.getElementById('gridToggle') as HTMLInputElement | null
gridToggle?.addEventListener('change', () => { showGrid = gridToggle.checked })
const texToggle = document.getElementById('texToggle') as HTMLInputElement | null
texToggle?.addEventListener('change', () => { showTexture = texToggle.checked })
const landmarkToggle = document.getElementById('landmarkToggle') as HTMLInputElement | null
landmarkToggle?.addEventListener('change', () => { showLandmarks = landmarkToggle.checked })

document.getElementById('btnUndo')?.addEventListener('click', undo)
document.getElementById('btnRedo')?.addEventListener('click', redo)
document.getElementById('btnFit')?.addEventListener('click', fitToWindow)
document.getElementById('btnPlay')?.addEventListener('click', () => {
  localStorage.setItem(GAME_KEY, JSON.stringify(map))
  localStorage.setItem(EDITOR_KEY, JSON.stringify(map))
  window.location.href = './index.html?play=1'
})

brushInput?.addEventListener('input', () => {
  brushTiles = Number(brushInput.value)
  if (brushLabel) brushLabel.textContent = `${brushTiles}×${brushTiles * SNAP}px`
})

document.getElementById('btnSave')?.addEventListener('click', () => {
  localStorage.setItem(EDITOR_KEY, JSON.stringify(map))
  statusEl.textContent = `${map.solids.length} 块 · 已保存`
})

document.getElementById('btnApply')?.addEventListener('click', () => {
  localStorage.setItem(GAME_KEY, JSON.stringify(map))
  localStorage.setItem(EDITOR_KEY, JSON.stringify(map))
  window.location.href = './index.html'
})

document.getElementById('btnReset')?.addEventListener('click', () => {
  pushHistory()
  map = defaultMapData()
  selected = -1
  updateStatus()
  updateSelectionInfo()
})

document.getElementById('btnClear')?.addEventListener('click', () => {
  pushHistory()
  map = {
    name: '自定义封闭竞技场',
    solids: [
      { x: 0, y: CEILING_TOP, w: WORLD_W, h: CEILING_THICK, kind: 'platform' },
      { x: 0, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: BEDROCK_TOP - (CEILING_TOP + CEILING_THICK), kind: 'platform' },
      { x: WORLD_W - WALL_THICK, y: CEILING_TOP + CEILING_THICK, w: WALL_THICK, h: BEDROCK_TOP - (CEILING_TOP + CEILING_THICK), kind: 'platform' },
    ],
  }
  selected = -1
  updateStatus()
  updateSelectionInfo()
})

document.getElementById('btnExport')?.addEventListener('click', () => {
  const json = JSON.stringify(map, null, 2)
  try {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${map.name || 'map'}.json`
    a.click()
    URL.revokeObjectURL(url)
    statusEl.textContent = `${map.solids.length} 块 · 已导出`
  } catch {
    window.prompt('复制地图 JSON：', json)
  }
})

document.getElementById('btnImport')?.addEventListener('click', () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.addEventListener('change', () => {
    const f = input.files?.[0]
    if (f) {
      const reader = new FileReader()
      reader.onload = () => importJson(String(reader.result ?? ''))
      reader.readAsText(f)
    } else {
      const raw = window.prompt('粘贴地图 JSON：')
      if (raw) importJson(raw)
    }
  })
  input.click()
})

function importJson(raw: string): void {
  if (!raw) return
  try {
    const m = sanitizeMapData(JSON.parse(raw))
    if (!m) { window.alert('JSON 无效（没有有效 solids）'); return }
    pushHistory()
    map = m
    selected = -1
    updateStatus()
    updateSelectionInfo()
  } catch {
    window.alert('JSON 解析失败')
  }
}

updateStatus()
updateSelectionInfo()
requestAnimationFrame(render)
