// web/main-web.ts —— 浏览器入口：SkyBlast 2D 完整版 UI（v2 界面全量移植）
// 大厅（队伍/重生点/主副武器按钮组/AI 数量）· 双摇杆触屏 · killfeed · 参数调校台 · v2 世界渲染
// 全部跑在新 core 的服务器权威上：本页内嵌权威世界（本地单机 = 自己当主机），输入经意图流。
import { World } from '../core/sim/world.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput, WorldEvent, TeamId, PlayerState } from '../core/types.ts'
import { setPhysicsParams, getPhysicsParams, resetPhysicsParams } from '../core/sim/physics.ts'
import { WORLD_W, WORLD_H, SURFACE_Y, wrapX, wrapY, wrapDeltaX, wrapDeltaY, wrapDist, clamp } from '../core/wrap.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG } from '../core/weapons.ts'
import { SPAWN_POINTS } from '../core/sim/world.ts'
import { getTerrainPattern, makeStarField } from './textures.ts'
import {
  drawPlayerSprite, drawPlayerTag, drawObstacleSprite, drawCrateSprite, drawAmmoSprite,
  drawMortarSprite, drawTowerSprite, drawWarpSprite, drawFlagSprite, drawMineSprite,
  drawGrenadeSprite, drawAirstrikeSprite, drawProjectileSprite, drawDeco, TEAM_PALETTE,
} from './sprites.ts'
import { Effects } from './effects.ts'

// ── 画布与相机 ──
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
const ctx = canvas ? canvas.getContext('2d')! : null
const camera = { x: 6600, y: 2380, fovFactor: 1.0 }
let screenShake = 0

function resizeCanvas(): void {
  if (!canvas) return
  canvas.width = window.innerWidth || 1024
  canvas.height = window.innerHeight || 640
}

// ── 世界（服务器权威；本页 = 主机） ──
const world = new World(20261106)
const localPlayer = world.addPlayer('SkyHunter', 'red')
localPlayer.deployed = false   // 待机整备中（大厅点「立即进入战场」部署）

// AI 机器人（经权威输入驱动）
const botNames = ['AlphaBot-7', 'Valkyrie-AI', 'Titan-09', 'NovaStriker', 'ZeroGrav-X', 'OmegaHound', 'Phantom-AI', 'IronClad-8']
const botTeams: TeamId[] = ['blue', 'green', 'red', 'blue', 'green', 'blue', 'red', 'green']
const botSecs = ['frag', 'mine', 'instant_mine', 'airstrike', 'barricade', 'shield', 'doll', 'pistol']
let bots: PlayerState[] = []

function syncBotsCount(target: number): void {
  while (bots.length > target) {
    const b = bots.pop()!
    world.players = world.players.filter(p => p.id !== b.id)
  }
  while (bots.length < target) {
    const idx = bots.length
    let team: TeamId
    if (deathmatchMode === 'ffa') {
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
    if (deathmatchMode === 'ffa') {
      b.team = 'ffa'
    } else {
      let team: TeamId = idx % 2 === 0 ? 'red' : 'blue'
      if (team === localPlayer.team) team = team === 'red' ? 'blue' : 'red'
      b.team = team
    }
  })
  updateTeamCountUI()
}

// ── 待部署配装 ──
const pendingLoadout = { weaponIndex: 0, secondaryType: 'frag', spawnPointId: 'base' }
let deathmatchMode: 'ffa' | '2teams' = 'ffa'
world.config.randomSpawn = true   // 对战模式：每次出生随机安全点

function getSpawnCoords(): { x: number; y: number; label: string } {
  const t = SPAWN_POINTS.find(s => s.team === localPlayer.team) ?? SPAWN_POINTS[3]
  if (pendingLoadout.spawnPointId !== 'base') {
    const cp = world.capturePoints.find(c => c.id === pendingLoadout.spawnPointId)
    if (cp && (cp.ownerTeam === localPlayer.team || localPlayer.team === 'ffa')) {
      return { x: cp.x, y: cp.y - 60, label: cp.name }
    }
  }
  return { x: t.x, y: t.y, label: '队伍主基地' }
}

function applyPendingLoadoutAndSpawn(): void {
  const want = Number(pendingLoadout.weaponIndex)
  const wIdx = WEAPONS[want] && !WEAPONS[want].isSupplyOnly ? want : 0
  // 先设置配装，再由权威端统一出生（死斗模式下随机安全点）
  localPlayer.weaponIndex = wIdx
  localPlayer.secondary = SECONDARIES[pendingLoadout.secondaryType] ? pendingLoadout.secondaryType : 'frag'
  localPlayer.deployed = true
  localPlayer.alive = true
  world.deploy(localPlayer)
  updateHudWeaponButtons()
  const spLabel = world.config.randomSpawn ? '随机安全点' : '队伍主基地'
  showToast(`⚡ 已在【${spLabel}】部署！配装已锁定：${WEAPONS[wIdx].name} + ${(SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag).name}`)
}

// ── 输入状态 ──
const keys: Record<string, boolean> = {}
const mouse = { x: 0, y: 0, worldX: 6600, worldY: 2380, down: false }
const touchState = {
  enabled: false,
  moveActive: false, moveId: -1, moveX: 0, moveY: 0,
  boostButtonDown: false,
  aimActive: false, aimId: -1, aimX: 0, aimY: 0,
}
let pendingInteract = false
let pendingSecondary: { type: string; targetX: number; targetY: number } | null = null
let pendingReload = false

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

