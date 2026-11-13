// tests/balance-keys.test.ts —— 调参后台「可调参数」必须覆盖真实字段，且能真正保存生效
//
// 历史 bug（用户报「设置里的可调参数怎么不全」）：
//   sanitizeOverrides 的 physics 白名单写死了 6 个 key，其中 jumpVelocity / jetpackThrust
//   根本不是真实字段名（真名 jumpImpulse / jetpackAccel），而 mass / maxFall /
//   jetpackDrain / jetpackRecharge 完全没列进去。
//   后果：后台能调到这些项、点保存也不报错，但清洗时被静默丢弃 → 重启游戏不生效。
//   同一类缺口在 weapons（机制开关）与 config（地雷/空袭/占点/补给）上也存在。
//
// 这里用「真实默认值对象」反向核对白名单，任何一边新增字段忘了登记都会立刻失败。

import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import {
  WEAPON_NUMERIC_KEYS, WEAPON_BOOL_KEYS,
  CONFIG_NUMERIC_KEYS, CONFIG_BOOL_KEYS,
  PHYSICS_KEYS, sanitizeOverrides,
  applyWeaponOverrides, applyConfigOverrides,
} from '../src/core/balanceOverrides.ts'
import { WEAPONS, DEFAULT_CONFIG } from '../src/core/weapons.ts'
import { getPhysicsParams, resetPhysicsParams, setPhysicsParams } from '../src/core/sim/physics.ts'

/** 不应作为「可调数值/机制开关」暴露的标识类字段 */
const NON_TUNABLE_WEAPON_KEYS = new Set(['id', 'name', 'shortName', 'color', 'traitDesc', 'isSupplyOnly'])
const NON_TUNABLE_CONFIG_KEYS = new Set<string>()

test('调参白名单·物理参数：必须与 PhysicsParams 的真实字段完全一致', () => {
  const real = Object.keys(getPhysicsParams())
  assert.deepEqual(
    [...PHYSICS_KEYS].sort(), [...real].sort(),
    `PHYSICS_KEYS 与 PhysicsParams 字段不一致。\n  只在上线清单里: ${[...PHYSICS_KEYS].filter(k => !real.includes(k)).join(', ') || '无'}\n  真实字段里缺: ${real.filter(k => !(PHYSICS_KEYS as readonly string[]).includes(k)).join(', ') || '无'}`,
  )
})

test('调参白名单·物理参数：历史上写错的 key 不得再出现', () => {
  const real = new Set(Object.keys(getPhysicsParams()))
  for (const bogus of ['jumpVelocity', 'jetpackThrust']) {
    assert.ok(!real.has(bogus), `${bogus} 不是真实字段，不应存在`)
    assert.ok(!(PHYSICS_KEYS as readonly string[]).includes(bogus), `${bogus} 不得出现在 PHYSICS_KEYS 里`)
  }
  // 真名必须在
  for (const realKey of ['jumpImpulse', 'jetpackAccel']) {
    assert.ok((PHYSICS_KEYS as readonly string[]).includes(realKey), `${realKey} 必须可调`)
  }
})

test('调参白名单·武器：所有数值/布尔字段都必须可调（标识类除外）', () => {
  const listed = new Set<string>([...WEAPON_NUMERIC_KEYS, ...WEAPON_BOOL_KEYS])
  /** 至少有一把武器定义了该字段（数值或布尔），即视为可调候选 */
  const candidates = new Set<string>()
  for (const w of WEAPONS) {
    for (const [k, v] of Object.entries(w)) {
      const t = typeof v
      if (t === 'number' || t === 'boolean') candidates.add(k)
    }
  }
  const missing = [...candidates].filter(k => !NON_TUNABLE_WEAPON_KEYS.has(k) && !listed.has(k))
  assert.deepEqual(missing, [], `武器字段未纳入可调: ${missing.join(', ')}`)
})

test('调参白名单·config：所有数值/布尔字段都必须可调', () => {
  const listed = new Set<string>([...CONFIG_NUMERIC_KEYS, ...CONFIG_BOOL_KEYS])
  const candidates = Object.entries(DEFAULT_CONFIG)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')
    .map(([k]) => k)
    .filter(k => !NON_TUNABLE_CONFIG_KEYS.has(k))
  const missing = candidates.filter(k => !listed.has(k))
  assert.deepEqual(missing, [], `config 字段未纳入可调: ${missing.join(', ')}`)
})

test('调参往返·物理参数：后台设的每个值都必须能保存并真正应用到运行时', () => {
  const patch: Record<string, number> = {
    mass: 2.5, gravity: 900, moveSpeed: 420, jumpImpulse: 520, maxFall: 900,
    jetpackAccel: 5000, jetpackMaxUp: 320, jetpackFuel: 1.6, jetpackDrain: 0.4, jetpackRecharge: 1.1,
  }
  const clean = sanitizeOverrides({ physics: patch })
  assert.ok(clean?.physics, 'physics 覆盖必须被保留')
  assert.equal(Object.keys(clean!.physics!).length, PHYSICS_KEYS.length, '所有物理参数都应通过清洗')

  resetPhysicsParams()
  try {
    setPhysicsParams({ ...getPhysicsParams(), ...clean!.physics })
    const P: Record<string, number> = { ...getPhysicsParams() }
    for (const k of PHYSICS_KEYS) {
      assert.ok(Math.abs(P[k] - patch[k]) < 1e-9, `${k} 应生效为 ${patch[k]}，实际 ${P[k]}`)
    }
  } finally {
    resetPhysicsParams()
  }
})

