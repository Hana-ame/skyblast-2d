// web/main-editor.ts —— 地图编辑器：绘制平台/掩体/方块，保存/导出/应用到游戏
import { defaultMapData, sanitizeMapData } from '../core/map.ts'
import type { MapData, MapSolid, MapSolidKind } from '../core/map.ts'
import { WORLD_W, WORLD_H, SURFACE_Y } from '../core/wrap.ts'
import { SPAWN_POINTS } from '../core/sim/world.ts'

const SNAP = 20
const EDITOR_KEY = 'pvp-editor-map'
const GAME_KEY = 'pvp-custom-map'

const canvas = document.getElementById('editorCanvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const statusEl = document.getElementById('status') as HTMLElement
const brushInput = document.getElementById('brushSize') as HTMLInputElement
const brushLabel = document.getElementById('brushLabel') as HTMLElement

const camera = { x: WORLD_W / 2, y: SURFACE_Y - 500, zoom: 0.22 }
let brushKind: MapSolidKind = 'platform'
let brushTiles = 1
let map: MapData = loadInitial()

// ── 编辑器工具状态 ─────────────────────────────────────────
type Tool = 'draw' | 'select' | 'erase'
let tool: Tool = 'draw'
let snapEnabled = true
let showGrid = true
/** 撤销/重做栈（存快照，最多 80 步） */
const undoStack: string[] = []
const redoStack: string[] = []
const MAX_HISTORY = 80
/** 选择工具下选中的方块索引（-1 = 无） */
let selected = -1
/** 拖动选中方块时的偏移 */
let dragging: { startX: number; startY: number; origX: number; origY: number } | null = null
let drawStart: { x: number; y: number } | null = null
let drawCur: { x: number; y: number } | null = null
let erasing = false
let panning = false
let spaceDown = false
let panLast = { x: 0, y: 0 }
let mouseWorld = { x: 0, y: 0 }

function resize(): void {
  canvas.width = window.innerWidth || 1280
  canvas.height = window.innerHeight || 800
}
window.addEventListener('resize', resize)
resize()

function loadInitial(): MapData {
  try {
    const a = localStorage.getItem(EDITOR_KEY)
    if (a) {
      const m = sanitizeMapData(JSON.parse(a))
      if (m) return m
    }
    const b = localStorage.getItem(GAME_KEY)
    if (b) {
      const m = sanitizeMapData(JSON.parse(b))
      if (m) return m
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

function updateSelectionInfo(): void {
  const el = document.getElementById('selectionInfo')
  if (!el) return
  const s = selected >= 0 ? map.solids[selected] : null
  el.textContent = s
    ? `已选中 #${selected} ${KIND_STYLE[s.kind].label} (${Math.round(s.x)}, ${Math.round(s.y)}) ${Math.round(s.w)}×${Math.round(s.h)} · Delete 删除 · 拖拽移动`
    : ''
}

function hitTest(wx: number, wy: number): number {
  for (let i = map.solids.length - 1; i >= 0; i--) {
    const s = map.solids[i]
    if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return i
  }
  return -1
}

function fitToWindow(): void {
  const margin = 60
  const zx = (canvas.width - margin * 2) / WORLD_W
  const zy = (canvas.height - margin * 2) / SURFACE_Y
  camera.zoom = Math.max(0.05, Math.min(zx, zy))
  camera.x = WORLD_W / 2
  camera.y = SURFACE_Y / 2
}

function updateStatus(): void {
  if (statusEl) statusEl.textContent = `${map.solids.length} 块`
}

function snap(v: number): number {
  return snapEnabled ? Math.round(v / SNAP) * SNAP : Math.round(v)
}
function clampWorldX(x: number): number { return Math.max(0, Math.min(WORLD_W - SNAP, snap(x))) }
function clampWorldY(y: number): number { return Math.max(0, Math.min(SURFACE_Y - SNAP, snap(y))) }

function sx(wx: number): number { return canvas.width / 2 + (wx - camera.x) * camera.zoom }
function sy(wy: number): number { return canvas.height / 2 + (wy - camera.y) * camera.zoom }

function screenToWorld(px: number, py: number): { x: number; y: number } {
  return { x: camera.x + (px - canvas.width / 2) / camera.zoom, y: camera.y + (py - canvas.height / 2) / camera.zoom }
}

const KIND_STYLE: Record<MapSolidKind, { fill: string; stroke: string; label: string }> = {
  platform: { fill: 'rgba(56,189,248,0.35)', stroke: '#38bdf8', label: '平台' },
  cover: { fill: 'rgba(249,115,22,0.35)', stroke: '#f97316', label: '掩体' },
  block: { fill: 'rgba(168,85,247,0.35)', stroke: '#a855f7', label: '方块' },
}

function render(): void {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
  sky.addColorStop(0, '#050914')
  sky.addColorStop(0.6, '#0b1729')
  sky.addColorStop(1, '#122033')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 地面
  const gy = sy(SURFACE_Y)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, gy, canvas.width, canvas.height - gy)

  // 世界边框
  ctx.strokeStyle = 'rgba(100,116,139,0.5)'
  ctx.lineWidth = 1
  ctx.strokeRect(sx(0), sy(0), WORLD_W * camera.zoom, (SURFACE_Y) * camera.zoom)

  // 网格
  if (showGrid && camera.zoom > 0.16) {
    ctx.strokeStyle = 'rgba(51,65,85,0.45)'
    ctx.beginPath()
    for (let x = 0; x <= WORLD_W; x += 200) {
      const px = sx(x)
      ctx.moveTo(px, sy(0)); ctx.lineTo(px, sy(SURFACE_Y))
    }
    for (let y = 0; y <= SURFACE_Y; y += 200) {
      const py = sy(y)
      ctx.moveTo(sx(0), py); ctx.lineTo(sx(WORLD_W), py)
    }
    ctx.stroke()
  }

  // 地图方块
  for (const s of map.solids) {
    const st = KIND_STYLE[s.kind]
    ctx.fillStyle = st.fill
    ctx.strokeStyle = st.stroke
    ctx.lineWidth = 1
    ctx.fillRect(sx(s.x), sy(s.y), s.w * camera.zoom, s.h * camera.zoom)
    ctx.strokeRect(sx(s.x), sy(s.y), s.w * camera.zoom, s.h * camera.zoom)
  }

  // 选中高亮
  if (selected >= 0 && map.solids[selected]) {
    const sel = map.solids[selected]
    ctx.save()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2.5
    ctx.setLineDash([6, 4])
    ctx.strokeRect(sx(sel.x), sy(sel.y), sel.w * camera.zoom, sel.h * camera.zoom)
    ctx.restore()
  }

  // 出生点参考
  for (const sp of SPAWN_POINTS) {
    ctx.fillStyle = sp.team === 'ffa' ? '#fde047' : sp.team === 'red' ? '#fda4af' : sp.team === 'blue' ? '#7dd3fc' : '#6ee7b7'
    ctx.beginPath()
    ctx.arc(sx(sp.x), sy(sp.y), 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // 绘制预览
  if (drawStart && drawCur) {
    const x = Math.min(drawStart.x, drawCur.x)
    const y = Math.min(drawStart.y, drawCur.y)
    const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles
    const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles
    ctx.fillStyle = 'rgba(34,211,238,0.25)'
    ctx.strokeStyle = '#22d3ee'
    ctx.fillRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom)
    ctx.strokeRect(sx(x), sy(y), w * camera.zoom, h * camera.zoom)
  }

  // 光标格
  ctx.strokeStyle = 'rgba(34,211,238,0.8)'
  ctx.strokeRect(sx(mouseWorld.x), sy(mouseWorld.y), SNAP * camera.zoom, SNAP * camera.zoom)

  // 坐标
  ctx.fillStyle = 'rgba(148,163,184,0.9)'
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillText(`x=${Math.round(mouseWorld.x)} y=${Math.round(mouseWorld.y)}  zoom=${camera.zoom.toFixed(2)}`, 12, canvas.height - 12)

  requestAnimationFrame(render)
}

function addRect(kind: MapSolidKind, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return
  map.solids.push({ x, y, w, h, kind })
  updateStatus()
}

function eraseAt(wx: number, wy: number): void {
  const before = map.solids.length
  map.solids = map.solids.filter(s => !(wx >= s.x - SNAP && wx < s.x + s.w + SNAP && wy >= s.y - SNAP && wy < s.y + s.h + SNAP))
  if (map.solids.length !== before) updateStatus()
}

function clampToWorld(v: number, max: number): number {
  return Math.max(0, Math.min(max, snap(v)))
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect()
  const p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = true
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  const wx = clampToWorld(p.x, WORLD_W - SNAP)
  const wy = clampToWorld(p.y, SURFACE_Y - SNAP)
  if (e.button === 2) {
    // 右键：任何工具下都擦除
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
      const hit = hitTest(wx, wy)
      selected = hit
      updateSelectionInfo()
      if (hit >= 0) {
        const s2 = map.solids[hit]
        dragging = { startX: wx, startY: wy, origX: s2.x, origY: s2.y }
        pushHistory()
      }
      return
    }
    // 绘制
    drawStart = { x: wx, y: wy }
    drawCur = { x: wx, y: wy }
  }
})

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect()
  const p = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  mouseWorld = { x: clampToWorld(p.x, WORLD_W - SNAP), y: clampToWorld(p.y, SURFACE_Y - SNAP) }
  if (panning) {
    camera.x -= (e.clientX - panLast.x) / camera.zoom
    camera.y -= (e.clientY - panLast.y) / camera.zoom
    panLast = { x: e.clientX, y: e.clientY }
    return
  }
  if (erasing) { eraseAt(mouseWorld.x, mouseWorld.y); return }
  if (dragging && selected >= 0 && map.solids[selected]) {
    const sel = map.solids[selected]
    sel.x = Math.max(0, Math.min(WORLD_W - sel.w, dragging.origX + (mouseWorld.x - dragging.startX)))
    sel.y = Math.max(0, Math.min(SURFACE_Y - sel.h, dragging.origY + (mouseWorld.y - dragging.startY)))
    if (snapEnabled) { sel.x = snap(sel.x); sel.y = snap(sel.y) }
    updateSelectionInfo()
    return
  }
  if (drawStart) drawCur = { x: mouseWorld.x, y: mouseWorld.y }
})

