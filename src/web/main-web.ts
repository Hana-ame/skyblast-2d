// web/main-web.ts —— 浏览器入口：环形大世界（13200×4400 双轴循环）可玩原型
// 合并版：SkyBlast v2 的全部玩法（7 主武器/8 副武器/占点/弹药经济/迫击炮/地雷）
// 跑在骨架的服务器权威结构上：本页内嵌一个 ServerSim（本地单机 = 自己当主机）。
// 联机版下一步：同一套 core 通过 net/transport/Peer.ts 走 PeerJS。
import { World } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput } from '../core/types.ts'
import type { Intent } from '../input/intent.ts'
import { applyIntents, ServerSim } from '../net/ServerSim.ts'
import { setPhysicsParams, getPhysicsParams, resetPhysicsParams } from '../core/sim/physics.ts'
import type { PhysicsParams } from '../core/sim/physics.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist } from '../core/wrap.ts'
import { WEAPONS, SECONDARIES } from '../core/weapons.ts'
import { Controls } from './controls.ts'
import { fitCanvas, toggleFullscreen } from './fullscreen.ts'

const W = 960
const H = 600

const canvas = document.getElementById('game') as HTMLCanvasElement
const vp = fitCanvas(canvas, W, H)
const ctx = canvas.getContext('2d')!
const controls = new Controls(canvas, W, H, { onFullscreen: toggleFullscreen })

const SEED = 20261106
const world = new World(SEED)
world.config.loadoutLock = false   // 原型：随时可换枪（v2 完整规则是重生前锁定）
const server = new ServerSim(world)

const player = world.addPlayer('YOU', 'red')
player.pos = { x: 1700, y: 1750 }
player.weaponIndex = 1

// 两个 AI 对手（浏览器端驱动输入 → 服务器权威模拟）
const bots = [world.addPlayer('AI-1', 'blue'), world.addPlayer('AI-2', 'blue')]
bots[0].pos = { x: 2300, y: 1750 }
bots[1].pos = { x: 1200, y: 2200 }

let playerInput = defaultWorldInput()
const botInputs = new Map<number, WorldInput>()

// ── 键位扩展（骨架 Controls 只给移动/瞄准/开火/喷射/装填；这里补换枪/副武器/E） ──
const weaponKeyMap: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }
let wantSecondary: string | null = null
let wantInteract = false
let wantSwitch: number | null = null
const secOrder = Object.keys(SECONDARIES)
let secIndex = 0
/** 常规可选副武器（排除特殊补给专属；替身人偶只在有充能时进入循环） */
function availableSecondaries(): string[] {
  return secOrder.filter(id => !SECONDARIES[id].supplyOnly || player.dollCharges > 0)
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (weaponKeyMap[k] !== undefined) wantSwitch = weaponKeyMap[k]
  if (k === 'g') { const list = availableSecondaries(); wantSecondary = list[secIndex % list.length] }
  if (k === 't') { const list = availableSecondaries(); secIndex = (secIndex + 1) % list.length }
  if (k === 'e') wantInteract = true
})

// 触屏按钮
for (const id of ['btn-jump', 'btn-jet']) {
  document.getElementById(id)?.addEventListener('touchstart', (e) => { e.preventDefault(); controls.setJetpack(true) })
  document.getElementById(id)?.addEventListener('touchend', () => controls.setJetpack(false))
}
document.getElementById('btn-reload')?.addEventListener('touchstart', (e) => { e.preventDefault(); controls.pressReload() })

