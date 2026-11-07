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

function updateStatus(): void {
  if (statusEl) statusEl.textContent = `${map.solids.length} 块`
}

function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP
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
  if (camera.zoom > 0.16) {
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
    erasing = true
    eraseAt(wx, wy)
    return
  }
  if (e.button === 0) {
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
  if (drawStart) drawCur = { x: mouseWorld.x, y: mouseWorld.y }
})

window.addEventListener('mouseup', (e) => {
  if (panning) { panning = false; return }
  if (erasing && e.button === 2) { erasing = false; return }
  if (e.button === 0 && drawStart && drawCur) {
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
  if (e.code === 'Space') spaceDown = true
  if (e.code === 'Digit1') selectKind('platform')
  if (e.code === 'Digit2') selectKind('cover')
  if (e.code === 'Digit3') selectKind('block')
  if (e.code === 'Delete' || e.code === 'Backspace') { /* 不全局删除，避免误删 */ }
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
  map = defaultMapData()
  updateStatus()
})

document.getElementById('btnClear')?.addEventListener('click', () => {
  map = { name: '自定义地图', solids: [] }
  updateStatus()
})

document.getElementById('btnExport')?.addEventListener('click', () => {
  const json = JSON.stringify(map, null, 2)
  window.prompt('复制地图 JSON：', json)
})

document.getElementById('btnImport')?.addEventListener('click', () => {
  const raw = window.prompt('粘贴地图 JSON：')
  if (!raw) return
  try {
    const m = sanitizeMapData(JSON.parse(raw))
    if (!m) { window.alert('JSON 无效（没有有效 solids）'); return }
    map = m
    updateStatus()
  } catch {
    window.alert('JSON 解析失败')
  }
})

updateStatus()
requestAnimationFrame(render)
