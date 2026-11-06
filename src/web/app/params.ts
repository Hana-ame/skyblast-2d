// web/app/params.ts —— 参数调校台（滑块绑定 + 回显）
import { world } from './context.ts'
import { getPhysicsParams, setPhysicsParams } from '../../core/sim/physics.ts'
import { WEAPONS } from '../../core/weapons.ts'

// ── 参数调校台 ──
export const paramState = { weaponIdx: 0 }

export function syncParamsToUI(): void {
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

  const w = WEAPONS[paramState.weaponIdx] ?? WEAPONS[0]
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
    btn.className = idx === paramState.weaponIdx
      ? 'param-wep-tab px-2 py-1 rounded bg-amber-500 text-slate-950 font-extrabold text-[11px]'
      : 'param-wep-tab px-2 py-1 rounded bg-slate-950 text-slate-300 font-semibold text-[11px] border border-slate-700'
  })
}

export function bindRangeParam(inputId: string, valId: string, suffix: string, applyFn: (v: number) => void): void {
  const el = document.getElementById(inputId) as HTMLInputElement | null
  if (!el) return
  el.addEventListener('input', () => {
    const v = Number(el.value)
    const vEl = document.getElementById(valId)
    if (vEl) vEl.textContent = v + suffix
    applyFn(v)
  })
}