function toIntents(t: ReturnType<Controls['getState']>): Intent[] {
  const out: Intent[] = []
  let moveDir: -1 | 0 | 1 = 0
  if (t.moveX > 0.2) moveDir = 1
  else if (t.moveX < -0.2) moveDir = -1
  out.push({ t: 'move', dir: moveDir })
  out.push({ t: 'aim', angle: t.aimAngle })
  out.push({ t: 'fire', on: t.fire })
  out.push({ t: 'jetpack', on: t.jetpack })
  if (t.reload) out.push({ t: 'reload' })
  if (wantInteract) { out.push({ t: 'interact' }); wantInteract = false }
  if (wantSecondary) {
    // 准星目标点 = 沿瞄准方向 240px（空袭/工事用）
    const tx = wrapX(player.pos.x + Math.cos(t.aimAngle) * 240)
    const ty = wrapY(player.pos.y + Math.sin(t.aimAngle) * 240)
    out.push({ t: 'secondary', kind: wantSecondary, targetX: tx, targetY: ty })
    wantSecondary = null
  }
  if (wantSwitch !== null) { out.push({ t: 'switchWeapon', index: wantSwitch }); wantSwitch = null }
  return out
}

// ── AI：朝最近敌人瞄准、保持距离、开火（全部经服务器权威输入） ──
function botInput(bot: typeof player): WorldInput {
  const enemies = [player, ...bots.filter(b => b !== bot)]
  let target = enemies[0]
  let best = Infinity
  for (const e of enemies) {
    if (!e.alive) continue
    const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y)
    if (d < best) { best = d; target = e }
  }
  const dx = wrapDeltaX(bot.pos.x, target.pos.x)
  const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12)
  const aim = Math.atan2(dy, dx)
  let move: -1 | 0 | 1 = 0
  if (Math.abs(dx) > 320) move = dx > 0 ? 1 : -1
  else if (Math.abs(dx) < 160) move = dx > 0 ? -1 : 1
  return {
    ...defaultWorldInput(),
    move, aim, fire: world.tick % 10 < 4,
  }
}

// ── 相机：跟随玩家（环形最短位移），视口中心 ──
const cam = { x: player.pos.x, y: player.pos.y }
function updateCamera(): void {
  const tx = cam.x + wrapDeltaX(cam.x, player.pos.x) * 0.12
  const ty = cam.y + wrapDeltaY(cam.y, player.pos.y) * 0.12
  cam.x = wrapX(tx)
  cam.y = wrapY(ty)
}

/** 环形世界坐标 → 屏幕坐标（跨缝自动走最短位移） */
function screenOf(wx: number, wy: number): { x: number; y: number } {
  const dx = wrapDeltaX(cam.x, wx)
  const dy = wrapDeltaY(cam.y, wy)
  return { x: W / 2 + dx, y: H / 2 + dy }
}

