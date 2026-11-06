// web/main-web.ts —— 浏览器入口：SkyBlast 2D 完整版 UI（v2 界面全量移植）
// 大厅（队伍/重生点/主副武器按钮组/AI 数量）· 双摇杆触屏 · killfeed · 参数调校台 · v2 世界渲染
// 全部跑在新 core 的服务器权威上：本页内嵌权威世界（本地单机 = 自己当主机），输入经意图流。
import {
  canvas, ctx, camera, screenFx, resizeCanvas, world, localPlayer,
  botNames, botTeams, botSecs, bots, pendingLoadout, mode,
  keys, mouse, touchState, inputQueue, effects, beams, worldStars, worldGlows, FIXED, JUMP_PADS,
} from './app/context.ts'
import { showToast, addKillFeed } from './app/toast.ts'
import {
  updateHudUI, updateHudWeaponButtons, updateSpawnPointButtonsUI,
  tryChangePrimaryWeapon, tryChangeSecondaryWeapon, updateScoreboardUI, updateTeamCountUI,
} from './app/hud.ts'
import { renderScene } from './render.ts'
import { handleEvents, death } from './app/events.ts'

import { World } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput, WorldEvent, TeamId, PlayerState } from '../core/types.ts'
import { setPhysicsParams, getPhysicsParams, resetPhysicsParams } from '../core/sim/physics.ts'
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../core/wrap.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG } from '../core/weapons.ts'
import { SPAWN_POINTS } from '../core/sim/world.ts'
import { getTerrainPattern, makeStarField, syncTerrainPatterns } from './textures.ts'
import {
  drawPlayerSprite, drawPlayerTag, drawObstacleSprite, drawCrateSprite, drawAmmoSprite,
  drawMortarSprite, drawTowerSprite, drawWarpSprite, drawFlagSprite, drawMineSprite,
  drawGrenadeSprite, drawAirstrikeSprite, drawProjectileSprite, drawDeco, drawJumpPad, TEAM_PALETTE,
} from './sprites.ts'
import { Effects } from './effects.ts'

function syncBotsCount(target: number): void {
  while (bots.length > target) {
    const b = bots.pop()!
    world.players = world.players.filter(p => p.id !== b.id)
  }
  while (bots.length < target) {
    const idx = bots.length
    let team: TeamId
    if (mode.current === 'ffa') {
      team = 'ffa'
    } else {
      // 2 队对抗：红蓝均衡（玩家所在队伍优先补对手）
      team = idx % 2 === 0 ? 'red' : 'blue'
      if (team === localPlayer.team) team = team === 'red' ? 'blue' : 'red'
    }
    const b = world.addPlayer(botNames[idx % botNames.length], team)
    b.weaponIndex = idx % 4
    b.secondary = botSecs[idx % botSecs.length]
    const cp = world.capturePoints[idx % world.capturePoints.length]
    b.pos = { x: wrapX(cp.x + (idx - 4) * 47), y: cp.y - 50 }
    bots.push(b)
  }
  // 模式变更时同步既有 bot 队伍：FFA 全员混战；2 队按红蓝均衡（避开玩家队伍）
  bots.forEach((b, idx) => {
    if (mode.current === 'ffa') {
      b.team = 'ffa'
    } else {
      let team: TeamId = idx % 2 === 0 ? 'red' : 'blue'
      if (team === localPlayer.team) team = team === 'red' ? 'blue' : 'red'
      b.team = team
    }
  })
  updateTeamCountUI()
}

function updateInputModeBadge(isTouchMode: boolean, isAuto: boolean): void {
  const badge = document.getElementById('inputDeviceDetectBadge')
  if (!badge) return
  const prefix = isAuto ? '已自动识别' : '已手动切换'
  if (isTouchMode) {
    badge.textContent = `📱 ${prefix}：手机/平板触屏模式 (点击可切键鼠)`
    badge.className = 'px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35 transition'
  } else {
    badge.textContent = `💻 ${prefix}：PC 键鼠操控模式 (点击可切触屏)`
    badge.className = 'px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition'
  }
}

function setTouchLayerVisible(visible: boolean, isAuto = false): void {
  touchState.enabled = visible
  const layer = document.getElementById('touchControlsLayer')
  if (layer) layer.classList.toggle('hidden', !visible)
  updateInputModeBadge(visible, isAuto)
}

