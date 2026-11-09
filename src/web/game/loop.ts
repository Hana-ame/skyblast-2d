// web/game/loop.ts —— 主循环（固定步长推进权威世界 + 渲染 + 死亡界面同步）
import {
  canvas, world, localPlayer, bots, mode, pendingLoadout, keys, mouse, touchState, inputQueue,
  effects, beams, camera, FIXED,
} from '../app/context.ts'
import { updateHudWeaponButtons, updateHudUI, updateScoreboardUI } from '../app/hud.ts'
import { showToast } from '../app/toast.ts'
import { handleEvents, death } from '../app/events.ts'
import { botInput } from './bots.ts'
import { renderScene } from '../render/scene.ts'
import { WEAPONS, SECONDARIES, isSecondaryUnlocked, getHighestUnlockedSecondary } from '../../core/weapons.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput } from '../../core/types.ts'
import { wrapDeltaX, wrapDeltaY, wrapX, wrapY, clamp } from '../../core/wrap.ts'

// ── 主循环 ──
let playerInput: WorldInput = defaultWorldInput()
let prevFireCooldown = 0
let wasDead = false
let lastFrame = performance.now()
let acc = 0

function buildLocalInput(): WorldInput {
  const w = defaultWorldInput()
  const k = keys
  let move: -1 | 0 | 1 = 0
  if (k['KeyA'] || k['ArrowLeft']) move = (move - 1) as -1 | 0 | 1
  if (k['KeyD'] || k['ArrowRight']) move = (move + 1) as -1 | 0 | 1
  if (touchState.moveActive && Math.abs(touchState.moveX) > 0.22) move = touchState.moveX > 0 ? 1 : -1
  w.move = move
  w.jump = false
  w.jetpack = Boolean(k['KeyW'] || k['Space'] || k['ArrowUp'] || touchState.boostButtonDown || (touchState.moveActive && touchState.moveY < -0.35))
  w.dive = Boolean(k['KeyS'] || k['ArrowDown'] || (touchState.moveActive && touchState.moveY > 0.45))

  const zoom = 1 / camera.fovFactor
  const psx = canvas.width / 2 + wrapDeltaX(camera.x, localPlayer.pos.x) * zoom
  const psy = canvas.height / 2 + wrapDeltaY(camera.y, localPlayer.pos.y) * zoom
  mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) / zoom)
  mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) / zoom)

  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  if (mounted) {
    const msx = canvas.width / 2 + wrapDeltaX(camera.x, mounted.x) * zoom
    const msy = canvas.height / 2 + wrapDeltaY(camera.y, mounted.y - 18) * zoom
    let a = Math.atan2(mouse.y - msy, mouse.x - msx)
    if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12
    w.aim = a
  } else if (touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.15) {
    w.aim = Math.atan2(touchState.aimY, touchState.aimX)
  } else {
    w.aim = Math.atan2(mouse.y - (psy - 12 * zoom), mouse.x - psx)
  }
  w.fire = mouse.down || (touchState.aimActive && Math.hypot(touchState.aimX, touchState.aimY) > 0.45)
  w.interact = inputQueue.interact
  w.reload = inputQueue.reload
  if (inputQueue.secondary) w.secondary = { type: inputQueue.secondary.type, targetX: inputQueue.secondary.targetX, targetY: inputQueue.secondary.targetY }
  return w
}

