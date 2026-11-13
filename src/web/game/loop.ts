// web/game/loop.ts —— 主循环（固定步长推进权威世界 / KCP 联机同步 + 渲染 + 移动端摇杆升空与瞄准优化）
import {
  canvas, world, localPlayer, bots, pendingLoadout, keys, mouse, touchState, inputQueue,
  effects, beams, camera, FIXED,
} from '../app/context.ts'
import { updateHudWeaponButtons, updateSpawnPointButtonsUI, updateHudUI, updateScoreboardUI, updateDebugHudTelemetry, renderDeathMinimap } from '../app/hud.ts'
import { stepNetworkFrame, broadcastHostKcpSnapshot, netState, sendClientLoadoutToHost } from '../app/net.ts'
import { showToast } from '../app/toast.ts'
import { handleEvents, death } from '../app/events.ts'
import { playProceduralSound } from '../app/audio.ts'
import { installDiag, diagRecordFrame, diagMark } from '../app/diag.ts'
import { botInput } from './bots.ts'
import { renderScene } from '../render/scene.ts'
import { WEAPONS, SECONDARIES, isSecondaryUnlocked } from '../../core/weapons.ts'
import { isCapturePointSelectable } from '../../core/sim/world.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput } from '../../core/types.ts'
import { wrapDeltaX, wrapDeltaY, wrapX, wrapY, clamp } from '../../core/wrap.ts'

// ── 主循环 ──
const playerInput: WorldInput = defaultWorldInput()
const sharedSecondaryIntent = { type: 'frag', targetX: 0, targetY: 0 }
const frameInputs = new Map<number, WorldInput>()
let prevFireCooldown = 0
let wasDead = false
let lastFrame = performance.now()
let smoothFps = 60
let acc = FIXED * 0.5
let mobileSniperPulseRelease = false

function buildLocalInput(): WorldInput {
  const w = playerInput
  w.jump = false
  w.jetpack = false
  w.dive = false
  w.fire = false
  w.reload = false
  w.interact = false
  w.switchWeapon = null
  w.secondary = null
  w.trackChargeAim = false

  const k = keys
  let move: -1 | 0 | 1 = 0
  if (k['KeyA'] || k['ArrowLeft']) move = (move - 1) as -1 | 0 | 1
  if (k['KeyD'] || k['ArrowRight']) move = (move + 1) as -1 | 0 | 1
  if (touchState.moveActive && Math.abs(touchState.moveX) > 0.18) {
    move = touchState.moveX > 0 ? 1 : -1
  }
  w.move = move

  const stickAscending = touchState.moveActive && touchState.moveY < -0.26
  const stickJumpTakeoff = stickAscending && !!localPlayer.onGround && !touchState.wasGroundedBeforeAscend
  touchState.wasGroundedBeforeAscend = stickAscending
  w.jump = stickJumpTakeoff
  w.jetpack = Boolean(k['KeyW'] || k['Space'] || k['ArrowUp'] || stickAscending)
  w.dive = Boolean(k['KeyS'] || k['ArrowDown'] || (touchState.moveActive && touchState.moveY > 0.42))

  const zoom = 1 / camera.fovFactor
  const psx = canvas.width / 2 + wrapDeltaX(camera.x, localPlayer.pos.x) * zoom
  const psy = canvas.height / 2 + wrapDeltaY(camera.y, localPlayer.pos.y) * zoom

  let mounted: typeof world.mortars[0] | undefined
  for (let i = 0; i < world.mortars.length; i++) {
    if (world.mortars[i].operatorId === localPlayer.id) {
      mounted = world.mortars[i]
      break
    }
  }
  const aimMag = touchState.aimActive ? Math.hypot(touchState.aimX, touchState.aimY) : 0

  const useTouchAim = touchState.enabled && (touchState.aimActive || touchState.aimUsed)
  if (useTouchAim) {
    if (aimMag > 0.12) {
      touchState.lastAimAngle = Math.atan2(touchState.aimY, touchState.aimX)
    } else if (touchState.moveActive && Math.abs(touchState.moveX) > 0.25 && !touchState.aimActive) {
      touchState.lastAimAngle = touchState.moveX > 0 ? 0 : Math.PI
    }
    let a = touchState.lastAimAngle
    if (mounted) {
      if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12
    }
    w.aim = a
    const aimDist = 260 * Math.max(0.45, Math.min(1.2, aimMag || 0.85))
    mouse.worldX = wrapX(localPlayer.pos.x + Math.cos(w.aim) * aimDist)
    mouse.worldY = wrapY((localPlayer.pos.y - 12) + Math.sin(w.aim) * aimDist)
    mouse.x = canvas.width / 2 + Math.cos(w.aim) * aimDist * zoom
    mouse.y = canvas.height / 2 + Math.sin(w.aim) * aimDist * zoom
  } else {
    mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) / zoom)
    mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) / zoom)
    if (mounted) {
      const msx = canvas.width / 2 + wrapDeltaX(camera.x, mounted.x) * zoom
      const msy = canvas.height / 2 + wrapDeltaY(camera.y, mounted.y - 18) * zoom
      let a = Math.atan2(mouse.y - msy, mouse.x - msx)
      if (a > -0.12) a = a < Math.PI * 0.5 ? -0.12 : -Math.PI + 0.12
      w.aim = a
    } else {
      w.aim = Math.atan2(mouse.y - (psy - 12 * zoom), mouse.x - psx)
    }
  }

  const touchWantsFire = touchState.enabled && touchState.aimActive && aimMag > 0.42
  // 手柄摇杆开火时，狙击枪在 0.5s 读条期间持续追踪当前摇杆拖动方向（0.5s 之后所在位置发射）；键鼠仍锁定按下瞬间方向
  w.trackChargeAim = touchState.enabled && touchState.aimActive
  const wepCur = WEAPONS[localPlayer.weaponIndex]
  if (touchWantsFire && (wepCur?.chargeSeconds ?? 0) > 0) {
    if (localPlayer.chargeTimer <= 0 && localPlayer.fireCooldown <= 0 && localPlayer.prevFireHeld && !mobileSniperPulseRelease) {
      w.fire = false
      mobileSniperPulseRelease = true
    } else {
      w.fire = true
      mobileSniperPulseRelease = false
    }
  } else {
    w.fire = (touchState.enabled ? false : mouse.down) || (touchState.enabled && mouse.down && !touchState.aimActive) || touchWantsFire
    mobileSniperPulseRelease = false
  }

  w.interact = inputQueue.interact
  w.reload = inputQueue.reload
  if (inputQueue.secondary) {
    sharedSecondaryIntent.type = inputQueue.secondary.type
    sharedSecondaryIntent.targetX = inputQueue.secondary.targetX
    sharedSecondaryIntent.targetY = inputQueue.secondary.targetY
    w.secondary = sharedSecondaryIntent
  }
  return w
}