window.addEventListener('mouseup', (e) => {
  if (panning) { panning = false; return }
  if (dragging) { dragging = null; return }
  if (erasing) { erasing = false; return }
  if (e.button === 0 && drawStart && drawCur) {
    pushHistory()
    const x = Math.min(drawStart.x, drawCur.x)
    const y = Math.min(drawStart.y, drawCur.y)
    const w = Math.abs(drawCur.x - drawStart.x) + SNAP * brushTiles
    const h = Math.abs(drawCur.y - drawStart.y) + SNAP * brushTiles
    addRect(brushKind, x, y, w, h)
    drawStart = null
    drawCur = null
  }
})

canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  const factor = Math.exp(-e.deltaY * 0.0012)
  camera.zoom = Math.max(0.1, Math.min(1.6, camera.zoom * factor))
  const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
  camera.x += before.x - after.x
  camera.y += before.y - after.y
}, { passive: false })

window.addEventListener('keydown', (e) => {
  // 输入框内不拦截快捷键
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  if (e.code === 'Space') spaceDown = true
  if (e.code === 'Digit1') selectKind('platform')
  if (e.code === 'Digit2') selectKind('cover')
  if (e.code === 'Digit3') selectKind('block')
  if (e.code === 'KeyQ') selectTool('draw')
  if (e.code === 'KeyW') selectTool('select')
  if (e.code === 'KeyE') selectTool('erase')
  if (e.code === 'KeyF') fitToWindow()

  // 撤销 / 重做
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && e.code === 'KeyZ') {
    e.preventDefault()
    if (e.shiftKey) redo(); else undo()
    return
  }
  if (ctrl && e.code === 'KeyY') { e.preventDefault(); redo(); return }

  // 删除选中方块
  if ((e.code === 'Delete' || e.code === 'Backspace') && selected >= 0 && map.solids[selected]) {
    e.preventDefault()
    pushHistory()
    map.solids.splice(selected, 1)
    selected = -1
    updateStatus()
    updateSelectionInfo()
  }

  // 方向键微调选中方块（Shift 加速）
  if (selected >= 0 && map.solids[selected] && e.code.startsWith('Arrow')) {
    e.preventDefault()
    const step = e.shiftKey ? SNAP * 5 : SNAP
    const sel = map.solids[selected]
    if (e.code === 'ArrowLeft') sel.x = Math.max(0, sel.x - step)
    if (e.code === 'ArrowRight') sel.x = Math.min(WORLD_W - sel.w, sel.x + step)
    if (e.code === 'ArrowUp') sel.y = Math.max(0, sel.y - step)
    if (e.code === 'ArrowDown') sel.y = Math.min(SURFACE_Y - sel.h, sel.y + step)
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
}
for (const b of document.querySelectorAll('[data-kind]')) {
  b.addEventListener('click', () => selectKind(b.getAttribute('data-kind') as MapSolidKind))
}

// ── 工具切换 ───────────────────────────────────────────────
function selectTool(t: Tool): void {
  tool = t
  selected = t === 'select' ? selected : -1
  for (const b of document.querySelectorAll('[data-tool]')) {
    b.classList.toggle('active', b.getAttribute('data-tool') === t)
  }
  updateSelectionInfo()
}
for (const b of document.querySelectorAll('[data-tool]')) {
  b.addEventListener('click', () => selectTool(b.getAttribute('data-tool') as Tool))
}

// ── 吸附 / 网格开关 ────────────────────────────────────────
const snapToggle = document.getElementById('snapToggle') as HTMLInputElement | null
snapToggle?.addEventListener('change', () => { snapEnabled = snapToggle.checked })
const gridToggle = document.getElementById('gridToggle') as HTMLInputElement | null
gridToggle?.addEventListener('change', () => { showGrid = gridToggle.checked })

// ── 撤销/重做/适配/试玩按钮 ────────────────────────────────
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
  map = { name: '自定义地图', solids: [] }
  selected = -1
  updateStatus()
  updateSelectionInfo()
})

document.getElementById('btnExport')?.addEventListener('click', () => {
  const json = JSON.stringify(map, null, 2)
  // 优先触发文件下载；失败再退回 prompt
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
requestAnimationFrame(render)
