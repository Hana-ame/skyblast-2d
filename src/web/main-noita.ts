// web/main-noita.ts —— 仿 Noita 浏览器入口：可破坏像素地形 + 落沙 + 悬浮 + 360°瞄准
import { NoitaWorld, TILE, W, H, EMPTY, SAND, STONE } from '../core/noita/NoitaWorld.ts'
import { defaultNoitaInput } from '../core/noita/NoitaWorld.ts'
import type { NoitaInput } from '../core/noita/NoitaWorld.ts'
import { fitCanvas, toggleFullscreen } from './fullscreen.ts'

const LW = W * TILE   // 960
const LH = H * TILE   // 600

const canvas = document.getElementById('game') as HTMLCanvasElement
const vp = fitCanvas(canvas, LW, LH)
const ctx = canvas.getContext('2d')!

// Noita 页面不需要 Controls 的跳/喷语义，自建轻量输入（键盘+鼠标+触屏）
const keys = new Set<string>()
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault()
  keys.add(k)
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
let mouse = { x: LW / 2, y: LH / 2 }
let mouseDown = false
canvas.addEventListener('mousemove', (e) => { const w = vp.toWorld(e.clientX, e.clientY); mouse = w })
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true })
window.addEventListener('mouseup', () => { mouseDown = false })
// 触屏：左半=左右移动，右半=悬浮+瞄准开火
const touches = new Map<number, { side: 'L' | 'R'; x: number; y: number }>()
canvas.addEventListener('touchstart', (e) => onTouch(e), { passive: false })
canvas.addEventListener('touchmove', (e) => onTouch(e), { passive: false })
canvas.addEventListener('touchend', (e) => onTouchEnd(e), { passive: false })
function onTouch(e: TouchEvent): void {
  e.preventDefault()
  for (const t of Array.from(e.changedTouches)) {
    const w = vp.toWorld(t.clientX, t.clientY)
    touches.set(t.identifier, { side: w.x < LW / 2 ? 'L' : 'R', ...w })
  }
}
function onTouchEnd(e: TouchEvent): void {
  e.preventDefault()
  for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier)
}

const world = new NoitaWorld()
const player = world.addPlayer(50 * TILE, (H - 46) * TILE)
const enemy = world.addPlayer(190 * TILE, (H - 46) * TILE)

// 像素地形渲染：offscreen 瓦片 canvas（1 tile=1px），每帧只重绘脏瓦片
const terrainCv = document.createElement('canvas')
terrainCv.width = W; terrainCv.height = H
const tctx = terrainCv.getContext('2d')!
let dirty = true
const lastTiles = new Uint8Array(W * H)
function syncTerrain(): void {
  const t = world.tiles
  if (dirty) { // 全量重绘（首次/炸坑后）
    tctx.fillStyle = '#000'
    tctx.fillRect(0, 0, W, H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = t[x + y * W]
        if (v === EMPTY) continue
        tctx.fillStyle = v === SAND ? '#c9a227' : '#5a6470'
        tctx.fillRect(x, y, 1, 1)
      }
    lastTiles.set(t)
    dirty = false
  } else { // 增量：落沙每帧有变化，diff 重绘（36000 瓦片 diff 很快）
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = x + y * W
        if (t[i] !== lastTiles[i]) {
          tctx.fillStyle = t[i] === EMPTY ? '#000' : t[i] === SAND ? '#c9a227' : '#5a6470'
          tctx.fillRect(x, y, 1, 1)
          lastTiles[i] = t[i]
        }
      }
    }
  }
}

document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen)

function toInput(): NoitaInput {
  let move: -1 | 0 | 1 = 0
  let hover = false
  let aim = player.aim
  let fire = false
  // 键盘
  if (keys.has('a') || keys.has('arrowleft')) move = -1
  if (keys.has('d') || keys.has('arrowright')) move = 1
  if (keys.has('w') || keys.has(' ') || keys.has('arrowup')) hover = true
  aim = Math.atan2(mouse.y - player.pos.y, mouse.x - player.pos.x)
  fire = mouseDown
  // 触屏覆盖
  for (const t of touches.values()) {
    if (t.side === 'L') move = t.x < player.pos.x - 20 ? -1 : t.x > player.pos.x + 20 ? 1 : 0
    else { hover = true; aim = Math.atan2(t.y - player.pos.y, t.x - player.pos.x); fire = true }
  }
  return { move, hover, moveY: 0, aim, fire }
}

// AI：朝玩家射 + 追踪
function aiInput(): NoitaInput {
  const dx = player.pos.x - enemy.pos.x, dy = player.pos.y - enemy.pos.y
  const dist = Math.hypot(dx, dy)
  return {
    move: Math.abs(dx) > 140 ? (dx > 0 ? 1 : -1) : 0,
    hover: dist > 220 && enemy.energy > 0.5,
    moveY: 0,
    aim: Math.atan2(dy, dx),
    fire: world.tick % 20 < 14,
  }
}

function drawPlayer(p: typeof player, color: string, label: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(p.pos.x, p.pos.y, 6, 0, Math.PI * 2)
  ctx.fill()
  // 360° 瞄准线
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(p.pos.x, p.pos.y)
  ctx.lineTo(p.pos.x + Math.cos(p.aim) * 18, p.pos.y + Math.sin(p.aim) * 18)
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, p.pos.x, p.pos.y - 12)
}

function render(): void {
  vp.applyTransform()
  // 背景层：每帧先清屏再铺底色，否则 drawImage 只写非透明像素，旧帧残留 → 拖影
  ctx.clearRect(0, 0, LW, LH)
  ctx.fillStyle = '#0e1420'   // 深夜空底色（与地形 offscreen 透明区一致）
  ctx.fillRect(0, 0, LW, LH)
  // 地形（像素放大）
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(terrainCv, 0, 0, W, H, 0, 0, LW, LH)
  // 弹丸
  ctx.fillStyle = '#ffd166'
  for (const b of world.projectiles) {
    ctx.beginPath()
    ctx.arc(b.pos.x, b.pos.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  drawPlayer(player, '#4ade80', 'YOU')
  drawPlayer(enemy, '#f87171', 'AI')
  // HUD
  ctx.fillStyle = '#fff'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`K/D ${player.kills}/${player.deaths} vs ${enemy.kills}/${enemy.deaths}   能量 ${Math.round(player.energy * 100)}%   HP ${player.hp}   tick ${world.tick}`, 12, 20)
  // 能量条
  ctx.fillStyle = '#333'
  ctx.fillRect(12, 28, 100, 6)
  ctx.fillStyle = '#38bdf8'
  ctx.fillRect(12, 28, 100 * player.energy, 6)
}

const FIXED = 1 / 60
let last = performance.now()
let acc = 0
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  acc += dt
  let guard = 0
  while (acc >= FIXED && guard < 5) {
    const inp = toInput()
    world.step(FIXED, new Map([[player.id, inp], [enemy.id, aiInput()]]))
    acc -= FIXED
    guard++
  }
  render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 炸坑检测：暴露给测试（渲染脏标记用）
;(window as unknown as { __noita: unknown }).__noita = {
  world,
  get player() { return player },
  get enemy() { return enemy },
  markDirty() { dirty = true },
}