function updateCameraTracking(): void {
  const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0]
  let mounted = false
  for (let i = 0; i < world.mortars.length; i++) {
    if (world.mortars[i].operatorId === localPlayer.id) { mounted = true; break }
  }
  const targetFov = localPlayer.mountedTowerId
    ? 2.0
    : (mounted ? 1.0 : (wep.fovMult || 1.0))
  camera.fovFactor += (targetFov - camera.fovFactor) * 0.12

  if (localPlayer.deployed) {
    const tx = localPlayer.pos.x
    const ty = localPlayer.pos.y - 12
    camera.x = wrapX(camera.x + wrapDeltaX(camera.x, tx) * 0.2)
    camera.y = wrapY(camera.y + wrapDeltaY(camera.y, ty) * 0.2)
  }
}

function onLocalDeath(): void {
  const cur = WEAPONS[localPlayer.weaponIndex]
  const lastIdx = localPlayer.lastPrimaryIndex ?? localPlayer.weaponIndex
  const last = WEAPONS[lastIdx]
  pendingLoadout.weaponIndex = cur && !cur.isSupplyOnly
    ? localPlayer.weaponIndex
    : (last && !last.isSupplyOnly ? lastIdx : 0)
  const streak = localPlayer.deathStreak ?? 0
  if (!isSecondaryUnlocked(pendingLoadout.secondaryType, streak, localPlayer.dollCharges ?? 0, pendingLoadout.weaponIndex)) {
    pendingLoadout.secondaryType = 'frag'
  }
  localPlayer.secondary = pendingLoadout.secondaryType
  updateHudWeaponButtons()
  updateSpawnPointButtonsUI()
  renderDeathStats(true)
  const ds = document.getElementById('deathScreen')
  if (ds) { ds.classList.remove('hidden'); ds.classList.add('flex') }
}