// ── 渲染 ──
function render(): void {
  vp.applyTransform()
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0b0f16'
  ctx.fillRect(0, 0, W, H)

  // 地形图元（跨缝自动最短位移；视口外剔除）
  for (const r of world.terrain.rects) {
    const p = screenOf(r.x + r.w / 2, r.y + r.h / 2)
    const left = p.x - r.w / 2
    const top = p.y - r.h / 2
    if (left > W + 40 || left + r.w < -40 || top > H + 40 || top + r.h < -40) continue
    ctx.fillStyle = r.color
    ctx.fillRect(left, top, r.w, r.h)
    if (r.borderColor) {
      ctx.strokeStyle = r.borderColor
      ctx.lineWidth = 1
      ctx.strokeRect(left + 0.5, top + 0.5, r.w - 1, r.h - 1)
    }
  }

  // 阴影区
  for (const s of world.terrain.shadows) {
    const p = screenOf(s.x + s.w / 2, s.y + s.h / 2)
    if (p.x - s.w / 2 > W || p.x + s.w / 2 < 0 || p.y - s.h / 2 > H || p.y + s.h / 2 < 0) continue
    ctx.fillStyle = `rgba(0,0,0,${s.alpha})`
    ctx.fillRect(p.x - s.w / 2, p.y - s.h / 2, s.w, s.h)
  }

  // 可破坏障碍物（带血条）
  for (const ob of world.obstacles) {
    const p = screenOf(ob.x + ob.w / 2, ob.y + ob.h / 2)
    const left = p.x - ob.w / 2, top = p.y - ob.h / 2
    if (left > W + 40 || left + ob.w < -40 || top > H + 40 || top + ob.h < -40) continue
    ctx.fillStyle = ob.color
    ctx.fillRect(left, top, ob.w, ob.h)
    ctx.strokeStyle = ob.borderColor
    ctx.lineWidth = 2
    ctx.strokeRect(left + 1, top + 1, ob.w - 2, ob.h - 2)
    ctx.fillStyle = '#000'
    ctx.fillRect(left, top - 6, ob.w, 3)
    ctx.fillStyle = '#5ad37a'
    ctx.fillRect(left, top - 6, ob.w * (ob.hp / ob.maxHp), 3)
  }

  // 占点
  for (const cp of world.capturePoints) {
    const p = screenOf(cp.x, cp.y)
    if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue
    const teamColor = cp.ownerTeam === 'red' ? '#f43f5e' : cp.ownerTeam === 'blue' ? '#0ea5e9' : cp.ownerTeam === 'green' ? '#10b981' : cp.ownerTeam === 'ffa' ? '#eab308' : '#94a3b8'
    ctx.strokeStyle = teamColor
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, 55, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,.85)'
    ctx.font = '12px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`🚩${cp.code} ${Math.round(cp.progress)}%`, p.x, p.y - 64)
  }

  // 弹药点 / 补给箱 / 迫击炮 / 地雷 / 手雷 / 空袭
  for (const a of world.ammoPacks) {
    const p = screenOf(a.x, a.y)
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue
    ctx.fillStyle = '#4ade80'
    ctx.fillRect(p.x - 6, p.y - 6, 12, 12)
  }
  for (const c of world.supplyCrates) {
    if (!c.active) continue
    const p = screenOf(c.x, c.y)
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue
    ctx.fillStyle = c.color
    ctx.fillRect(p.x - 9, p.y - 9, 18, 18)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1
    ctx.strokeRect(p.x - 9, p.y - 9, 18, 18)
    if (c.kind === 'doll') {
      ctx.fillStyle = '#fff'
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('🎎', p.x, p.y - 14)
    }
  }
  for (const m of world.mortars) {
    const p = screenOf(m.x, m.y)
    if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue
    ctx.fillStyle = m.operatorId ? '#f97316' : '#64748b'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const m of world.landmines) {
    if (m.respawnTimer > 0) continue
    const p = screenOf(m.pos.x, m.pos.y)
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue
    ctx.fillStyle = m.triggered ? '#ef4444' : m.preset ? '#f59e0b' : '#fb7185'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const g of world.grenades) {
    const p = screenOf(g.pos.x, g.pos.y)
    ctx.fillStyle = '#fbbf24'
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill()
  }
  for (const st of world.airstrikes) {
    const p = screenOf(st.pos.x, st.pos.y)
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, Math.PI * 2); ctx.stroke()
  }

  // 弹道
  for (const pr of world.projectiles) {
    const p = screenOf(pr.pos.x, pr.pos.y)
    if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) continue
    ctx.fillStyle = pr.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, pr.r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 玩家与 AI
  drawPlayer(player, '#4ade80', 'YOU')
  for (const b of bots) drawPlayer(b, '#f87171', b.name)

  // HUD
  const secList = availableSecondaries()
  const curSec = secList[secIndex % secList.length] ?? 'frag'
  const hud = [
    `❤ ${player.hp}/${player.maxHp}   ${WEAPONS[player.weaponIndex].shortName} ${player.ammo[player.weaponIndex]}/${player.reserveAmmo[player.weaponIndex]}   🛡${player.shieldTimer > 0 ? player.shieldHp : '-'}   🎎${player.dollCharges}`,
    `副武器: ${SECONDARIES[curSec].icon} ${SECONDARIES[curSec].name} [T切换 G使用]   🚩 ${world.capturePoints.map(c => `${c.code}:${Math.round(c.progress)}%`).join(' ')}`,
    `比分 R/B/G ${world.scores.red}/${world.scores.blue}/${world.scores.green}   pos=(${player.pos.x.toFixed(0)},${player.pos.y.toFixed(0)})   tick=${world.tick}`,
  ]
  ctx.fillStyle = 'rgba(0,0,0,.45)'
  ctx.fillRect(8, 8, 680, 62)
  ctx.fillStyle = '#e5e7eb'
  ctx.font = '12px monospace'
  ctx.textAlign = 'left'
  hud.forEach((line, i) => ctx.fillText(line, 14, 24 + i * 18))

  // 准星
  const cross = screenOf(player.pos.x + Math.cos(player.aim) * 240, player.pos.y - 12 + Math.sin(player.aim) * 240)
  ctx.strokeStyle = 'rgba(255,255,255,.5)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cross.x - 6, cross.y); ctx.lineTo(cross.x + 6, cross.y)
  ctx.moveTo(cross.x, cross.y - 6); ctx.lineTo(cross.x, cross.y + 6); ctx.stroke()
}