// ── 客户端特效（纯表现层） ──
const effects = new Effects()
// 激光束：点击即一道光，按秒存在（渲染用；伤害已在权威端即时结算）
const beams: { segments: { x1: number; y1: number; x2: number; y2: number }[]; color: string; life: number; maxLife: number }[] = []
// 世界锚定背景：星星按世界坐标生成（随地形一起移动，不会与方块相对滑动）
const starRng = (() => {
  let seed = 0x9e3779b9
  return (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})()
const worldStars = (() => {
  const out: { x: number; y: number; r: number; a: number }[] = []
  for (let i = 0; i < 640; i++) {
    out.push({ x: starRng() * WORLD_W, y: starRng() * WORLD_H, r: 0.6 + starRng() * 1.4, a: 0.2 + starRng() * 0.6 })
  }
  return out
})()
const worldGlows = [
  { x: 6600, y: 1080, r: 620, c: '56,189,248', a: 0.09 },
  { x: 4150, y: 3560, r: 520, c: '16,185,129', a: 0.07 },
  { x: 10150, y: 3520, r: 520, c: '244,63,94', a: 0.07 },
]

// ── Toast / Killfeed ──
function escapeHtml(str: string): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

let toastTimer = 0
function showToast(msg: string): void {
  const el = document.getElementById('toastBanner')
  if (!el) return
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 3400)
}

const TEAM_LIGHT: Record<string, string> = { red: '#fda4af', blue: '#7dd3fc', green: '#6ee7b7', ffa: '#fde047' }

function addKillFeed(killerName: string, killerTeam: string, victimName: string, victimTeam: string, weaponLabel: string, isHeadshot?: boolean, isPierced?: boolean): void {
  const feed = document.getElementById('killFeedContainer')
  if (!feed) return
  const item = document.createElement('div')
  item.className = 'kill-item glass-panel px-3 py-1.5 rounded-xl border border-slate-700/90 shadow-lg flex items-center gap-2 text-xs'
  item.innerHTML = `
    <span class="font-extrabold" style="color:${TEAM_LIGHT[killerTeam] ?? '#fda4af'}">${escapeHtml(killerName)}</span>
    <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-200 border border-slate-700">${escapeHtml(weaponLabel)}</span>
    ${isHeadshot ? '<span class="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-400 text-amber-300 text-[10px] font-extrabold">🎯 爆头</span>' : ''}
    ${isPierced ? '<span class="px-1.5 py-0.5 rounded bg-purple-500/25 border border-purple-400 text-purple-200 text-[10px] font-extrabold">⚡ 穿透</span>' : ''}
    <span class="font-extrabold" style="color:${TEAM_LIGHT[victimTeam] ?? '#7dd3fc'}">${escapeHtml(victimName)}</span>
  `
  feed.prepend(item)
  while (feed.children.length > 6) feed.removeChild(feed.lastChild!)
  window.setTimeout(() => item.remove(), 6500)
}

function handleEvents(evs: WorldEvent[]): void {
  for (const e of evs) {
    if (e.kind === 'kill') {
      addKillFeed(e.killerName ?? '?', e.killerTeam ?? 'ffa', e.victimName ?? '?', e.victimTeam ?? 'ffa', e.weaponLabel ?? '', e.isHeadshot, e.isPierced)
      if (e.x !== undefined && e.y !== undefined) effects.killBurst(e.x, e.y, TEAM_PALETTE[e.victimTeam ?? 'red']?.light ?? '#fda4af')
    } else if (e.kind === 'explosion') {
      screenShake = Math.max(screenShake, Math.min(14, (e.radius ?? 60) * 0.15))
      if (e.x !== undefined && e.y !== undefined) effects.explosion(e.x, e.y, e.radius ?? 60)
    } else if (e.kind === 'obstacle_destroy') {
      if (e.x !== undefined && e.y !== undefined) effects.debris(e.x, e.y, 50, 60, '#9a3412', '#f97316')
    } else if (e.kind === 'capture') showToast(`🚩 据点 ${e.pointCode} 被 ${e.team} 占领！`)
    else if (e.kind === 'supply_pickup') {
      showToast(`📦 拾取【${e.weaponName}】`)
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#a5f3fc')
    } else if (e.kind === 'ammo_pickup') {
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#4ade80')
    } else if (e.kind === 'doll_recall') {
      showToast('🎎 替身人偶生效：回到锚点位置与状态！')
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#f472b6')
    } else if (e.kind === 'shield_break') showToast('💥 护盾破碎！')
    else if (e.kind === 'mortar_fire') {
      screenShake = Math.max(screenShake, 9)
      if (e.x !== undefined && e.y !== undefined) effects.muzzle(e.x, e.y - 20, '#fde047')
    } else if (e.kind === 'airstrike_drop') {
      if (e.x !== undefined && e.y !== undefined) {
        effects.explosion(e.x, e.y, 120)
        screenShake = Math.max(screenShake, 12)
      }
    } else if (e.kind === 'laser') {
      if (e.segments && e.segments.length > 0) {
        const dur = e.duration ?? 0.14
        beams.push({ segments: e.segments, color: e.color ?? '#22d3ee', life: dur, maxLife: dur })
        if (beams.length > 24) beams.shift()
      }
      screenShake = Math.max(screenShake, 1.5)
    } else if (e.kind === 'warp') showToast(`🌀 ${e.weaponName ?? '传送'}！`)
  }
}