function onLocalRespawn(): void {
  const wantW = Number(pendingLoadout.weaponIndex)
  const next = WEAPONS[wantW] && !WEAPONS[wantW].isSupplyOnly ? wantW : 0
  localPlayer.weaponIndex = next
  localPlayer.lastPrimaryIndex = next
  const streak = localPlayer.deathStreak ?? 0
  const wantSec = pendingLoadout.secondaryType
  const validSec = isSecondaryUnlocked(wantSec, streak, localPlayer.dollCharges ?? 0, next)
    ? wantSec
    : 'frag'
  pendingLoadout.secondaryType = validSec
  localPlayer.secondary = validSec
  if (validSec === 'doll' && streak >= SECONDARIES.doll.unlockStreak && localPlayer.dollCharges <= 0) {
    localPlayer.dollCharges = 1
  }
  localPlayer.selectedSpawnId = pendingLoadout.spawnPointId
  if (netState.role === 'client') {
    sendClientLoadoutToHost(false)
  }
  updateHudWeaponButtons()
  updateSpawnPointButtonsUI()
  const cp = pendingLoadout.spawnPointId !== 'base'
    ? world.capturePoints.find(c => c.id === pendingLoadout.spawnPointId && isCapturePointSelectable(c, localPlayer.team))
    : null
  showToast(cp ? `🔄 已在【${cp.name}】重生` : (localPlayer.team === 'ffa' || world.config.randomSpawn ? '🔄 已在随机安全点重生' : '🔄 已在队伍主基地重生'))
}

export function startGameLoop(): void {
  lastFrame = performance.now()
  acc = FIXED * 0.5
  installDiag()
  function stepLoopTick(now: number, shouldRender: boolean): void {
    const tFrameStart = now
    const rawDt = (now - lastFrame) / 1000
    if (rawDt > 0.001) {
      smoothFps = smoothFps * 0.9 + (1 / rawDt) * 0.1
    }
    lastFrame = now
    // 保持 acc 稳定在半帧余量 (FIXED * 0.5) 附近，彻底消除 VSync 微小抖动引发的 0-Tick 空帧或 2-Tick 跳帧顿挫
    if (shouldRender && rawDt > 0.011 && rawDt < 0.023) {
      acc += FIXED + (FIXED * 0.5 - acc) * 0.2
    } else {
      acc += Math.min(0.05, Math.max(0, rawDt))
    }
    let guard = 0
    const tStepsBegin = performance.now()

    while (acc >= FIXED && guard < 4) {
      const pIn = buildLocalInput()
      inputQueue.interact = false
      inputQueue.reload = false
      inputQueue.secondary = null

      localPlayer.selectedSpawnId = pendingLoadout.spawnPointId

      frameInputs.clear()
      frameInputs.set(localPlayer.id, pIn)
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i]
        frameInputs.set(b.id, botInput(b))
      }

      const handledAsClient = stepNetworkFrame(FIXED, pIn, frameInputs)
      if (!handledAsClient) {
        world.step(FIXED, frameInputs)
        const evs = world.drainEvents()
        handleEvents(evs)
        if (netState.role === 'host') broadcastHostKcpSnapshot(evs)
      }

      if (!handledAsClient && localPlayer.selectedSpawnId && localPlayer.selectedSpawnId !== pendingLoadout.spawnPointId) {
        pendingLoadout.spawnPointId = localPlayer.selectedSpawnId
        updateSpawnPointButtonsUI()
      }

      const dead = localPlayer.respawnTimer > 0
      if (dead && !wasDead) {
        onLocalDeath()
        diagMark('local-death', { tick: world.tick })
      }
      if (!dead && wasDead) {
        const ds = document.getElementById('deathScreen')
        if (ds) ds.classList.add('hidden')
        onLocalRespawn()
        diagMark('local-respawn', { tick: world.tick })
      }
      wasDead = dead
      if (dead) {
        const cd = document.getElementById('deathCountdown')
        if (cd) cd.textContent = Math.max(0, localPlayer.respawnTimer).toFixed(1)
        const respBar = document.getElementById('deathRespawnProgressBar')
        if (respBar) {
          const totalDelay = Math.max(0.1, world.config.respawnDelay ?? 4.0)
          const pct = Math.round(clamp((1 - localPlayer.respawnTimer / totalDelay) * 100, 0, 100))
          respBar.style.width = `${pct}%`
        }
        const streakPill = document.getElementById('deathStreakPill')
        if (streakPill) {
          streakPill.textContent = `连死 ${localPlayer.deathStreak ?? 0}`
        }
        const kl = document.getElementById('deathKillerLine')
        if (kl) kl.textContent = death.info
          ? `${death.info.killer} · ${death.info.weapon}`
          : ''
        if (world.tick % 6 === 0) renderDeathStats(false)
      }

      for (let i = 0; i < world.players.length; i++) {
        const p = world.players[i]
        if (p.deployed && p.respawnTimer <= 0 && p.jetpack) {
          effects.jet(p.pos.x, p.pos.y)
        }
      }
      if (localPlayer.fireCooldown > prevFireCooldown + 0.01) {
        playProceduralSound('shoot', localPlayer.weaponIndex === 2 ? 0.72 : localPlayer.weaponIndex === 8 ? 1.35 : 1.0)
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
      updateCameraTracking()
      acc -= FIXED
      guard++
    }

    if (shouldRender) {
      const tRender = performance.now()
      const stepMs = tRender - tStepsBegin
      renderScene()
      const tHud = performance.now()
      updateHudUI()
      updateScoreboardUI()
      updateDebugHudTelemetry(smoothFps)
      const tEnd = performance.now()
      diagRecordFrame(tFrameStart, {
        steps: guard, stepMs, renderMs: tHud - tRender, hudMs: tEnd - tHud,
      }, { world, localPlayer, camera, netState, canvas })
    } else {
      diagRecordFrame(tFrameStart, {
        steps: guard, stepMs: performance.now() - tStepsBegin, renderMs: 0, hudMs: 0,
      }, { world, localPlayer, camera, netState, canvas })
    }
  }
  requestAnimationFrame(function gameLoop(now: number): void {
    stepLoopTick(now, true)
    requestAnimationFrame(gameLoop)
  })
  window.setInterval(() => {
    const now = performance.now()
    if (document.hidden || (now - lastFrame > 120 && netState.role !== 'offline')) {
      // 记录保活接管：真机上如果频繁出现这条标记，说明 rAF 被长时间挂起，
      // 而 keepalive 与 rAF 的交替接管本身会放大顿挫（两个时钟争抢同一条推进路径）。
      diagMark('keepalive-takeover', {
        sinceLastFrameMs: Math.round(now - lastFrame),
        hidden: typeof document !== 'undefined' && document.hidden ? 1 : 0,
        role: netState.role,
      })
      stepLoopTick(now, false)
    }
  }, 32)
}