function onLocalDeath(): void {
  // 阵亡：打开死亡界面（唯一可换枪处），默认选中「上次的常规主武器」
  const cur = WEAPONS[localPlayer.weaponIndex]
  const lastIdx = localPlayer.lastPrimaryIndex ?? localPlayer.weaponIndex
  const last = WEAPONS[lastIdx]
  pendingLoadout.weaponIndex = cur && !cur.isSupplyOnly
    ? localPlayer.weaponIndex
    : (last && !last.isSupplyOnly ? lastIdx : 0)
  // 连死阶梯自动解锁并默认预选当前最高阶可用副手（玩家也可在死亡界面手动切换任意已解锁副手）
  const streak = localPlayer.deathStreak ?? 0
  const highestSec = getHighestUnlockedSecondary(streak, localPlayer.dollCharges ?? 0)
  pendingLoadout.secondaryType = highestSec
  localPlayer.secondary = highestSec
  updateHudWeaponButtons()
  const ds = document.getElementById('deathScreen')
  if (ds) { ds.classList.remove('hidden'); ds.classList.add('flex') }
  const secDef = SECONDARIES[highestSec] ?? SECONDARIES.frag
  if (streak > 0 && secDef.unlockStreak > 0) {
    showToast(`💀 连死 ${streak} 次：副手已解锁并预选【${secDef.icon} ${secDef.name}】`)
  } else {
    showToast('💀 已阵亡：在死亡界面选择重生配装')
  }
}

function onLocalRespawn(): void {
  // 出生位置已由权威端决定（死斗=随机安全点）；这里只把待定配装套到已重生的玩家上
  const wantW = Number(pendingLoadout.weaponIndex)
  const next = WEAPONS[wantW] && !WEAPONS[wantW].isSupplyOnly ? wantW : 0
  localPlayer.weaponIndex = next
  localPlayer.lastPrimaryIndex = next
  const streak = localPlayer.deathStreak ?? 0
  const wantSec = pendingLoadout.secondaryType
  const validSec = isSecondaryUnlocked(wantSec, streak, localPlayer.dollCharges ?? 0)
    ? wantSec
    : getHighestUnlockedSecondary(streak, localPlayer.dollCharges ?? 0)
  localPlayer.secondary = validSec
  if (validSec === 'doll' && streak >= SECONDARIES.doll.unlockStreak && localPlayer.dollCharges <= 0) {
    localPlayer.dollCharges = 1
  }
  updateHudWeaponButtons()
  showToast(world.config.randomSpawn ? '🔄 已在随机安全点重生' : '🔄 已在队伍基地重生')
}

export function startGameLoop(): void {
  lastFrame = performance.now()
  requestAnimationFrame(function gameLoop(now: number): void {
    const dt = Math.min(0.05, (now - lastFrame) / 1000)
  lastFrame = now
  acc += dt
  let guard = 0

  while (acc >= FIXED && guard < 5) {
    playerInput = buildLocalInput()
    inputQueue.interact = false
    inputQueue.reload = false
    inputQueue.secondary = null

    const inputs = new Map<number, WorldInput>([[localPlayer.id, playerInput]])
    for (const b of bots) inputs.set(b.id, botInput(b))
    world.step(FIXED, inputs)
    handleEvents(world.drainEvents())

    const dead = localPlayer.respawnTimer > 0
    if (dead && !wasDead) onLocalDeath()
    if (!dead && wasDead) {
      const ds = document.getElementById('deathScreen')
      if (ds) ds.classList.add('hidden')
      onLocalRespawn()
    }
    wasDead = dead
    if (dead) {
      const cd = document.getElementById('deathCountdown')
      if (cd) cd.textContent = Math.max(0, localPlayer.respawnTimer).toFixed(1)
      const kl = document.getElementById('deathKillerLine')
      if (kl) kl.textContent = death.info
        ? `被 ${death.info.killer} 使用【${death.info.weapon}】击倒`
        : '已被击倒 · 请选择重生配装'
      renderDeathStats()
    }

    // 喷气尾焰粒子
    for (const p of world.players) {
      if (p.deployed && p.respawnTimer <= 0 && p.jetpack) {
        effects.jet(p.pos.x, p.pos.y)
      }
    }
    // 玩家开火枪口火花
    if (localPlayer.fireCooldown > prevFireCooldown + 0.01) {
      effects.muzzle(
        wrapX(localPlayer.pos.x + Math.cos(localPlayer.aim) * 26),
        (localPlayer.pos.y - 12) + Math.sin(localPlayer.aim) * 26,
        WEAPONS[localPlayer.weaponIndex]?.color ?? '#fde047',
      )
    }
    prevFireCooldown = localPlayer.fireCooldown
    effects.update(FIXED)
    for (let i = beams.length - 1; i >= 0; i--) {
      beams[i].life -= FIXED
      if (beams[i].life <= 0) beams.splice(i, 1)
    }
    acc -= FIXED
    guard++
  }

  renderScene()
  updateHudUI()
  updateScoreboardUI()
  requestAnimationFrame(gameLoop)
  })
}