function autoDetectDeviceInput(): void {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  const touchPoints = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  setTouchLayerVisible(Boolean(coarse || (touchPoints && window.innerWidth <= 1024)), true)
}

// ── 参数调校台 ──
let selectedParamWeaponIdx = 0

function syncParamsToUI(): void {
  const setVal = (inId: string, vId: string, val: number | string, suf = ''): void => {
    const iEl = document.getElementById(inId) as HTMLInputElement | null
    const vEl = document.getElementById(vId)
    if (iEl) iEl.value = String(val)
    if (vEl) vEl.textContent = val + suf
  }
  const P = getPhysicsParams()
  setVal('paramGravity', 'valGravity', P.gravity)
  setVal('paramMoveSpeed', 'valMoveSpeed', P.moveSpeed)
  setVal('paramJetpackAccel', 'valJetpackAccel', P.jetpackAccel)
  setVal('paramJetpackMaxUp', 'valJetpackMaxUp', P.jetpackMaxUp)
  setVal('paramMaxHp', 'valMaxHp', world.config.maxHp)
  setVal('paramHeadRadius', 'valHeadRadius', world.config.headRadius)

  const w = WEAPONS[selectedParamWeaponIdx] ?? WEAPONS[0]
  setVal('paramWepDamage', 'valWepDamage', w.damage)
  setVal('paramWepHeadshot', 'valWepHeadshot', w.headshotMult, 'x')
  setVal('paramWepSpeed', 'valWepSpeed', w.speed)
  setVal('paramWepMag', 'valWepMag', w.magSize)
  setVal('paramWepReload', 'valWepReload', w.reloadTime, 's')

  setVal('paramGrenadeDmg', 'valGrenadeDmg', world.config.grenadeDamage)
  setVal('paramGrenadeRadius', 'valGrenadeRadius', world.config.grenadeRadius)
  setVal('paramMineDmg', 'valMineDmg', world.config.mineDamage)
  setVal('paramMineRadius', 'valMineRadius', world.config.mineTriggerRadius)
  setVal('paramMortarDmg', 'valMortarDmg', world.config.mortarDamage)
  setVal('paramMortarRadius', 'valMortarRadius', world.config.mortarRadius)
  setVal('paramRespawnDelay', 'valRespawnDelay', world.config.respawnDelay, 's')
  setVal('paramDollMax', 'valDollMax', world.config.dollMaxCharges)

  document.querySelectorAll('.param-wep-tab').forEach((btn) => {
    const idx = Number(btn.getAttribute('data-pwep') || 0)
    btn.className = idx === selectedParamWeaponIdx
      ? 'param-wep-tab px-2 py-1 rounded bg-amber-500 text-slate-950 font-extrabold text-[11px]'
      : 'param-wep-tab px-2 py-1 rounded bg-slate-950 text-slate-300 font-semibold text-[11px] border border-slate-700'
  })
}

function bindRangeParam(inputId: string, valId: string, suffix: string, applyFn: (v: number) => void): void {
  const el = document.getElementById(inputId) as HTMLInputElement | null
  if (!el) return
  el.addEventListener('input', () => {
    const v = Number(el.value)
    const vEl = document.getElementById(valId)
    if (vEl) vEl.textContent = v + suffix
    applyFn(v)
  })
}