// ── HUD 更新 ──
function updateHudWeaponButtons(): void {
  const activeWepIdx = localPlayer.deployed ? localPlayer.weaponIndex : pendingLoadout.weaponIndex
  const activeSec = localPlayer.deployed ? localPlayer.secondary : pendingLoadout.secondaryType
  document.querySelectorAll('.weapon-slot-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-slot') || 0)
    btn.className = slot === activeWepIdx
      ? 'weapon-slot-btn glass-panel px-2.5 py-1.5 rounded-lg border-2 border-amber-400 text-left transition flex flex-col min-w-[72px] sm:min-w-[92px]'
      : 'weapon-slot-btn glass-panel px-2.5 py-1.5 rounded-lg border border-slate-700/80 text-left transition flex flex-col min-w-[72px] sm:min-w-[92px] opacity-75'
  })
  document.querySelectorAll('.lobby-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    btn.className = slot === pendingLoadout.weaponIndex
      ? 'lobby-wep-btn px-2.5 py-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 text-left transition'
      : 'lobby-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500'
  })
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec')
    const def = sec ? SECONDARIES[sec] : undefined
    if (def?.supplyOnly) {
      btn.className = 'lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/40 text-left transition cursor-not-allowed opacity-60'
    } else {
      btn.className = sec === pendingLoadout.secondaryType
        ? 'lobby-sec-btn px-2.5 py-2 rounded-xl border-2 border-rose-400 bg-rose-500/20 text-left transition'
        : 'lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500'
    }
  })
  document.querySelectorAll('.hud-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec')
    btn.className = sec === activeSec
      ? 'hud-sec-btn px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-extrabold border border-rose-300'
      : 'hud-sec-btn px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 text-[10px] font-semibold border border-slate-700 opacity-75'
  })
}

function updateSpawnPointButtonsUI(): void {
  const container = document.getElementById('spawnPointBtnGroup')
  if (!container) return
  container.querySelectorAll('.spawn-select-btn').forEach((btn) => {
    const spId = btn.getAttribute('data-spawn') || 'base'
    let unlocked = spId === 'base'
    if (spId !== 'base') {
      const cp = world.capturePoints.find(c => c.id === spId)
      unlocked = Boolean(cp && (cp.ownerTeam === localPlayer.team || localPlayer.team === 'ffa'))
    }
    const isSelected = pendingLoadout.spawnPointId === spId
    if (!unlocked) btn.className = 'spawn-select-btn px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/40 text-slate-600 text-[11px] font-semibold cursor-not-allowed'
    else if (isSelected) btn.className = 'spawn-select-btn px-2.5 py-1.5 rounded-lg border-2 border-emerald-400 bg-emerald-500/20 text-emerald-200 text-[11px] font-extrabold'
    else btn.className = 'spawn-select-btn px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-[11px] font-semibold hover:border-emerald-400/50'
  })
}

function tryChangePrimaryWeapon(slotIdx: number): void {
  const wep = WEAPONS[slotIdx]
  if (!wep || wep.isSupplyOnly) return
  if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
    showToast('🔒 主武器在重生前已选定锁定！阵亡重生前或拾取空投特武时方可更换')
    return
  }
  pendingLoadout.weaponIndex = slotIdx
  localPlayer.weaponIndex = slotIdx
  updateHudWeaponButtons()
}

function tryChangeSecondaryWeapon(secType: string): void {
  const def = SECONDARIES[secType]
  if (!def) return
  if (def?.supplyOnly) {
    // 补给专属例外：只有持有充能时才可临时切换使用
    if (localPlayer.dollCharges <= 0) {
      showToast('🎎 替身人偶只能从战场特殊补给箱获得充能！')
      return
    }
    localPlayer.secondary = secType
    updateHudWeaponButtons()
    showToast(`🎎 已切换替身人偶（充能 ${localPlayer.dollCharges}）`)
    return
  }
  if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
    showToast('🔒 副武器在重生前已选定锁定！阵亡重生前可重新选择')
    return
  }
  pendingLoadout.secondaryType = secType
  localPlayer.secondary = secType
  updateHudWeaponButtons()
}

