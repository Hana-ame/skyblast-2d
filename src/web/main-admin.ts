// web/main-admin.ts —— 数值调整后台：编辑武器/全局/物理参数，保存覆盖并应用到游戏
import { WEAPONS, DEFAULT_CONFIG } from '../core/weapons.ts'
import type { WeaponDef, GameConfig } from '../core/weapons.ts'
import { getPhysicsParams, setPhysicsParams } from '../core/sim/physics.ts'
import {
  BALANCE_KEY, LEGACY_BALANCE_KEY, sanitizeOverrides, applyWeaponOverrides, applyConfigOverrides,
  WEAPON_NUMERIC_KEYS, WEAPON_BOOL_KEYS, CONFIG_NUMERIC_KEYS, CONFIG_BOOL_KEYS,
} from '../core/balanceOverrides.ts'
import type { BalanceOverrides } from '../core/balanceOverrides.ts'

const app = document.getElementById('app') as HTMLElement
const statusEl = document.getElementById('status') as HTMLElement
const jsonBox = document.getElementById('jsonBox') as HTMLTextAreaElement

// 基准默认值（用于 diff）
const baseWeapons = JSON.parse(JSON.stringify(WEAPONS)) as WeaponDef[]
const baseConfig = { ...DEFAULT_CONFIG }
const basePhysics = { ...getPhysicsParams() }

// 载入已保存覆盖，显示当前生效值
let saved: BalanceOverrides | null = null
try {
  const raw = localStorage.getItem(BALANCE_KEY) ?? localStorage.getItem(LEGACY_BALANCE_KEY)
  if (raw) saved = sanitizeOverrides(JSON.parse(raw))
} catch { /* ignore */ }
if (saved?.weapons) applyWeaponOverrides(saved.weapons)
const configView: GameConfig = { ...DEFAULT_CONFIG }
applyConfigOverrides(configView, saved?.config)
const physicsView: Record<string, number> = { ...basePhysics, ...(saved?.physics ?? {}) }
setPhysicsParams(physicsView)

const numInput = (value: number, step = 'any', onInput: (v: number) => void): HTMLInputElement => {
  const el = document.createElement('input')
  el.type = 'number'
  el.step = step
  el.value = String(value)
  el.addEventListener('input', () => {
    const n = Number(el.value)
    if (Number.isFinite(n)) onInput(n)
  })
  return el
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  const row = document.createElement('label')
  const span = document.createElement('span')
  span.textContent = labelText
  row.append(span, input)
  return row
}

// ── 武器 ──
const weaponsSection = document.createElement('section')
const h2w = document.createElement('h2')
h2w.textContent = `武器数值（${WEAPONS.length} 把）`
weaponsSection.append(h2w)
const grid = document.createElement('div')
grid.className = 'wep-grid'
WEAPONS.forEach((wep, idx) => {
  const card = document.createElement('div')
  card.className = 'card'
  const title = document.createElement('h3')
  title.textContent = `${wep.id}. ${wep.name}${wep.isSupplyOnly ? '（补给）' : ''}`
  card.append(title)
  const fields = document.createElement('div')
  fields.className = 'fields'
  for (const key of WEAPON_NUMERIC_KEYS) {
    const v = wep[key] as number | undefined
    if (v === undefined) continue
    fields.append(field(String(key), numInput(v, 'any', (n) => { (wep as unknown as Record<string, number>)[key as string] = n })))
  }
  for (const key of WEAPON_BOOL_KEYS) {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !!wep[key]
    cb.addEventListener('change', () => { (wep as unknown as Record<string, boolean>)[key as string] = cb.checked })
    fields.append(field(String(key), cb))
  }
  card.append(fields)
  grid.append(card)
  void idx
})
weaponsSection.append(grid)
app.append(weaponsSection)

// ── 全局配置 ──
const configSection = document.createElement('section')
const h2c = document.createElement('h2')
h2c.textContent = '全局配置'
configSection.append(h2c)
const cfields = document.createElement('div')
cfields.className = 'fields'
for (const key of CONFIG_NUMERIC_KEYS) {
  const v = configView[key] as number | undefined
  if (v === undefined) continue
  cfields.append(field(String(key), numInput(v, 'any', (n) => { (configView as unknown as Record<string, number>)[key as string] = n })))
}
for (const key of CONFIG_BOOL_KEYS) {
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = !!configView[key]
  cb.addEventListener('change', () => { (configView as unknown as Record<string, boolean>)[key as string] = cb.checked })
  cfields.append(field(String(key), cb))
}
configSection.append(cfields)
app.append(configSection)