// ── 事件绑定 ──
function bindAllEvents(): void {
  window.addEventListener('resize', resizeCanvas)
  resizeCanvas()

  window.addEventListener('keydown', (e) => {
    const active = document.activeElement
    if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return
    keys[e.code] = true
    if (e.code === 'KeyR') inputQueue.reload = true
    else if (e.code === 'KeyG' || e.code === 'KeyQ') inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
    else if (e.code === 'KeyE') inputQueue.interact = true
    else if (e.code === 'Digit1') tryChangePrimaryWeapon(0)
    else if (e.code === 'Digit2') tryChangePrimaryWeapon(1)
    else if (e.code === 'Digit3') tryChangePrimaryWeapon(2)
    else if (e.code === 'Digit4') tryChangePrimaryWeapon(3)
    else if (e.code === 'Digit5') tryChangePrimaryWeapon(7)
  })
  window.addEventListener('keyup', (e) => { keys[e.code] = false })

  canvas?.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect()
    mouse.x = e.clientX - rect.left
    mouse.y = e.clientY - rect.top
  })
  canvas?.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.down = true
    else if (e.button === 2) inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  canvas?.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false })
  canvas?.addEventListener('contextmenu', (e) => e.preventDefault())

  document.querySelectorAll('.lobby-wep-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangePrimaryWeapon(Number(btn.getAttribute('data-wep') || 0))))
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')))
  // 死亡界面：唯一的换枪入口
  document.querySelectorAll('.death-wep-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      tryChangePrimaryWeapon(Number(btn.getAttribute('data-wep') || 0))
      updateHudWeaponButtons()
    }))
  document.querySelectorAll('.death-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')
      updateHudWeaponButtons()
    }))

  document.querySelectorAll('.spawn-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spId = btn.getAttribute('data-spawn') || 'base'
      if (spId !== 'base') {
        const cp = world.capturePoints.find(c => c.id === spId)
        if (!cp || (cp.ownerTeam !== localPlayer.team && localPlayer.team !== 'ffa')) {
          showToast('⚠️ 该占领点尚未被我方队伍占领，暂不可作为重生点！')
          return
        }
      }
      pendingLoadout.spawnPointId = spId
      updateSpawnPointButtonsUI()
    })
  })

  document.querySelectorAll('.bot-count-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cnt = Number(btn.getAttribute('data-bots') || 0)
      syncBotsCount(cnt)
      document.querySelectorAll('.bot-count-btn').forEach((b) => {
        b.className = Number(b.getAttribute('data-bots')) === cnt
          ? 'bot-count-btn px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-extrabold text-xs'
          : 'bot-count-btn px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 font-semibold text-xs border border-slate-700'
      })
    })
  })

  document.querySelectorAll('.param-wep-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedParamWeaponIdx = Number(btn.getAttribute('data-pwep') || 0)
      syncParamsToUI()
    })
  })

  document.getElementById('hudReloadBtn')?.addEventListener('click', () => { inputQueue.reload = true })
  document.getElementById('hudGrenadeBtn')?.addEventListener('click', () => {
    inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('hudQuickMortarBtn')?.addEventListener('click', () => { inputQueue.interact = true })
  document.getElementById('interactBannerBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
      const lobby = document.getElementById('lobbyModal')
      lobby?.classList.remove('hidden')
      lobby?.classList.add('flex')
      updateSpawnPointButtonsUI()
    } else inputQueue.interact = true
  })

  // ── 对战模式按钮组：自由混战 / 双队对抗 ──
  function applyTeamButtons(): void {
    document.querySelectorAll('.team-select-btn').forEach((b) => {
      const t = b.getAttribute('data-team')
      const enabled = mode.current === '2teams' ? (t === 'red' || t === 'blue') : (t === 'ffa')
      const sel = t === localPlayer.team
      ;(b as HTMLButtonElement).disabled = !enabled
      b.className = 'team-select-btn px-3 py-2 rounded-xl text-left transition flex items-center justify-between ' +
        (sel ? 'border-2 border-indigo-400 bg-indigo-500/20 ' : 'border border-slate-700 bg-slate-950/60 ') +
        (enabled ? '' : 'opacity-40 cursor-not-allowed')
    })
  }
  function applyMode(nextMode: 'ffa' | '2teams'): void {
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast('⚠️ 切换对战模式需在待机/阵亡整备时进行')
      return
    }
    mode.current = nextMode
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const sel = b.getAttribute('data-mode') === nextMode
      b.className = 'mode-btn px-3 py-2 rounded-xl text-left transition border ' +
        (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
    })
    // FFA：全员混战；2 队：默认红队（可再点蓝）
    if (nextMode === 'ffa') localPlayer.team = 'ffa'
    else if (localPlayer.team !== 'blue') localPlayer.team = 'red'
    syncBotsCount(bots.length)
    applyTeamButtons()
    updateTeamCountUI()
    showToast(nextMode === 'ffa'
      ? '🟡 自由混战：全员皆敌，随机出生点'
      : '⚔️ 双队对抗（红队 vs 蓝队）：随机出生点')
  }
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => applyMode((b.getAttribute('data-mode') || 'ffa') as 'ffa' | '2teams'))
  })

  document.querySelectorAll('.team-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ((btn as HTMLButtonElement).disabled) return
      const chosen = (btn.getAttribute('data-team') || 'red') as TeamId
      localPlayer.team = chosen
      applyTeamButtons()
      updateTeamCountUI()
      updateSpawnPointButtonsUI()
    })
  })

  document.getElementById('playerNameInput')?.addEventListener('input', (e) => {
    localPlayer.name = (e.target as HTMLInputElement).value.trim() || 'SkyHunter'
  })

  const lobbyModal = document.getElementById('lobbyModal')
  document.getElementById('openLobbyBtn')?.addEventListener('click', () => {
    lobbyModal?.classList.remove('hidden')
    lobbyModal?.classList.add('flex')
    updateSpawnPointButtonsUI()
  })
  document.getElementById('startBattleBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) applyPendingLoadoutAndSpawn()
    lobbyModal?.classList.add('hidden')
    lobbyModal?.classList.remove('flex')
  })
  document.getElementById('inputDeviceDetectBadge')?.addEventListener('click', () => setTouchLayerVisible(!touchState.enabled, false))
  document.getElementById('toggleTouchBtn')?.addEventListener('click', () => setTouchLayerVisible(!touchState.enabled, false))
  document.getElementById('resetTerrainBtn')?.addEventListener('click', () => {
    world.resetMatch()
    showToast('全图可破坏障碍物、地雷与弹药补给已全部重置')
  })

  const paramsModal = document.getElementById('paramsModal')
  const openParams = (): void => {
    paramsModal?.classList.remove('hidden')
    paramsModal?.classList.add('flex')
    syncParamsToUI()
  }
  const closeParams = (): void => {
    paramsModal?.classList.add('hidden')
    paramsModal?.classList.remove('flex')
  }
  document.getElementById('openParamsBtn')?.addEventListener('click', openParams)
  document.getElementById('lobbyOpenParamsBtn')?.addEventListener('click', openParams)
  document.getElementById('closeParamsBtn')?.addEventListener('click', closeParams)
  document.getElementById('resetParamsBtn')?.addEventListener('click', () => {
    resetPhysicsParams()
    world.config = { ...DEFAULT_CONFIG }
    syncParamsToUI()
    showToast('已恢复默认参数')
  })

  bindRangeParam('paramGravity', 'valGravity', '', (v) => setPhysicsParams({ gravity: v }))
  bindRangeParam('paramMoveSpeed', 'valMoveSpeed', '', (v) => setPhysicsParams({ moveSpeed: v }))
  bindRangeParam('paramJetpackAccel', 'valJetpackAccel', '', (v) => setPhysicsParams({ jetpackAccel: v }))
  bindRangeParam('paramJetpackMaxUp', 'valJetpackMaxUp', '', (v) => setPhysicsParams({ jetpackMaxUp: v }))
  bindRangeParam('paramMaxHp', 'valMaxHp', '', (v) => {
    world.config.maxHp = v
    for (const p of world.players) { p.maxHp = v; if (p.hp > v) p.hp = v }
  })
  bindRangeParam('paramHeadRadius', 'valHeadRadius', '', (v) => { world.config.headRadius = v })
  bindRangeParam('paramWepDamage', 'valWepDamage', '', (v) => { WEAPONS[selectedParamWeaponIdx].damage = v })
  bindRangeParam('paramWepHeadshot', 'valWepHeadshot', 'x', (v) => { WEAPONS[selectedParamWeaponIdx].headshotMult = v })
  bindRangeParam('paramWepSpeed', 'valWepSpeed', '', (v) => { WEAPONS[selectedParamWeaponIdx].speed = v })
  bindRangeParam('paramWepMag', 'valWepMag', '', (v) => { WEAPONS[selectedParamWeaponIdx].magSize = v })
  bindRangeParam('paramWepReload', 'valWepReload', 's', (v) => { WEAPONS[selectedParamWeaponIdx].reloadTime = v })
  bindRangeParam('paramGrenadeDmg', 'valGrenadeDmg', '', (v) => { world.config.grenadeDamage = v })
  bindRangeParam('paramGrenadeRadius', 'valGrenadeRadius', '', (v) => { world.config.grenadeRadius = v })
  bindRangeParam('paramMineDmg', 'valMineDmg', '', (v) => { world.config.mineDamage = v })
  bindRangeParam('paramMineRadius', 'valMineRadius', '', (v) => { world.config.mineTriggerRadius = v })
  bindRangeParam('paramMortarDmg', 'valMortarDmg', '', (v) => { world.config.mortarDamage = v })
  bindRangeParam('paramMortarRadius', 'valMortarRadius', '', (v) => { world.config.mortarRadius = v })
  bindRangeParam('paramRespawnDelay', 'valRespawnDelay', 's', (v) => { world.config.respawnDelay = v })
  bindRangeParam('paramDollMax', 'valDollMax', '', (v) => { world.config.dollMaxCharges = v })

  // 触屏双摇杆
  function bindJoystick(zoneEl: HTMLElement | null, stickEl: HTMLElement | null, isAim: boolean): void {
    if (!zoneEl || !stickEl) return
    const maxDist = 46
    const handleMove = (clientX: number, clientY: number): void => {
      const rect = zoneEl.getBoundingClientRect()
      let dx = clientX - (rect.left + rect.width / 2)
      let dy = clientY - (rect.top + rect.height / 2)
      const dist = Math.hypot(dx, dy)
      if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`
      if (isAim) { touchState.aimX = dx / maxDist; touchState.aimY = dy / maxDist }
      else { touchState.moveX = dx / maxDist; touchState.moveY = dy / maxDist }
    }
    zoneEl.addEventListener('touchstart', (e) => {
      e.preventDefault()
      if (!touchState.enabled) setTouchLayerVisible(true, true)
      const t = e.changedTouches[0]
      if (isAim) { touchState.aimActive = true; touchState.aimId = t.identifier }
      else { touchState.moveActive = true; touchState.moveId = t.identifier }
      handleMove(t.clientX, t.clientY)
    }, { passive: false })
    zoneEl.addEventListener('touchmove', (e) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        if ((isAim && t.identifier === touchState.aimId) || (!isAim && t.identifier === touchState.moveId)) handleMove(t.clientX, t.clientY)
      }
    }, { passive: false })
    const endTouch = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (isAim && t.identifier === touchState.aimId) {
          touchState.aimActive = false; touchState.aimX = 0; touchState.aimY = 0
          stickEl.style.transform = 'translate(0px, 0px)'
        } else if (!isAim && t.identifier === touchState.moveId) {
          touchState.moveActive = false; touchState.moveX = 0; touchState.moveY = 0
          stickEl.style.transform = 'translate(0px, 0px)'
        }
      }
    }
    zoneEl.addEventListener('touchend', endTouch)
    zoneEl.addEventListener('touchcancel', endTouch)
  }
  bindJoystick(document.getElementById('touchMoveZone'), document.getElementById('touchMoveStick'), false)
  bindJoystick(document.getElementById('touchAimZone'), document.getElementById('touchAimStick'), true)

  // 初始化死斗模式 UI（默认 FFA）
  applyTeamButtons()
  document.querySelectorAll('.mode-btn').forEach((b) => {
    const sel = b.getAttribute('data-mode') === mode.current
    b.className = 'mode-btn px-3 py-2 rounded-xl text-left transition border ' +
      (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
  })

  const boostBtn = document.getElementById('touchBoostBtn')
  boostBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); touchState.boostButtonDown = true }, { passive: false })
  boostBtn?.addEventListener('touchend', () => { touchState.boostButtonDown = false })
  document.getElementById('touchGrenadeBtn')?.addEventListener('click', () => {
    inputQueue.secondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('touchReloadBtn')?.addEventListener('click', () => { inputQueue.reload = true })
  document.getElementById('touchInteractBtn')?.addEventListener('click', () => { inputQueue.interact = true })
}

// ── AI 输入（服务器权威） ──
/** 目标选择：只选不同队伍（ffa 除外）——修复"AI 打同队队友" */
function pickBotTarget(bot: PlayerState): PlayerState | null {
  const enemies = [localPlayer, ...bots.filter(b => b !== bot)].filter(e =>
    e.deployed && e.alive && e.respawnTimer <= 0 && (bot.team === 'ffa' || e.team !== bot.team))
  let target: PlayerState | null = null
  let best = Infinity
  for (const e of enemies) {
    const d = wrapDist(bot.pos.x, bot.pos.y, e.pos.x, e.pos.y)
    if (d < best) { best = d; target = e }
  }
  return target
}

function botInput(bot: PlayerState): WorldInput {
  const w = defaultWorldInput()
  const target = pickBotTarget(bot)
  if (!target) return w
  const dx = wrapDeltaX(bot.pos.x, target.pos.x)
  const dy = wrapDeltaY(bot.pos.y - 12, target.pos.y - 12)
  w.aim = Math.atan2(dy, dx)
  if (Math.abs(dx) > 340) w.move = dx > 0 ? 1 : -1
  else if (Math.abs(dx) < 150) w.move = dx > 0 ? -1 : 1
  w.fire = world.tick % 12 < 5 && Math.abs(dx) < 900
  w.jetpack = target.pos.y + 80 < bot.pos.y
  return w
}

// ── 待部署配装 ──
function getSpawnCoords(): { x: number; y: number; label: string } {
  const sp = SPAWN_POINTS.find(s => s.team === localPlayer.team) ?? SPAWN_POINTS[3]
  return { x: sp.x, y: sp.y, label: '队伍主基地' }
}

function applyPendingLoadoutAndSpawn(): void {
  const want = Number(pendingLoadout.weaponIndex)
  const wIdx = WEAPONS[want] && !WEAPONS[want].isSupplyOnly ? want : 0
  localPlayer.weaponIndex = wIdx
  localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : 'frag'
  localPlayer.deployed = true
  localPlayer.alive = true
  world.deploy(localPlayer)
  updateHudWeaponButtons()
  const spLabel = world.config.randomSpawn ? '随机安全点' : '队伍主基地'
  showToast(`⚡ 已在【${spLabel}】部署！配装已锁定：${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`)
}

// ── 主循环 ──
let playerInput: WorldInput = defaultWorldInput()
let prevFireCooldown = 0
let lastFrame = performance.now()
let acc = 0
let wasDead = false

function buildLocalInput(): WorldInput {
  const w = defaultWorldInput()
  if (!localPlayer.deployed) return w
  if (localPlayer.respawnTimer > 0) {
    // 阵亡等待期：仍可操作大厅（不产生战斗输入）
    if (inputQueue.interact) { inputQueue.interact = false; return w }
    return w
  }
  const left = !!(keys['KeyA'] || keys['ArrowLeft'])
  const right = !!(keys['KeyD'] || keys['ArrowRight'])
  let move: -1 | 0 | 1 = left === right ? 0 : (left ? -1 : 1)
  if (touchState.moveActive && Math.abs(touchState.moveX) > 0.18) move = touchState.moveX > 0 ? 1 : -1
  w.move = localPlayer.mountedTowerId ? 0 : move
  w.jetpack = !!(keys['KeyW'] || keys['Space'] || keys['ArrowUp']) || touchState.boostButtonDown || (touchState.moveActive && touchState.moveY < -0.32)
  // 下降加速：S / ↓ / 左摇杆下推；水平仍为零惯性（松手即停）
  w.dive = !!(keys['KeyS'] || keys['ArrowDown']) || (touchState.moveActive && touchState.moveY > 0.45)

  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  // 屏幕空间瞄准：玩家在屏幕上的位置 = 画布中心 + 绕行最短位移×缩放；
  // 角度直接用「鼠标像素 - 玩家像素」算，避免相机跟随 aim 造成的反馈回路（此前的"鼠标瞄不准"根因）。
  const zoom = 1 / camera.fovFactor
  const psx = canvas.width / 2 + wrapDeltaX(camera.x, localPlayer.pos.x) * zoom
  const psy = canvas.height / 2 + wrapDeltaY(camera.y, localPlayer.pos.y) * zoom
  if (mounted) {
    w.aim = Math.atan2(mouse.y - psy, mouse.x - psx)
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
  // 阵亡：打开死亡界面（唯一可换枪处），当前配装作为默认选中
  pendingLoadout.weaponIndex = WEAPONS[localPlayer.weaponIndex] && !WEAPONS[localPlayer.weaponIndex].isSupplyOnly
    ? localPlayer.weaponIndex : 0
  pendingLoadout.secondaryType = localPlayer.secondary === 'doll' ? 'frag' : localPlayer.secondary
  updateHudWeaponButtons()
  const ds = document.getElementById('deathScreen')
  if (ds) ds.classList.remove('hidden')
  showToast('💀 已阵亡：在死亡界面选择重生配装')
}

function onLocalRespawn(): void {
  // 出生位置已由权威端决定（死斗=随机安全点）；这里只把待定配装套到已重生的玩家上
  const wantW = Number(pendingLoadout.weaponIndex)
  localPlayer.weaponIndex = WEAPONS[wantW] && !WEAPONS[wantW].isSupplyOnly ? wantW : 0
  localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : 'frag'
  updateHudWeaponButtons()
  showToast(world.config.randomSpawn ? '🔄 已在随机安全点重生' : '🔄 已在队伍基地重生')
}

function gameLoop(now: number): void {
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
    if (!dead && wasDead) onLocalRespawn()
    wasDead = dead
    // 死亡界面：显示/隐藏 + 倒计时 + 击杀者
    const deathEl = document.getElementById('deathScreen')
    if (deathEl) {
      deathEl.classList.toggle('hidden', !dead)
      deathEl.classList.toggle('flex', dead)
      if (dead) {
        const cd = document.getElementById('deathCountdown')
        if (cd) cd.textContent = localPlayer.respawnTimer.toFixed(1)
        const kl = document.getElementById('deathKillerLine')
        if (kl) kl.textContent = death.info
          ? `被 ${death.info.killer}${death.info.weapon ? ` 的 ${death.info.weapon}` : ''} 击杀`
          : '等待重生…'
      }
    }

    // 表现层：粒子/光束寿命 + 喷气尾焰 + 枪口火焰
    effects.update(FIXED)
    for (let i = beams.length - 1; i >= 0; i--) {
      beams[i].life -= FIXED
      if (beams[i].life <= 0) beams.splice(i, 1)
    }
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      if (localPlayer.jetpack) {
        const back = Math.cos(localPlayer.aim) >= 0 ? -1 : 1
        effects.jet(localPlayer.pos.x + back * 14, localPlayer.pos.y + 6)
      }
      // fireCooldown 被重新点满 → 视为开火，喷枪口火焰
      if (localPlayer.fireCooldown > prevFireCooldown + 0.01) {
        const w = WEAPONS[localPlayer.weaponIndex]
        effects.muzzle(
          localPlayer.pos.x + Math.cos(localPlayer.aim) * 26,
          localPlayer.pos.y - 12 + Math.sin(localPlayer.aim) * 26,
          w?.color ?? '#fbbf24',
        )
      }
    }
    prevFireCooldown = localPlayer.fireCooldown

    acc -= FIXED
    guard++
  }

  // 鼠标世界坐标（屏幕中心 = 相机）
  mouse.worldX = wrapX(camera.x + (mouse.x - canvas.width / 2) * camera.fovFactor)
  mouse.worldY = wrapY(camera.y + (mouse.y - canvas.height / 2) * camera.fovFactor)

  renderScene()
  updateHudUI()
  updateScoreboardUI()
  requestAnimationFrame(gameLoop)
}

// ── 启动 ──
bindAllEvents()
autoDetectDeviceInput()
localPlayer.team = 'ffa'   // 死斗 FFA 默认
syncBotsCount(4)
updateHudWeaponButtons()
updateSpawnPointButtonsUI()
updateTeamCountUI()
syncParamsToUI()
requestAnimationFrame(gameLoop)

// 调试暴露（截图/自动化验证用）
;(window as unknown as { __dbg: unknown }).__dbg = {
  world,
  get player() { return localPlayer },
  get bots() { return bots },
  get camera() { return camera },
  get pendingLoadout() { return pendingLoadout },
  syncBotsCount,
  applyPendingLoadoutAndSpawn,
  get touch() { return touchState },
  botTargets: () => bots.map(b => ({ bot: b.name, team: b.team, target: pickBotTarget(b)?.name ?? null, targetTeam: pickBotTarget(b)?.team ?? null })),
  get beams() { return beams },
  get mode() { return mode.current },
}

// 调参持久化（tuning 页共享）
;(window as unknown as { __tune: unknown }).__tune = {
  set: (p: Record<string, number>) => setPhysicsParams(p),
  get: () => getPhysicsParams(),
  reset: () => resetPhysicsParams(),
}
;(function loadSavedParams(): void {
  try {
    // v2：飞行槽加倍后的默认值；旧 key 的存档（jetpackFuel 0.5）不再覆盖
    const raw = localStorage.getItem('pvp-physics-params-v2')
    if (raw) setPhysicsParams(JSON.parse(raw) as Record<string, number>)
  } catch { /* 忽略 */ }
})()