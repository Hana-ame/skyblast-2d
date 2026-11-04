// web/main-web.ts —— 浏览器入口：canvas 渲染 + 本地单机对战（可玩：地形/物理/手柄/全屏）
import { World, GROUND_Y, PLAYER_R, WALL_L, WALL_R } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput } from '../core/types.ts'
import type { Intent } from '../input/intent.ts'
import { JETPACK_FUEL, updateJetpackFuel } from '../core/sim/physics.ts'
import { applyIntents } from '../net/ServerSim.ts'
import { Controls } from './controls.ts'
import { fitCanvas, toggleFullscreen } from './fullscreen.ts'

const W = 960
const H = 600

const canvas = document.getElementById('game') as HTMLCanvasElement
const vp = fitCanvas(canvas, W, H)
const ctx = canvas.getContext('2d')!
const controls = new Controls(canvas, W, H, { onFullscreen: toggleFullscreen })

// 世界 + 地形（掩体平台）
const world = new World()
world.addTerrain(400, 460, 160, 14)  // 中央平台
world.addTerrain(140, 360, 90, 14)   // 左高台
world.addTerrain(730, 360, 90, 14)   // 右高台
const player = world.addPlayer(220, GROUND_Y)
const enemy = world.addPlayer(740, GROUND_Y)

let playerInput = defaultWorldInput()
let enemyInput = defaultWorldInput()
let playerFuel = JETPACK_FUEL

// UI 按钮（触屏手柄）
document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen)
document.getElementById('btn-jump')?.addEventListener('touchstart', (e) => { e.preventDefault(); controls.pressJump() })
const btnJet = document.getElementById('btn-jet')
btnJet?.addEventListener('touchstart', (e) => { e.preventDefault(); controls.setJetpack(true) })
btnJet?.addEventListener('touchend', () => controls.setJetpack(false))
document.getElementById('btn-reload')?.addEventListener('touchstart', (e) => { e.preventDefault(); controls.pressReload() })

function toIntents(t: ReturnType<Controls['getState']>): Intent[] {
  const out: Intent[] = []
  if (t.moveX > 0.2) out.push({ t: 'move', dir: 1 })
  else if (t.moveX < -0.2) out.push({ t: 'move', dir: -1 })
  out.push({ t: 'aim', angle: t.aimAngle })
  out.push({ t: 'fire', on: t.fire })
  if (t.jump) out.push({ t: 'jump' })
  if (t.jetpack) out.push({ t: 'jetpack', on: true })
  if (t.reload) out.push({ t: 'reload' })
  return out
}

// AI 对手：朝玩家瞄准 + 开火 + 逼近
function aiIntent(): WorldInput {
  const dx = player.pos.x - enemy.pos.x
  const dy = player.pos.y - enemy.pos.y
  const aim = Math.atan2(dy, dx)
  const move: -1 | 0 | 1 = Math.abs(dx) > 180 ? (dx > 0 ? 1 : -1) : 0
  return { move, jump: false, jetpack: false, aim, fire: true }
}

function drawPlayer(p: typeof player, color: string, label: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(p.pos.x, p.pos.y, PLAYER_R, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(p.pos.x, p.pos.y)
  ctx.lineTo(p.pos.x + Math.cos(p.aim) * 32, p.pos.y + Math.sin(p.aim) * 32)
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.fillRect(p.pos.x - 18, p.pos.y - 32, 36, 5)
  ctx.fillStyle = color
  ctx.fillRect(p.pos.x - 18, p.pos.y - 32, 36 * Math.max(0, p.hp) / 100, 5)
  ctx.fillStyle = '#fff'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${label} ${p.hp}`, p.pos.x, p.pos.y - 38)
}

function render(): void {
  vp.applyTransform()
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#10141c'
  ctx.fillRect(0, 0, W, H)
  // 地面
  ctx.fillStyle = '#2a3340'
  ctx.fillRect(WALL_L - 10, GROUND_Y, WALL_R - WALL_L + 20, H - GROUND_Y)
  // 地形
  ctx.fillStyle = '#3a4a5f'
  for (const t of world.terrains) ctx.fillRect(t.x, t.y, t.w, t.h)
  // 弹丸
  ctx.fillStyle = '#ffd166'
  for (const pr of world.projectiles) {
    ctx.beginPath()
    ctx.arc(pr.pos.x, pr.pos.y, pr.r, 0, Math.PI * 2)
    ctx.fill()
  }
  drawPlayer(player, '#4ade80', 'YOU')
  drawPlayer(enemy, '#f87171', 'AI')
  // HUD
  ctx.fillStyle = '#fff'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`你 K/D=${player.kills}/${player.deaths}   AI K/D=${enemy.kills}/${enemy.deaths}   燃料=${playerFuel.toFixed(1)}   tick=${world.tick}`, 12, 20)
}

// 主循环：固定步长（防高速穿透由 core 地形碰撞保证）
let last = performance.now()
let acc = 0
const FIXED = 1 / 60

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  acc += dt
  let guard = 0
  while (acc >= FIXED && guard < 5) {
    const t = controls.getState()
    playerInput = applyIntents(playerInput, toIntents(t))
    enemyInput = aiIntent()
    playerFuel = updateJetpackFuel(playerFuel, playerInput.jetpack, FIXED)
    world.step(FIXED, new Map([[player.id, playerInput], [enemy.id, enemyInput]]))
    controls.consumeMomentary()
    acc -= FIXED
    guard++
  }
  controls.setPlayerScreen(player.pos.x, player.pos.y)
  render()
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
