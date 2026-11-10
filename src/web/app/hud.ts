// web/app/hud.ts —— HUD / 大厅与死亡界面配装按钮状态（只读权威世界，统一由 core/weapons.ts 单一数据源驱动）
import { world, localPlayer, pendingLoadout } from './context.ts'
import {
  WEAPONS,
  SECONDARIES,
  isSecondaryUnlocked,
  getHighestUnlockedSecondary,
  formatWeaponCardSubtitle,
  formatSecondaryButtonTitle,
  formatSecondaryCardSubtitle,
} from '../../core/weapons.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { isCapturePointSelectable } from '../../core/sim/world.ts'
import { clamp, wrapDist } from '../../core/wrap.ts'
import { showToast } from './toast.ts'

/** 将死亡界面与待机大厅中的主/副武器卡片文案统一同步自 core/weapons.ts + world.config */
export function syncLoadoutTextFromSingleSource(): void {
  document.querySelectorAll('.death-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    const wep = WEAPONS[slot]
    if (!wep) return
    const divs = btn.querySelectorAll('div')
    if (divs[0]) divs[0].textContent = wep.shortName
    if (divs[1]) divs[1].textContent = formatWeaponCardSubtitle(wep)
  })

  document.querySelectorAll('.lobby-wep-btn').forEach((btn, idx) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    const wep = WEAPONS[slot]
    if (!wep) return
    const divs = btn.querySelectorAll('div')
    if (divs[0]) divs[0].textContent = `${idx + 1}. ${wep.shortName}`
    if (divs[1]) divs[1].textContent = formatWeaponCardSubtitle(wep)
  })

  document.querySelectorAll('.death-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const def = SECONDARIES[sec]
    if (!def) return
    btn.textContent = formatSecondaryButtonTitle(def, true)
  })

  document.querySelectorAll('.lobby-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const def = SECONDARIES[sec]
    if (!def) return
    const divs = btn.querySelectorAll('div')
    if (divs[0]) divs[0].textContent = formatSecondaryButtonTitle(def, false)
    if (divs[1]) divs[1].textContent = formatSecondaryCardSubtitle(def, world.config)
  })
}

// ── HUD 更新 ──
export function updateHudWeaponButtons(): void {
  syncLoadoutTextFromSingleSource()
  // 死亡界面：主/副武器选中态（重生时套用 pendingLoadout）；只读牌由 updateHUD 每帧刷新
  const streak = localPlayer.deathStreak ?? 0
  const dollCharges = localPlayer.dollCharges ?? 0

  document.querySelectorAll('.death-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    btn.className = slot === pendingLoadout.weaponIndex
      ? 'death-wep-btn px-2.5 py-2 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 text-left transition'
      : 'death-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500'
  })
  document.querySelectorAll('.death-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const unlocked = isSecondaryUnlocked(sec, streak, dollCharges)
    const isSelected = sec === pendingLoadout.secondaryType
    btn.className = 'death-sec-btn px-2.5 py-1.5 rounded-lg border text-xs transition ' +
      (isSelected
        ? 'border-2 border-rose-400 bg-rose-500/20 font-extrabold text-white'
        : unlocked
          ? 'border-slate-600 bg-slate-900/90 font-semibold text-slate-200 hover:border-rose-400/60'
          : 'border-slate-800 bg-slate-950/40 font-semibold text-slate-500 opacity-55 cursor-not-allowed')
    ;(btn as HTMLButtonElement).disabled = !unlocked
  })
  const streakNote = document.getElementById('deathSecNote')
  if (streakNote) {
    const highest = SECONDARIES[getHighestUnlockedSecondary(streak, dollCharges)] ?? SECONDARIES.frag
    streakNote.textContent = `当前连死 ${streak} 次 · 已解锁至【${highest.icon} ${highest.name}】（获得击杀重置连死）`
  }

  document.querySelectorAll('.lobby-wep-btn').forEach((btn) => {
    const slot = Number(btn.getAttribute('data-wep') || 0)
    btn.className = slot === pendingLoadout.weaponIndex
      ? 'lobby-wep-btn px-2.5 py-2 rounded-xl border-2 border-amber-400 bg-amber-500/20 text-left transition'
      : 'lobby-wep-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500'
  })
  document.querySelectorAll('.lobby-sec-btn').forEach((btn) => {
    const sec = btn.getAttribute('data-sec') || 'frag'
    const unlocked = isSecondaryUnlocked(sec, streak, dollCharges)
    if (!unlocked) {
      btn.className = 'lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/40 text-left transition cursor-not-allowed opacity-60'
    } else {
      btn.className = sec === pendingLoadout.secondaryType
        ? 'lobby-sec-btn px-2.5 py-2 rounded-xl border-2 border-rose-400 bg-rose-500/20 text-left transition'
        : 'lobby-sec-btn px-2.5 py-2 rounded-xl border border-slate-700 bg-slate-950/70 text-left transition hover:border-slate-500'
    }
    ;(btn as HTMLButtonElement).disabled = !unlocked
  })
}