const TEAM_BADGE: Record<string, [string, string]> = {
  red: ['红队 ALPHA', 'bg-rose-500/20 text-rose-300 border border-rose-500/40'],
  blue: ['蓝队 BRAVO', 'bg-sky-500/20 text-sky-300 border border-sky-500/40'],
  green: ['绿队 CHARLIE', 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'],
  ffa: ['混战 SOLO', 'bg-amber-500/20 text-amber-300 border border-amber-500/40'],
}

function updateHudUI(): void {
  const nameEl = document.getElementById('hudPlayerName')
  if (nameEl) nameEl.textContent = localPlayer.name
  const teamEl = document.getElementById('hudTeamBadge')
  if (teamEl) {
    const [label, cls] = TEAM_BADGE[localPlayer.team] ?? TEAM_BADGE.red
    teamEl.textContent = label
    teamEl.className = `px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`
  }
  const fovBadge = document.getElementById('hudSniperFovBadge')
  if (fovBadge) {
    const wepForFov = WEAPONS[localPlayer.weaponIndex]
    if (localPlayer.mountedTowerId) {
      fovBadge.textContent = '🗼 瞭望视野 200%（按 E 下塔）'
      fovBadge.classList.remove('hidden')
    } else if ((wepForFov?.fovMult ?? 1) > 1.01) {
      fovBadge.textContent = `🔭 ${wepForFov.shortName} 视野+30%`
      fovBadge.classList.remove('hidden')
    } else fovBadge.classList.add('hidden')
  }
  const hpBar = document.getElementById('hudHpBar')
  if (hpBar) hpBar.style.width = clamp((localPlayer.hp / localPlayer.maxHp) * 100, 0, 100) + '%'
  const shieldBar = document.getElementById('hudShieldBar')
  if (shieldBar) shieldBar.style.width = localPlayer.shieldTimer > 0 ? clamp((localPlayer.shieldHp / world.config.shieldHp) * 100, 0, 100) + '%' : '0%'
  const hpText = document.getElementById('hudHpText')
  if (hpText) hpText.textContent = `${Math.max(0, Math.round(localPlayer.hp))} / ${localPlayer.maxHp}`
  const fuelBar = document.getElementById('hudFuelBar')
  const fuelMaxNow = getPhysicsParams().jetpackFuel * (WEAPONS[localPlayer.weaponIndex]?.fuelMult ?? 1)
  if (fuelBar) fuelBar.style.width = clamp((localPlayer.fuel / Math.max(0.001, fuelMaxNow)) * 100, 0, 100) + '%'

  const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0]
  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  const wNameEl = document.getElementById('currentWeaponName')
  if (wNameEl) wNameEl.textContent = mounted ? '🎯 公共迫击炮操控中' : `${wep.name} ${localPlayer.deployed ? '🔒' : ''}`
  const ammoEl = document.getElementById('currentAmmoText')
  if (ammoEl) ammoEl.textContent = mounted ? '∞' : `${localPlayer.ammo[localPlayer.weaponIndex] ?? 0} / ${localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0}`

  const secDef = SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag
  const gOverlay = document.getElementById('grenadeCdOverlay')
  const gLabel = document.getElementById('hudGrenadeLabel')
  const gTitle = document.getElementById('hudSecondaryTitle')
  const isDoll = localPlayer.secondary === 'doll'
  if (gTitle) gTitle.textContent = isDoll
    ? `[G/右键] 替身人偶 [充能${localPlayer.dollCharges}]`
    : `[G/右键] 手榴弹 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`
  if (gOverlay && gLabel) {
    if (isDoll) {
      gOverlay.style.height = localPlayer.dollCharges > 0 ? '0%' : '100%'
      gLabel.textContent = localPlayer.dollCharges > 0 ? '🎎 就绪' : '🎎 无充能'
    } else {
      const need = localPlayer.fragCharges >= world.config.fragMaxCharges
      if (need) {
        gOverlay.style.height = '0%'
        gLabel.textContent = '💣 就绪'
      } else {
        const pct = Math.min(100, (localPlayer.fragRechargeTimer / world.config.fragRechargeSeconds) * 100)
        gOverlay.style.height = pct + '%'
        gLabel.textContent = `💣 ${localPlayer.fragCharges}/${world.config.fragMaxCharges} 回复中`
      }
    }
  }

  const reloadWrap = document.getElementById('reloadProgressWrap')
  const reloadBar = document.getElementById('reloadProgressBar')
  if (reloadWrap && reloadBar) {
    if (localPlayer.reloading) {
      reloadWrap.classList.remove('hidden')
      reloadWrap.classList.add('flex')
      const wep2 = WEAPONS[localPlayer.weaponIndex]
      reloadBar.style.width = clamp(100 * (1 - localPlayer.reloadTimer / wep2.reloadTime), 0, 100) + '%'
    } else {
      reloadWrap.classList.add('hidden')
      reloadWrap.classList.remove('flex')
    }
  }

  const banner = document.getElementById('interactBanner')
  const bannerText = document.getElementById('interactBannerText')
  if (!banner || !bannerText) return
  let promptMsg: string | null = null
  if (!localPlayer.deployed) {
    promptMsg = '🏠 待机整备中：点击此处或「立即进入战场」部署；可自由更换主/副武器与队伍'
  } else if (localPlayer.respawnTimer > 0) {
    promptMsg = `💀 阵亡倒计时 ${localPlayer.respawnTimer.toFixed(1)}s：点击此处打开整备面板更换配装与重生点`
  } else if (mounted) {
    promptMsg = '🎯 迫击炮操控中：移动鼠标调节落点，按住开火发射 | 按 [E] 或点击此处离开'
  } else {
    for (const m of world.mortars) {
      if (m.operatorId === null && wrapDist(localPlayer.pos.x, localPlayer.pos.y, m.x, m.y) < 115) {
        promptMsg = `🔥 按 [E] 或点击此处操控【${m.name}】`
        break
      }
    }
    if (localPlayer.mountedTowerId) {
      promptMsg = '🗼 瞭望塔上（视野 200%）：按 [E] 下塔，视野加成立即消失'
    }
    if (!promptMsg) {
      for (const tw of world.watchtowers) {
        if (tw.operatorId === null && wrapDist(localPlayer.pos.x, localPlayer.pos.y, tw.x, tw.y) < 130) {
          promptMsg = `🗼 按 [E] 登上【${tw.name}】（锁定 200% 视野，不能移动；下塔即失效）`
          break
        }
      }
    }
    if (!promptMsg) {
      for (const wp of world.warpPortals) {
        if (wrapDist(localPlayer.pos.x, localPlayer.pos.y, wp.x, wp.y) < 90) {
          promptMsg = `🌀 按 [E] 启动【${wp.name}】量子传送`
          break
        }
      }
    }
    if (!promptMsg) {
      const dollCrate = world.supplyCrates.find(c => c.active && c.kind === 'doll' && wrapDist(localPlayer.pos.x, localPlayer.pos.y, c.x, c.y) < 60)
      if (dollCrate) promptMsg = '🎎 靠近特殊补给箱自动拾取替身人偶充能'
    }
  }
  if (promptMsg) {
    banner.classList.remove('hidden')
    bannerText.textContent = promptMsg
  } else banner.classList.add('hidden')
}