test('调参往返·散布/射速/飞行速度/弹匣容量/移动倍率 都能保存生效', () => {
  // 用户点名的五项
  const patch = { spread: 0.35, fireDelay: 0.3, speed: 1200, magSize: 12, moveSpeedMult: 1.3 }
  const clean = sanitizeOverrides({ weapons: { 0: patch } })
  assert.ok(clean?.weapons?.['0'], '武器覆盖必须被保留')
  for (const [k, v] of Object.entries(patch)) {
    assert.equal((clean!.weapons!['0'] as Record<string, number>)[k], v, `${k} 应通过清洗`)
  }
  applyWeaponOverrides(clean!.weapons)
  const w0 = WEAPONS[0] as unknown as Record<string, number>
  for (const [k, v] of Object.entries(patch)) {
    assert.equal(w0[k], v, `${k} 应生效为 ${v}`)
  }
})

test('调参往返·机制开关（逐发装填等）能保存生效', () => {
  const clean = sanitizeOverrides({ weapons: { 0: { shellReload: false } } })
  assert.equal(clean!.weapons!['0']!.shellReload, false, 'shellReload 应通过清洗')
  applyWeaponOverrides(clean!.weapons)
  assert.equal(WEAPONS[0].shellReload, false, 'shellReload 应生效')
})

test('调参往返·config 新增项（地雷/空袭/占点/补给）能保存生效', () => {
  const patch = {
    mineDamage: 150, mineTriggerRadius: 60, mineRespawnTime: 9,
    airstrikeDamage: 120, airstrikeRadius: 100, mortarCooldown: 1.8,
    pistolDamage: 30, pistolHeadshotMult: 2.5,
    captureRadius: 160, captureRate: 35,
    ammoPackInterval: 5, ammoPackMaxActive: 12, supplyRespawnTime: 18,
  }
  const clean = sanitizeOverrides({ config: patch })
  assert.ok(clean?.config, 'config 覆盖必须被保留')
  const target = { ...DEFAULT_CONFIG } as Record<string, unknown>
  applyConfigOverrides(target as never, clean!.config)
  for (const [k, v] of Object.entries(patch)) {
    assert.equal(target[k], v, `${k} 应生效为 ${v}，实际 ${target[k]}`)
  }
})

test('游戏内调参面板·逐武器「移动倍率 / 飞行容量倍率」两个入口存在且已接线', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')
  const bindings = readFileSync(new URL('../src/web/input/bindings.ts', import.meta.url), 'utf8')
  const params = readFileSync(new URL('../src/web/app/params.ts', import.meta.url), 'utf8')

  // ① 两个滑块都要在弹窗里（用户报的正是"没有入口"）
  for (const id of ['paramWepMove', 'paramWepFuel']) {
    assert.ok(html.includes(`id="${id}"`), `参数面板缺少滑块 ${id}`)
  }
  // ② 都要有数值回显元素
  for (const vid of ['valWepMove', 'valWepFuel']) {
    assert.ok(html.includes(`id="${vid}"`), `参数面板缺少回显 ${vid}`)
  }
  // ③ 都要绑定到对应的 WeaponDef 字段（按当前选中的武器）
  assert.ok(
    /bindRangeParam\('paramWepMove',\s*'valWepMove'[\s\S]{0,200}?\.moveSpeedMult\s*=/.test(bindings),
    'paramWepMove 必须写入 WEAPONS[paramState.weaponIdx].moveSpeedMult',
  )
  assert.ok(
    /bindRangeParam\('paramWepFuel',\s*'valWepFuel'[\s\S]{0,200}?\.fuelMult\s*=/.test(bindings),
    'paramWepFuel 必须写入 WEAPONS[paramState.weaponIdx].fuelMult',
  )
  // ④ 切换武器时要回显当前武器的值（缺省按 1x，不能停在 0）
  assert.ok(/setVal\('paramWepMove'[\s\S]{0,120}?moveSpeedMult \?\? 1/.test(params),
    'syncParamsToUI 必须回显 moveSpeedMult（缺省 1）')
  assert.ok(/setVal\('paramWepFuel'[\s\S]{0,120}?fuelMult \?\? 1/.test(params),
    'syncParamsToUI 必须回显 fuelMult（缺省 1）')
})

test('逐武器「移动倍率 / 飞行容量倍率」确实进入物理计算（不是死字段）', () => {
  const world = readFileSync(new URL('../src/core/sim/world.ts', import.meta.url), 'utf8')
  // 移速：move * moveSpeed * moveSpeedMult
  assert.ok(/w\.move\s*\*\s*getPhysicsParams\(\)\.moveSpeed\s*\*\s*\(wepCur\.moveSpeedMult \?\? 1\)/.test(world),
    'world.ts 必须用 moveSpeedMult 缩放水平移速')
  // 燃料上限：jetpackFuel * fuelMult
  assert.ok(/fuelMax = getPhysicsParams\(\)\.jetpackFuel \* \(wepCur\.fuelMult \?\? 1\)/.test(world),
    'world.ts 必须用 fuelMult 缩放飞行容量上限')
})