export function updateSpawnPointButtonsUI(): void {
  document.querySelectorAll('.spawn-select-btn').forEach((btn) => {
    const spId = btn.getAttribute('data-spawn') || 'base'
    let unlocked = spId === 'base'
    if (spId !== 'base') {
      const cp = world.capturePoints.find(c => c.id === spId)
      unlocked = isCapturePointSelectable(cp, localPlayer.team)
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
  const streak = localPlayer.deathStreak ?? 0
  const dollCharges = localPlayer.dollCharges ?? 0
  const unlocked = isSecondaryUnlocked(secType, streak, dollCharges)
  if (!unlocked) {
    if (secType === 'doll') {
      showToast(`🔒 替身人偶需连续阵亡 ${def.unlockStreak} 次解锁，或从战场特殊补给箱拾取充能！`)
    } else {
      showToast(`🔒 【${def.icon} ${def.name}】需连续阵亡 ${def.unlockStreak} 次解锁（当前连死 ${streak} 次）`)
    }
    return
  }
  if (secType === 'doll' && localPlayer.deployed && localPlayer.respawnTimer <= 0 && dollCharges > 0) {
    // 补给专属例外：持有充能时可在战中切换使用
    localPlayer.secondary = secType
    updateHudWeaponButtons()
    showToast(`🎎 已切换替身人偶（充能 ${dollCharges}）`)
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
  const topKdEl = document.getElementById('hudTopKdText')
  if (topKdEl) {
    const k = localPlayer.kills ?? 0
    const d = localPlayer.deaths ?? 0
    topKdEl.textContent = `${k}/${d}`
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
          : ' · 按一下读条')
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
  if (wNameEl) wNameEl.textContent = mounted ? '🎯 迫击炮' : wep.name
  const plateEl = document.getElementById('hudCurrentWeaponName')
  if (plateEl) plateEl.textContent = wep.shortName
  const secDef = SECONDARIES[localPlayer.secondary] ?? SECONDARIES.frag
  const secChipEl = document.getElementById('hudSecondaryChipText')
  if (secChipEl) {
    if (localPlayer.secondary === 'doll') {
      secChipEl.textContent = `🎎 替身人偶 [${localPlayer.dollCharges}]`
    } else if (localPlayer.secondary === 'frag') {
      secChipEl.textContent = `💣 手榴弹 [${localPlayer.fragCharges}/${world.config.fragMaxCharges}]`
    } else if (localPlayer.secondary === 'teleport' && (localPlayer.teleportTimer ?? 0) > 0) {
      secChipEl.textContent = `🌀 Teleport [读条 ${localPlayer.teleportTimer!.toFixed(1)}s]`
    } else {
      const cdStr = localPlayer.secondaryCooldown > 0 ? ` [${localPlayer.secondaryCooldown.toFixed(1)}s]` : ' [就绪]'
      secChipEl.textContent = `${secDef.icon} ${secDef.name}${cdStr}`
    }
  }
  const curAmmo = Math.max(0, Math.ceil(localPlayer.ammo[localPlayer.weaponIndex] ?? 0))
  const ammoEl = document.getElementById('currentAmmoText')
  const reserveEl = document.getElementById('reserveAmmoText')
  if (ammoEl) {
    ammoEl.textContent = mounted ? '∞' : String(curAmmo)
  }
  if (reserveEl) {
    reserveEl.textContent = mounted ? '' : String(localPlayer.reserveAmmo[localPlayer.weaponIndex] ?? 0)
  }

  const ammoPipsEl = document.getElementById('hudAmmoPips')
  if (ammoPipsEl) {
    if (wep.shellReload && wep.magSize <= 12) {
      let html = ''
      for (let i = 0; i < wep.magSize; i++) {
        const filled = i < curAmmo
        const isLoadingThis = localPlayer.reloading && i === curAmmo
        html += `<span class="h-1.5 flex-1 rounded-xs transition-all duration-75 ${
          filled
            ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.7)]'
            : isLoadingThis
              ? 'bg-cyan-400/80 animate-pulse'
              : 'bg-slate-800'
        }"></span>`
      }
      if (ammoPipsEl.getAttribute('data-sig') !== `shell:${curAmmo}:${localPlayer.reloading ? 1 : 0}:${wep.magSize}`) {
        ammoPipsEl.setAttribute('data-sig', `shell:${curAmmo}:${localPlayer.reloading ? 1 : 0}:${wep.magSize}`)
        ammoPipsEl.innerHTML = html
      }
    } else {
      const pct = Math.round(clamp((curAmmo / Math.max(1, wep.magSize)) * 100, 0, 100))
      const sig = `bar:${pct}`
      if (ammoPipsEl.getAttribute('data-sig') !== sig) {
        ammoPipsEl.setAttribute('data-sig', sig)
        ammoPipsEl.innerHTML = `<span class="block h-1.5 w-full rounded-full bg-slate-800 overflow-hidden"><span class="block h-full bg-gradient-to-r from-amber-400 to-cyan-300 transition-all duration-75" style="width:${pct}%"></span></span>`
      }
    }
  }

  const gOverlay = document.getElementById('grenadeCdOverlay')
  const gLabel = document.getElementById('hudGrenadeLabel')
  const gTitle = document.getElementById('hudSecondaryTitle')
  if (gTitle) {
    if (localPlayer.secondary === 'doll') {
      gTitle.textContent = `[G/右键] 替身人偶`
    } else if (localPlayer.secondary === 'frag') {
      gTitle.textContent = `[G/右键] 手榴弹`
    } else {
      gTitle.textContent = `[G/右键] ${secDef.name}`
    }
  }
  if (gOverlay && gLabel) {
    if (localPlayer.secondary === 'doll') {
      gOverlay.style.height = localPlayer.dollCharges > 0 ? '0%' : '100%'
      gLabel.textContent = localPlayer.dollCharges > 0 ? `🎎 就绪 ×${localPlayer.dollCharges}` : '🎎 无充能'
    } else if (localPlayer.secondary === 'frag') {
      const need = localPlayer.fragCharges >= world.config.fragMaxCharges
      if (need) {
        gOverlay.style.height = '0%'
        gLabel.textContent = `💣 就绪 (${localPlayer.fragCharges}/${world.config.fragMaxCharges})`
      } else {
        const pct = Math.min(100, (localPlayer.fragRechargeTimer / world.config.fragRechargeSeconds) * 100)
        gOverlay.style.height = (100 - pct) + '%'
        gLabel.textContent = `💣 ${(world.config.fragRechargeSeconds - localPlayer.fragRechargeTimer).toFixed(1)}s`
      }
    } else if (localPlayer.secondary === 'teleport' && (localPlayer.teleportTimer ?? 0) > 0) {
      const castTotal = Math.max(0.05, world.config.teleportCastTime ?? 0.35)
      const pct = clamp((1 - localPlayer.teleportTimer! / castTotal) * 100, 0, 100)
      gOverlay.style.height = (100 - pct) + '%'
      gLabel.textContent = `🌀 读条 ${Math.round(pct)}%`
    } else {
      if (localPlayer.secondaryCooldown <= 0) {
        gOverlay.style.height = '0%'
        gLabel.textContent = `${secDef.icon} 就绪`
      } else {
        const pct = clamp((localPlayer.secondaryCooldown / Math.max(0.1, secDef.cd)) * 100, 0, 100)
        gOverlay.style.height = pct + '%'
        gLabel.textContent = `${secDef.icon} ${localPlayer.secondaryCooldown.toFixed(1)}s`
      }
    }
  }

  const reloadWrap = document.getElementById('reloadProgressWrap')
  const reloadBar = document.getElementById('reloadProgressBar')
  const reloadLabel = document.getElementById('reloadProgressLabel')
  const reloadPctEl = document.getElementById('reloadProgressPct')
  const reloadDockBottomBar = document.getElementById('reloadDockBottomBar')
  if (reloadWrap && reloadBar) {
    if (localPlayer.reloading) {
      reloadWrap.classList.remove('invisible', 'opacity-0', 'translate-y-1')
      reloadWrap.classList.add('opacity-100', 'translate-y-0')
      const wep2 = WEAPONS[localPlayer.weaponIndex]
      if (wep2.shellReload) {
        const perShell = wep2.reloadTime / Math.max(1, wep2.magSize)
        const pct = localPlayer.fireCooldown > 0
          ? 0
          : clamp(100 * (1 - localPlayer.reloadTimer / Math.max(1e-6, perShell)), 0, 100)
        reloadBar.style.width = pct + '%'
        if (reloadDockBottomBar) reloadDockBottomBar.style.width = clamp(((curAmmo + pct / 100) / Math.max(1, wep2.magSize)) * 100, 0, 100) + '%'
        if (reloadLabel) reloadLabel.textContent = `逐发装填 ${curAmmo}/${wep2.magSize}`
        if (reloadPctEl) reloadPctEl.textContent = localPlayer.fireCooldown > 0 ? '泵动' : `${Math.round(pct)}%`
      } else {
        const pct = clamp(100 * (1 - localPlayer.reloadTimer / Math.max(1e-6, wep2.reloadTime)), 0, 100)
        reloadBar.style.width = pct + '%'
        if (reloadDockBottomBar) reloadDockBottomBar.style.width = pct + '%'
        if (reloadLabel) reloadLabel.textContent = `换弹中 · ${wep2.shortName}`
        if (reloadPctEl) reloadPctEl.textContent = `${Math.round(pct)}%`
      }
    } else {
      reloadWrap.classList.add('invisible', 'opacity-0', 'translate-y-1')
      reloadWrap.classList.remove('opacity-100', 'translate-y-0')
      if (reloadDockBottomBar) reloadDockBottomBar.style.width = '0%'
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
    for (const cp of world.capturePoints) {
      if (wrapDist(localPlayer.pos.x, localPlayer.pos.y, cp.x, cp.y) < Math.max(140, world.config.captureRadius + 30)) {
        if (isCapturePointSelectable(cp, localPlayer.team)) {
          if (localPlayer.selectedSpawnId === cp.id || pendingLoadout.spawnPointId === cp.id) {
            promptMsg = `✅ 已选中【${cp.name}】作为复活点（阵亡后将在此处复活）`
          } else {
            promptMsg = `🚩 按 [E] 或点击此处选中【${cp.name}】作为复活点`
          }
        } else {
          promptMsg = `🚩 正在占领【${cp.name}】(${Math.round(cp.progress)}%) · 占领后可按 [E] 选为复活点`
        }
        break
      }
    }
    if (!promptMsg) {
      for (const m of world.mortars) {
        if (m.operatorId === null && wrapDist(localPlayer.pos.x, localPlayer.pos.y, m.x, m.y) < 115) {
          promptMsg = `🔥 按 [E] 或点击此处操控【${m.name}】`
          break
        }
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