function updateScoreboardUI(): void {
  const r = document.getElementById('scoreRed')
  const b = document.getElementById('scoreBlue')
  const g = document.getElementById('scoreGreen')
  if (r) r.textContent = String(world.scores.red ?? 0)
  if (b) b.textContent = String(world.scores.blue ?? 0)
  if (g) g.textContent = String(world.scores.green ?? 0)
}

function updateTeamCountUI(): void {
  const counts: Record<string, number> = { red: 0, blue: 0, green: 0, ffa: 0 }
  for (const p of world.players) {
    if (counts[p.team] !== undefined) counts[p.team]++
  }
  for (const key of ['Red', 'Blue', 'Green', 'Ffa']) {
    const el = document.getElementById('teamCount' + key)
    if (el) el.textContent = counts[key.toLowerCase()] + '人'
  }
}

// ── 渲染：相机居中 + 双轴环形最短位移（跨缝自动走最近象限） ──
const TEAM_COLOR: Record<string, string> = { red: '#f43f5e', blue: '#0ea5e9', green: '#10b981', ffa: '#eab308' }
const TEAM_LIGHT2: Record<string, string> = { red: '#fda4af', blue: '#7dd3fc', green: '#6ee7b7', ffa: '#fde047' }

function renderScene(): void {
  if (!ctx || !canvas) return
  const wep = WEAPONS[localPlayer.weaponIndex] ?? WEAPONS[0]
  const mounted = world.mortars.find(m => m.operatorId === localPlayer.id)
  const targetFov = localPlayer.mountedTowerId
    ? 2.0   // 瞭望塔：视野 200%，下塔即失效
    : (mounted ? 1.0 : (wep.fovMult || 1.0))
  camera.fovFactor += (targetFov - camera.fovFactor) * 0.12

  // 相机跟随（双轴环形最短位移）：**始终以玩家为屏幕中心**，不随瞄准方向偏移
  // （旧实现 +cos(aim)*80 / +sin(aim)*55 会让视角中心永久偏离玩家，尤其瞭望塔 200% 视野下更明显）
  if (localPlayer.deployed) {
    const tx = localPlayer.pos.x
    const ty = localPlayer.pos.y - 12
    camera.x = wrapX(camera.x + wrapDeltaX(camera.x, tx) * 0.2)
    camera.y = wrapY(camera.y + wrapDeltaY(camera.y, ty) * 0.2)
  }

  let shakeX = 0, shakeY = 0
  if (screenShake > 0.2) {
    shakeX = (Math.random() - 0.5) * screenShake * 2
    shakeY = (Math.random() - 0.5) * screenShake * 2
    screenShake *= 0.86
  } else screenShake = 0

  const zoom = 1 / camera.fovFactor
  const halfW = (canvas.width * camera.fovFactor) / 2 + 160
  const halfH = (canvas.height * camera.fovFactor) / 2 + 160

  // ── 背景：与地形同坐标系的世界锚定层（不产生相对滑动） ──
  ctx.save()
  const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height)
  // 天幕颜色随相机深度变化（地表附近偏夜空蓝，地下渐暗），避免"背景固定"的违和感
  const depthT = clamp((camera.y - (SURFACE_Y - 1400)) / 1800, 0, 1)
  const topR = Math.round(5 + depthT * 4)
  const topB = Math.round(17 - depthT * 10)
  skyGrad.addColorStop(0, `rgb(${topR}, ${Math.round(8 + depthT * 4)}, ${topB + 4})`)
  skyGrad.addColorStop(0.55, `rgb(${Math.round(15 - depthT * 9)}, ${Math.round(23 - depthT * 12)}, ${Math.round(42 - depthT * 22)})`)
  skyGrad.addColorStop(1, `rgb(${Math.round(30 - depthT * 20)}, ${Math.round(27 - depthT * 17)}, ${Math.round(75 - depthT * 45)})`)
  ctx.fillStyle = skyGrad
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.scale(zoom, zoom)
  ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY)

  const sx = (wx: number): number => wrapDeltaX(camera.x, wx)
  const sy = (wy: number): number => wrapDeltaY(camera.y, wy)
  const inView = (dx: number, dy: number, pad = 0): boolean =>
    dx > -halfW - pad && dx < halfW + pad && dy > -halfH - pad && dy < halfH + pad

  // 世界锚定星空（随地形移动，无相对滑动）
  for (const st of worldStars) {
    const px = sx(st.x)
    const py = sy(st.y)
    if (!inView(px, py)) continue
    ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(world.tick * 0.02 + st.x * 0.05))
    ctx.fillStyle = '#dbeafe'
    ctx.beginPath(); ctx.arc(px, py, st.r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  // 世界固定色光晕（地下掩体/中央浮岛的环境光）
  for (const gl of worldGlows) {
    const gx = sx(gl.x)
    const gy = sy(gl.y)
    if (!inView(gx, gy, gl.r)) continue
    const grad = ctx.createRadialGradient(gx, gy, 10, gx, gy, gl.r)
    grad.addColorStop(0, `rgba(${gl.c}, ${gl.a})`)
    grad.addColorStop(1, `rgba(${gl.c}, 0)`)
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(gx, gy, gl.r, 0, Math.PI * 2); ctx.fill()
  }

  // 1. 地形图元（程序化贴图）——按 ±WORLD_W/±WORLD_H 复制绘制，修复左右/上下接缝处缺块
  for (const r of world.terrain.rects) {
    if (r.kind.startsWith('deco_')) continue
    const cx0 = sx(r.x + r.w / 2)
    const cy0 = sy(r.y + r.h / 2)
    for (const ox of [-WORLD_W, 0, WORLD_W]) {
      for (const oy of [-WORLD_H, 0, WORLD_H]) {
        const cx = cx0 + ox
        const cy = cy0 + oy
        if (!inView(cx, cy, Math.max(r.w, r.h))) continue
        const left = cx - r.w / 2
        const top = cy - r.h / 2
        const pat = getTerrainPattern(ctx, r.kind)
        ctx.fillStyle = pat ?? r.color
        ctx.fillRect(left, top, r.w, r.h)
        // 顶面高光 + 底面阴影（体积感）
        if (r.kind !== 'tunnel_bg' && r.kind !== 'pipe_bg' && r.kind !== 'building_bg') {
          ctx.fillStyle = 'rgba(255,255,255,0.10)'
          ctx.fillRect(left, top, r.w, 2)
          ctx.fillStyle = 'rgba(0,0,0,0.22)'
          ctx.fillRect(left, top + r.h - 3, r.w, 3)
        }
        if (r.borderColor) {
          ctx.strokeStyle = r.borderColor
          ctx.lineWidth = r.kind === 'pipe_wall' ? 3 : 2
          ctx.strokeRect(left + 1, top + 1, r.w - 2, r.h - 2)
        }
        if (r.label && (r.kind === 'building_roof' || r.kind === 'pipe_wall' || r.kind === 'bridge')) {
          ctx.fillStyle = 'rgba(226, 232, 240, 0.75)'
          ctx.font = 'bold 12px Inter, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(r.label, cx, top - 8)
        }
      }
    }
  }

  // 2. 可破坏障碍物（受损裂纹 sprite）
  for (const ob of world.obstacles) {
    const ox = sx(ob.x + ob.w / 2)
    const oy = sy(ob.y + ob.h / 2)
    if (!inView(ox, oy, Math.max(ob.w, ob.h))) continue
    drawObstacleSprite(ctx, ob, ox, oy)
  }

  // 3. 占领点（旗帜 sprite，旗面飘动）
  for (const cp of world.capturePoints) {
    const cx = sx(cp.x)
    const cy = sy(cp.y)
    if (!inView(cx, cy, 140)) continue
    drawFlagSprite(ctx, cp, cx, cy, world.tick)
  }

  // 4. 传送门（旋转光环）
  for (const wp of world.warpPortals) {
    const wx = sx(wp.x)
    const wy = sy(wp.y)
    if (!inView(wx, wy)) continue
    drawWarpSprite(ctx, wp, wx, wy, world.tick)
  }

  // 5. 瞭望塔
  for (const tw of world.watchtowers) {
    const tx = sx(tw.x)
    const ty = sy(tw.y)
    if (!inView(tx, ty, 200)) continue
    drawTowerSprite(ctx, tw, tx, ty, world.tick)
  }

  // 6. 弹药点
  for (const pack of world.ammoPacks) {
    const px = sx(pack.x)
    const py = sy(pack.y)
    if (!inView(px, py)) continue
    drawAmmoSprite(ctx, pack, px, py, world.tick)
  }

  // 7. 补给箱（武器/人偶）
  for (const crate of world.supplyCrates) {
    if (!crate.active) continue
    const cx = sx(crate.x)
    const cy = sy(crate.y)
    if (!inView(cx, cy)) continue
    drawCrateSprite(ctx, crate, cx, cy, world.tick)
  }

  // 8. 迫击炮
  for (const m of world.mortars) {
    const mx = sx(m.x)
    const my = sy(m.y)
    if (!inView(mx, my)) continue
    drawMortarSprite(ctx, m, mx, my, world.tick)
  }

  // 9. 地雷
  for (const m of world.landmines) {
    if (m.respawnTimer > 0) continue
    const mx = sx(m.pos.x)
    const my = sy(m.pos.y)
    if (!inView(mx, my)) continue
    drawMineSprite(ctx, m, mx, my, world.tick, world.config.mineTriggerRadius)
  }

  // 10. 玩家 sprite + 头顶标签（含替身人偶幻影/激光武器瞄准线）
  for (const p of world.players) {
    if (p.respawnTimer > 0 || !p.deployed) continue
    const w = WEAPONS[p.weaponIndex] ?? WEAPONS[0]
    const pMounted = world.mortars.some(m => m.operatorId === p.id)

    // 替身人偶幻影
    if (p.doll) {
      const dx = sx(p.doll.pos.x)
      const dy = sy(p.doll.pos.y)
      if (inView(dx, dy)) {
        ctx.save()
        ctx.translate(dx, dy)
        ctx.globalAlpha = 0.62
        ctx.strokeStyle = '#f472b6'
        ctx.fillStyle = 'rgba(244, 114, 182, 0.22)'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.roundRect(-11, -12, 22, 28, 6); ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(0, -24, world.config.headRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.globalAlpha = 1
        ctx.fillStyle = '#f472b6'
        ctx.font = 'bold 11px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`🎎 ${p.doll.timer.toFixed(1)}s`, 0, -44)
        ctx.restore()
      }
    }

    const px = sx(p.pos.x)
    const py = sy(p.pos.y)
    if (!inView(px, py)) continue

    // 激光类武器的长瞄准线
    if (w.laser && !pMounted) {
      ctx.save()
      ctx.translate(px, py)
      ctx.strokeStyle = w.id === 4 ? 'rgba(34, 211, 238, 0.35)' : 'rgba(192, 132, 252, 0.32)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(0, -10)
      ctx.lineTo(Math.cos(p.aim) * 820, -10 + Math.sin(p.aim) * 820)
      ctx.stroke()
      ctx.restore()
    }

    drawPlayerSprite(ctx, p, px, py, {
      tick: world.tick,
      isLocal: p.id === localPlayer.id,
      movingX: p.vel.x,
      floating: p.jetpack,
      mounted: pMounted,
    })
    drawPlayerTag(ctx, p, px, py, p.id === localPlayer.id)
  }

  // 10.5 迫击炮瞄准线 + 鼠标准星
  const mountedNow = world.mortars.find(m => m.operatorId === localPlayer.id)
  if (mountedNow) {
    const mx = sx(mountedNow.x)
    const my = sy(mountedNow.y)
    const aimLen = 420
    ctx.save()
    ctx.setLineDash([10, 8])
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.75)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(mx + Math.cos(mountedNow.angle) * 30, my - 18 + Math.sin(mountedNow.angle) * 30)
    ctx.lineTo(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen)
    ctx.stroke()
    ctx.setLineDash([])
    // 落点预示（抛物线近似）
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(mx + Math.cos(mountedNow.angle) * aimLen, my - 18 + Math.sin(mountedNow.angle) * aimLen, 26, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  // 鼠标准星（世界坐标 → 屏幕）
  {
    const mx = sx(mouse.worldX)
    const my = sy(mouse.worldY)
    if (mx > -40 && mx < canvas.width + 40 && my > -40 && my < canvas.height + 40) {
      ctx.save()
      ctx.strokeStyle = mountedNow ? 'rgba(251, 146, 60, 0.95)' : 'rgba(255, 255, 255, 0.8)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(mx - 9, my); ctx.lineTo(mx - 3, my)
      ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 9, my)
      ctx.moveTo(mx, my - 9); ctx.lineTo(mx, my - 3)
      ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 9)
      ctx.stroke()
      ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }
  }

  // 11. 动态阴影（瞭望塔视野激活时不遮）——同样按 ±WORLD 复制，修复接缝处漏光/缺遮
  if (!localPlayer.mountedTowerId) {
    for (const sz of world.terrain.shadows) {
      const cx0 = sx(sz.x + sz.w / 2)
      const cy0 = sy(sz.y + sz.h / 2)
      for (const ox of [-WORLD_W, 0, WORLD_W]) {
        for (const oy of [-WORLD_H, 0, WORLD_H]) {
          const cx = cx0 + ox
          const cy = cy0 + oy
          if (!inView(cx, cy, Math.max(sz.w, sz.h))) continue
          const inside = localPlayer.deployed &&
            Math.abs(wrapDeltaX(localPlayer.pos.x, sz.x + sz.w / 2)) <= sz.w / 2 + 40 &&
            Math.abs(wrapDeltaY(localPlayer.pos.y, sz.y + sz.h / 2)) <= sz.h / 2 + 40
          ctx.fillStyle = inside ? 'rgba(2, 6, 23, 0.22)' : `rgba(2, 6, 23, ${sz.alpha ?? 0.74})`
          ctx.fillRect(cx - sz.w / 2, cy - sz.h / 2, sz.w, sz.h)
        }
      }
    }
  }

  // 11.5 装饰层（窗户灯/路灯/缆线/天线/蒸汽口/警示条/油桶/管道/梯子/标牌）——画在阴影之后，灯光不被压暗
  for (const r of world.terrain.rects) {
    if (!r.kind.startsWith('deco_')) continue
    const cx0 = sx(r.x + r.w / 2)
    const cy0 = sy(r.y + r.h / 2)
    for (const ox of [-WORLD_W, 0, WORLD_W]) {
      for (const oy of [-WORLD_H, 0, WORLD_H]) {
        const cx = cx0 + ox
        const cy = cy0 + oy
        if (!inView(cx, cy, Math.max(r.w, r.h) + 40)) continue
        drawDeco(ctx, r, cx, cy, world.tick)
      }
    }
  }

  // 12. 手雷 / 弹丸 / 空袭信标（sprite）
  for (const g of world.grenades) {
    const gx = sx(g.pos.x)
    const gy = sy(g.pos.y)
    if (!inView(gx, gy)) continue
    drawGrenadeSprite(ctx, g, gx, gy, world.tick)
  }
  for (const pr of world.projectiles) {
    const px = sx(pr.pos.x)
    const py = sy(pr.pos.y)
    if (!inView(px, py, 200)) continue
    drawProjectileSprite(ctx, pr, px, py, world.tick)
  }
  for (const st of world.airstrikes) {
    const ax = sx(st.pos.x)
    const ay = sy(st.pos.y)
    if (!inView(ax, ay, 60)) continue
    drawAirstrikeSprite(ctx, st, ax, ay, world.tick)
  }

  // 12.5 激光束（分段折线，按秒淡出；反射 3 次由权威端算好）
  for (const b of beams) {
    const alpha = Math.max(0, b.life / b.maxLife)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    // 外层辉光
    ctx.strokeStyle = b.color
    ctx.lineWidth = 9
    ctx.globalAlpha = alpha * 0.35
    for (const seg of b.segments) {
      ctx.beginPath()
      ctx.moveTo(sx(seg.x1), sy(seg.y1))
      ctx.lineTo(sx(seg.x2), sy(seg.y2))
      ctx.stroke()
    }
    // 内芯
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.4
    for (const seg of b.segments) {
      ctx.beginPath()
      ctx.moveTo(sx(seg.x1), sy(seg.y1))
      ctx.lineTo(sx(seg.x2), sy(seg.y2))
      ctx.stroke()
    }
    ctx.restore()
  }

  // 13. 客户端粒子（爆炸/击杀/拾取/喷气/枪口）
  effects.render(ctx, (x, y) => ({ x: sx(x), y: sy(y) }), (x, y) => inView(x, y))

  ctx.restore()
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
    if (e.code === 'KeyR') pendingReload = true
    else if (e.code === 'KeyG' || e.code === 'KeyQ') pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
    else if (e.code === 'KeyE') pendingInteract = true
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
    else if (e.button === 2) pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  canvas?.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false })
  canvas?.addEventListener('contextmenu', (e) => e.preventDefault())

  document.querySelectorAll('.weapon-slot-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangePrimaryWeapon(Number(btn.getAttribute('data-slot') || 0))))
  document.querySelectorAll('.lobby-wep-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangePrimaryWeapon(Number(btn.getAttribute('data-wep') || 0))))
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')))
  document.querySelectorAll('.hud-sec-btn').forEach((btn) =>
    btn.addEventListener('click', () => tryChangeSecondaryWeapon(btn.getAttribute('data-sec') || 'frag')))

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

  document.getElementById('hudReloadBtn')?.addEventListener('click', () => { pendingReload = true })
  document.getElementById('hudGrenadeBtn')?.addEventListener('click', () => {
    pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('hudQuickMortarBtn')?.addEventListener('click', () => { pendingInteract = true })
  document.getElementById('interactBannerBtn')?.addEventListener('click', () => {
    if (!localPlayer.deployed || localPlayer.respawnTimer > 0) {
      const lobby = document.getElementById('lobbyModal')
      lobby?.classList.remove('hidden')
      lobby?.classList.add('flex')
      updateSpawnPointButtonsUI()
    } else pendingInteract = true
  })

  // ── 对战模式按钮组：自由混战 / 双队对抗 ──
  function applyTeamButtons(): void {
    document.querySelectorAll('.team-select-btn').forEach((b) => {
      const t = b.getAttribute('data-team')
      const enabled = deathmatchMode === '2teams' ? (t === 'red' || t === 'blue') : (t === 'ffa')
      const sel = t === localPlayer.team
      ;(b as HTMLButtonElement).disabled = !enabled
      b.className = 'team-select-btn px-3 py-2 rounded-xl text-left transition flex items-center justify-between ' +
        (sel ? 'border-2 border-indigo-400 bg-indigo-500/20 ' : 'border border-slate-700 bg-slate-950/60 ') +
        (enabled ? '' : 'opacity-40 cursor-not-allowed')
    })
  }
  function applyMode(mode: 'ffa' | '2teams'): void {
    if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      showToast('⚠️ 切换对战模式需在待机/阵亡整备时进行')
      return
    }
    deathmatchMode = mode
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const sel = b.getAttribute('data-mode') === mode
      b.className = 'mode-btn px-3 py-2 rounded-xl text-left transition border ' +
        (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
    })
    // FFA：全员混战；2 队：默认红队（可再点蓝）
    if (mode === 'ffa') localPlayer.team = 'ffa'
    else if (localPlayer.team === 'ffa' || localPlayer.team === 'green') localPlayer.team = 'red'
    syncBotsCount(bots.length)
    applyTeamButtons()
    updateTeamCountUI()
    showToast(mode === 'ffa'
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
    const sel = b.getAttribute('data-mode') === deathmatchMode
    b.className = 'mode-btn px-3 py-2 rounded-xl text-left transition border ' +
      (sel ? 'border-2 border-emerald-400 bg-emerald-500/20' : 'border border-slate-700 bg-slate-950/60 hover:border-slate-500')
  })

  const boostBtn = document.getElementById('touchBoostBtn')
  boostBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); touchState.boostButtonDown = true }, { passive: false })
  boostBtn?.addEventListener('touchend', () => { touchState.boostButtonDown = false })
  document.getElementById('touchGrenadeBtn')?.addEventListener('click', () => {
    pendingSecondary = { type: localPlayer.secondary, targetX: mouse.worldX, targetY: mouse.worldY }
  })
  document.getElementById('touchReloadBtn')?.addEventListener('click', () => { pendingReload = true })
  document.getElementById('touchInteractBtn')?.addEventListener('click', () => { pendingInteract = true })
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