/**
 * 阵亡界面的 KD + 排行榜渲染。
 * 数字全部走固定宽度槽位（tabular-nums + 定宽 span），避免位数变化推动布局。
 */
let lastDeathRankSig = ''
function renderDeathStats(skipMinimap = false): void {
  if (!skipMinimap) renderDeathMinimap()
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

  const ranked = [...world.players]
    .filter(p => p.deployed || p.id === me.id)
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
    const rankSig = `${me.id}:${kills}:${deaths}:` + top.map(p => `${p.id}:${p.kills ?? 0}:${p.deaths ?? 0}:${p.respawnTimer > 0 || !p.alive ? 0 : 1}:${p.team}:${p.name}`).join('|')
    if (rankSig !== lastDeathRankSig) {
      lastDeathRankSig = rankSig
      list.innerHTML = top.map((p, i) => {
      const isMe = p.id === me.id
      const k = p.kills ?? 0
      const d = p.deaths ?? 0
      const kd = d === 0 ? k.toFixed(2) : (k / d).toFixed(2)
      const pct = Math.max(4, Math.round((k / maxKills) * 100))
      const teamColor = p.team === 'red' ? 'text-rose-300' : p.team === 'blue' ? 'text-sky-300' : 'text-amber-200'
      const aliveDot = p.respawnTimer > 0 || !p.alive ? '💀' : '🟢'
      return `
        <li class="relative flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] ${isMe ? 'bg-sky-500/20 ring-1 ring-sky-400/50' : 'bg-slate-900/60'}">
          <span class="absolute inset-y-0 left-0 rounded-lg bg-sky-400/10" style="width:${pct}%"></span>
          <span class="relative w-4 text-right font-mono font-bold text-slate-400 tabular-nums">${i + 1}</span>
          <span class="relative text-[9px]">${aliveDot}</span>
          <span class="relative flex-1 truncate font-bold ${teamColor}">${escapeHudText(p.name ?? '?')}${isMe ? ' (你)' : ''}</span>
          <span class="relative w-6 text-right font-mono font-bold text-emerald-300 tabular-nums">${k}</span>
          <span class="relative w-6 text-right font-mono text-rose-300 tabular-nums">${d}</span>
          <span class="relative w-9 text-right font-mono font-bold text-amber-300 tabular-nums">${kd}</span>
        </li>`
      }).join('')
    }

    const selfLine = document.getElementById('deathRankSelfLine')
    const selfBar = document.getElementById('deathRankSelfBar')
    if (selfLine) selfLine.textContent = myRank > 0 ? `#${myRank}/${ranked.length} · K/D ${ratio.toFixed(2)}` : '—'
    if (selfBar) selfBar.style.width = ranked.length > 0 ? `${Math.max(6, Math.round(((ranked.length - myRank + 1) / ranked.length) * 100))}%` : '0%'
  }
}

function escapeHudText(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
