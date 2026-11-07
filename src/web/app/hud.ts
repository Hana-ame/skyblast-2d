// web/app/hud.ts —— HUD / 大厅与死亡界面配装按钮状态（只读权威世界）
import { world, localPlayer, pendingLoadout } from './context.ts'
import { WEAPONS, SECONDARIES } from '../../core/weapons.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { clamp, wrapDist } from '../../core/wrap.ts'
import { showToast } from './toast.ts'

// ── HUD 更新 ──
export function updateHudWeaponButtons(): void {
  // 死亡界面：主/副武器选中态（重生时套用 pendingLoadout）；只读牌由 updateHUD 每帧刷新

  document.querySelectorAll('.death-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    btn.className = slot === pendingLoadout.weaponIndex
      ? 'death-wep-btn px-2.5 py-2 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 text-left transition'
      : 'death-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500'
  })
  document.querySelectorAll('.death-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec')
    const def = sec ? SECONDARIES[sec] : undefined
    const noCharge = sec === 'doll' && localPlayer.dollCharges <= 0
    btn.className = 'death-sec-btn px-2.5 py-1.5 rounded-lg border text-xs ' +
      (sec === pendingLoadout.secondaryType
        ? 'border-rose-400 bg-rose-500/20 font-extrabold text-white'
        : 'border-slate-700 bg-slate-950/60 font-semibold text-slate-400') +
      (noCharge || def?.supplyOnly && sec === 'doll' ? ' opacity-60 cursor-not-allowed' : '')
    ;(btn as HTMLButtonElement).disabled = sec === 'doll' && localPlayer.dollCharges <= 0
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
}

export function updateSpawnPointButtonsUI(): void {
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

export function tryChangePrimaryWeapon(slotIdx: number): void {
  const wep = WEAPONS[slotIdx]
  if (!wep || wep.isSupplyOnly) return
  if (localPlayer.deployed && localPlayer.respawnTimer <= 0) {
    showToast('🔒 主武器在重生前已选定锁定！阵亡重生前或拾取空投特武时方可更换')
    return
  }
  pendingLoadout.weaponIndex = slotIdx
  localPlayer.weaponIndex = slotIdx
  localPlayer.lastPrimaryIndex = slotIdx
  updateHudWeaponButtons()
}

export function tryChangeSecondaryWeapon(secType: string): void {
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

export function updateHudUI(): void {
  const nameEl = document.getElementById('hudPlayerName')
  if (nameEl) nameEl.textContent = localPlayer.name
  const teamEl = document.getElementById('hudTeamBadge')
  if (teamEl) {
    const [label, cls] = TEAM_BADGE[localPlayer.team] ?? TEAM_BADGE.red
    teamEl.textContent = label
    teamEl.className = `px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`
  }
  // 复活保护提示（隐身/无敌/不能开枪）
  const spawnBadge = document.getElementById('hudSpawnProtectBadge')
  if (spawnBadge) {
    const t = localPlayer.spawnProtectTimer ?? 0
    if (t > 0 && localPlayer.deployed && localPlayer.respawnTimer <= 0) {
      spawnBadge.textContent = `👻 复活保护 ${t.toFixed(1)}s（隐身·无敌·不能开枪）`
      spawnBadge.classList.remove('hidden')
    } else spawnBadge.classList.add('hidden')
  }
  const fovBadge = document.getElementById('hudSniperFovBadge')
  if (fovBadge) {
    const wepForFov = WEAPONS[localPlayer.weaponIndex]
    if (localPlayer.mountedTowerId) {
      fovBadge.textContent = '🗼 瞭望视野 200%（按 E 下塔）'
      fovBadge.classList.remove('hidden')
    } else if ((wepForFov?.fovMult ?? 1) > 1.01) {
      const charge = (wepForFov?.chargeSeconds ?? 0) > 0
        ? (localPlayer.chargeTimer > 0
          ? ` · 蓄力 ${Math.min(100, Math.round(localPlayer.chargeTimer / (wepForFov?.chargeSeconds ?? 1) * 100))}%`
          : ' · 按住蓄力')
        : ''
      fovBadge.textContent = `🔭 ${wepForFov.shortName} 视野+30%${charge}`
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
  // 底部只读"当前主武器"牌：每帧按权威 weaponIndex 刷新（拾取补给/换枪后不再显示旧武器）
  const plateEl = document.getElementById('hudCurrentWeaponName')
  if (plateEl) plateEl.textContent = wep.shortName
  const secChipEl = document.getElementById('hudSecondaryChipText')
  if (secChipEl) {
    secChipEl.textContent = localPlayer.secondary === 'doll'
      ? `🎎 替身人偶 [${localPlayer.dollCharges}]`
      : `💣 手榴弹 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`
  }
  const ammoEl = document.getElementById('currentAmmoText')
  if (ammoEl) ammoEl.textContent = mounted ? '∞' : `${Math.max(0, Math.ceil(localPlayer.ammo[localPlayer.weaponIndex] ?? 0))} / ${localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0}`

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
    promptMsg = ''
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

export function updateScoreboardUI(): void {
  const r = document.getElementById('scoreRed')
  const b = document.getElementById('scoreBlue')
  const g = document.getElementById('scoreGreen')
  if (r) r.textContent = String(world.scores.red ?? 0)
  if (b) b.textContent = String(world.scores.blue ?? 0)
  if (g) g.textContent = String(world.scores.green ?? 0)
}

export function updateTeamCountUI(): void {
  const counts: Record<string, number> = { red: 0, blue: 0, green: 0, ffa: 0 }
  for (const p of world.players) {
    if (counts[p.team] !== undefined) counts[p.team]++
  }
  for (const key of ['Red', 'Blue', 'Green', 'Ffa']) {
    const el = document.getElementById('teamCount' + key)
    if (el) el.textContent = counts[key.toLowerCase()] + '人'
  }
}