function drawPlayer(p: typeof player, color: string, label: string): void {
  const s = screenOf(p.pos.x, p.pos.y)
  ctx.fillStyle = p.alive ? color : '#475569'
  ctx.fillRect(s.x - 10, s.y - 26, 20, 42)
  ctx.beginPath()
  ctx.arc(s.x, s.y - 24, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(s.x, s.y - 12)
  ctx.lineTo(s.x + Math.cos(p.aim) * 34, s.y - 12 + Math.sin(p.aim) * 34)
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.fillRect(s.x - 18, s.y - 40, 36, 4)
  ctx.fillStyle = p.hp > 50 ? '#5ad37a' : p.hp > 25 ? '#e0b74d' : '#e05a5a'
  ctx.fillRect(s.x - 18, s.y - 40, 36 * Math.max(0, p.hp) / p.maxHp, 4)
  if (p.shieldTimer > 0) {
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(s.x, s.y - 12, 26, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.font = '11px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(`${label} ${p.kills}/${p.deaths}`, s.x, s.y - 46)
}

// ── 主循环：固定步长 60Hz ──
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
    // 相机中心作为瞄准参考系（Controls 用屏幕坐标算 atan2）
    controls.setPlayerScreen(W / 2, H / 2)
    playerInput = applyIntents(playerInput, toIntents(t))
    botInputs.clear()
    for (const b of bots) botInputs.set(b.id, botInput(b))
    const inputs = new Map<number, WorldInput>([[player.id, playerInput], ...botInputs])
    world.step(FIXED, inputs)
    world.drainEvents()
    controls.consumeMomentary()
    acc -= FIXED
    guard++
  }
  updateCamera()
  render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 调试暴露
;(window as unknown as { __dbg: unknown }).__dbg = {
  world, controls, get player() { return player }, get bots() { return bots },
  get camera() { return cam },
  get secIndex() { return secIndex }, get secList() { return availableSecondaries() },
  get pendingSecondary() { return wantSecondary },
}

// 调参暴露（tuning.html 用）
const PARAM_KEY = 'pvp-physics-params'
function persistParams(p: PhysicsParams): void {
  try { localStorage.setItem(PARAM_KEY, JSON.stringify(p)) } catch { /* 忽略 */ }
}
function clearParams(): void {
  try { localStorage.removeItem(PARAM_KEY) } catch { /* 忽略 */ }
}
;(function loadSavedParams() {
  try {
    const raw = localStorage.getItem(PARAM_KEY)
    if (raw) setPhysicsParams(JSON.parse(raw) as Partial<PhysicsParams>)
  } catch { /* 忽略 */ }
})()
;(window as unknown as { __tune: unknown }).__tune = {
  set: (p: Partial<PhysicsParams>) => { const cur = setPhysicsParams(p); persistParams(cur); return cur },
  get: () => getPhysicsParams(),
  reset: () => { const cur = resetPhysicsParams(); clearParams(); return cur },
}