// ── 物理参数 ──
const physSection = document.createElement('section')
const h2p = document.createElement('h2')
h2p.textContent = '物理参数'
physSection.append(h2p)
const pfields = document.createElement('div')
pfields.className = 'fields'
for (const key of Object.keys(basePhysics)) {
  pfields.append(field(key, numInput(physicsView[key], 'any', (n) => { physicsView[key] = n; setPhysicsParams(physicsView) })))
}
physSection.append(pfields)
app.append(physSection)

// ── 构建覆盖（仅保存与默认值不同的字段）──
function buildOverrides(): BalanceOverrides {
  const out: BalanceOverrides = {}
  const weapons: NonNullable<BalanceOverrides['weapons']> = {}
  WEAPONS.forEach((wep, idx) => {
    const base = baseWeapons[idx]
    const patch: Record<string, number | boolean | string> = {}
    for (const key of WEAPON_NUMERIC_KEYS) {
      const cur = wep[key] as number | undefined
      if (cur === undefined) continue
      if (cur !== (base[key] as number | undefined)) patch[key as string] = cur
    }
    for (const key of WEAPON_BOOL_KEYS) {
      const cur = !!wep[key]
      if (cur !== !!base[key]) patch[key as string] = cur
    }
    if (Object.keys(patch).length > 0) weapons[String(wep.id)] = patch
  })
  if (Object.keys(weapons).length > 0) out.weapons = weapons

  const cfg: Record<string, number | boolean> = {}
  for (const key of CONFIG_NUMERIC_KEYS) {
    const cur = configView[key] as number | undefined
    if (cur !== undefined && cur !== (baseConfig[key] as number | undefined)) cfg[key as string] = cur
  }
  for (const key of CONFIG_BOOL_KEYS) {
    if (!!configView[key] !== !!baseConfig[key]) cfg[key as string] = !!configView[key]
  }
  if (Object.keys(cfg).length > 0) out.config = cfg as Partial<GameConfig>

  const phys: Record<string, number> = {}
  for (const key of Object.keys(basePhysics)) {
    const baseVal = (basePhysics as Record<string, number>)[key]
    if (physicsView[key] !== baseVal) phys[key] = physicsView[key]
  }
  if (Object.keys(phys).length > 0) out.physics = phys
  return out
}

function setStatus(msg: string): void {
  if (statusEl) statusEl.textContent = msg
}

function save(): BalanceOverrides | null {
  const ov = buildOverrides()
  const hasAny = !!ov.weapons || !!ov.config || !!ov.physics
  if (hasAny) {
    localStorage.setItem(BALANCE_KEY, JSON.stringify(ov))
    localStorage.setItem(LEGACY_BALANCE_KEY, JSON.stringify(ov))
  } else {
    localStorage.removeItem(BALANCE_KEY)
    localStorage.removeItem(LEGACY_BALANCE_KEY)
  }
  setStatus(hasAny ? '已保存覆盖（下次启动游戏生效）' : '与默认值一致，已清除覆盖')
  return hasAny ? ov : null
}

document.getElementById('btnSave')?.addEventListener('click', () => { save() })
document.getElementById('btnApply')?.addEventListener('click', () => { save(); window.location.href = './index.html' })
document.getElementById('btnGame')?.addEventListener('click', () => { window.location.href = './index.html' })
document.getElementById('btnReset')?.addEventListener('click', () => {
  localStorage.removeItem(BALANCE_KEY)
  localStorage.removeItem(LEGACY_BALANCE_KEY)
  localStorage.removeItem('pvp-physics-params-v2')
  setStatus('已恢复默认，正在刷新…')
  window.location.reload()
})
document.getElementById('btnExport')?.addEventListener('click', () => {
  const ov = buildOverrides()
  jsonBox.style.display = 'block'
  jsonBox.value = JSON.stringify(ov, null, 2)
  jsonBox.focus(); jsonBox.select()
  setStatus('已生成覆盖 JSON（可直接复制）')
})
document.getElementById('btnImport')?.addEventListener('click', () => {
  jsonBox.style.display = 'block'
  const raw = jsonBox.value.trim()
  if (!raw) { setStatus('请先把 JSON 粘贴到下方文本框，再点一次导入'); return }
  try {
    const ov = sanitizeOverrides(JSON.parse(raw))
    if (!ov) { setStatus('JSON 无效（没有可识别的覆盖）'); return }
    localStorage.setItem(BALANCE_KEY, JSON.stringify(ov))
    setStatus('已导入覆盖，正在刷新…')
    window.location.reload()
  } catch {
    setStatus('JSON 解析失败')
  }
})