// ── 主循环 ──
let playerInput: WorldInput = defaultWorldInput()
let prevFireCooldown = 0
let lastFrame = performance.now()
let acc = 0
let wasDead = false
const FIXED = 1 / 60

function buildLocalInput(): WorldInput {
  const w = defaultWorldInput()
  if (!localPlayer.deployed) return w
  if (localPlayer.respawnTimer > 0) {
    // 阵亡等待期：仍可操作大厅（不产生战斗输入）
    if (pendingInteract) { pendingInteract = false; return w }
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
  const zoom = camera.fovFactor
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
  w.interact = pendingInteract
  w.reload = pendingReload
  if (pendingSecondary) w.secondary = { type: pendingSecondary.type, targetX: pendingSecondary.targetX, targetY: pendingSecondary.targetY }
  return w
}

function onLocalDeath(): void {
  // 阵亡：解锁配装 + 提示（v2 规则：重生前可重新选主/副武器与重生点）
  pendingLoadout.weaponIndex = localPlayer.weaponIndex
  pendingLoadout.secondaryType = localPlayer.secondary
  updateHudWeaponButtons()
  showToast('💀 已阵亡！重生前可更换主/副武器与重生点（点击横幅打开整备面板）')
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
    pendingInteract = false
    pendingReload = false
    pendingSecondary = null

    const inputs = new Map<number, WorldInput>([[localPlayer.id, playerInput]])
    for (const b of bots) inputs.set(b.id, botInput(b))
    world.step(FIXED, inputs)
    handleEvents(world.drainEvents())

    const dead = localPlayer.respawnTimer > 0
    if (dead && !wasDead) onLocalDeath()
    if (!dead && wasDead) onLocalRespawn()
    wasDead = dead

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
  get mode() { return deathmatchMode },
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