/**
 * 阵亡界面的 KD + 排行榜渲染。
 * 数字全部走固定宽度槽位（tabular-nums + 定宽 span），避免位数变化推动布局。
 */
function renderDeathStats(): void {
  const me = localPlayer
  const kills = me.kills ?? 0
  const deaths = me.deaths ?? 0
  const ratio = deaths === 0 ? kills : kills / deaths

  const kEl = document.getElementById('deathKdKills')
  const dEl = document.getElementById('deathKdDeaths')
  const rEl = document.getElementById('deathKdRatio')
  if (kEl) kEl.textContent = String(kills)
  if (dEl) dEl.textContent = String(deaths)
  if (rEl) rEl.textContent = ratio.toFixed(2)

  // 排行榜：按击杀降序，击杀相同按阵亡升序，再按名字稳定排序
  const ranked = [...world.players]
    .filter(p => p.deployed)
    .sort((a, b) => {
      const ka = a.kills ?? 0, kb = b.kills ?? 0
      if (kb !== ka) return kb - ka
      const da = a.deaths ?? 0, db = b.deaths ?? 0
      if (da !== db) return da - db
      return (a.name ?? '').localeCompare(b.name ?? '')
    })

  const list = document.getElementById('deathRankList')
  if (list) {
    const top = ranked.slice(0, 10)
    const myRank = ranked.findIndex(p => p.id === me.id) + 1
    const maxKills = Math.max(1, ...ranked.map(p => p.kills ?? 0))
    list.innerHTML = top.map((p, i) => {
      const isMe = p.id === me.id
      const k = p.kills ?? 0
      const d = p.deaths ?? 0
      const kd = d === 0 ? k.toFixed(2) : (k / d).toFixed(2)
      const pct = Math.max(4, Math.round((k / maxKills) * 100))
      const teamColor = p.team === 'red' ? 'text-rose-300' : p.team === 'blue' ? 'text-sky-300' : 'text-slate-300'
      return `
        <li class="relative flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] ${isMe ? 'bg-sky-500/15 ring-1 ring-sky-400/40' : 'bg-slate-900/50'}">
          <span class="absolute inset-y-0 left-0 rounded-lg bg-sky-400/10" style="width:${pct}%"></span>
          <span class="relative w-4 text-right font-mono font-bold text-slate-400 tabular-nums">${i + 1}</span>
          <span class="relative flex-1 truncate font-bold ${teamColor}">${escapeHudText(p.name ?? '?')}</span>
          <span class="relative w-6 text-right font-mono font-bold text-emerald-300 tabular-nums">${k}</span>
          <span class="relative w-6 text-right font-mono text-slate-400 tabular-nums">${d}</span>
          <span class="relative w-9 text-right font-mono font-bold text-amber-300 tabular-nums">${kd}</span>
        </li>`
    }).join('')

    const selfLine = document.getElementById('deathRankSelfLine')
    const selfBar = document.getElementById('deathRankSelfBar')
    if (selfLine) selfLine.textContent = myRank > 0 ? `你的排名：#${myRank} / ${ranked.length}` : '你的排名 —'
    if (selfBar) selfBar.style.width = ranked.length > 0 ? `${Math.max(4, Math.round(((ranked.length - myRank + 1) / ranked.length) * 100))}%` : '0%'
  }
}

function escapeHudText(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
