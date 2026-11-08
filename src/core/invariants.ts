// core/invariants.ts —— 数据一致性/布局校验（防“改了这个坏那个”）
// 供测试使用；数值改动后若违反约定，`npm test` 会直接红，而不是等到线上才发现。
import { WEAPONS, SECONDARIES, SECONDARY_UNLOCK_ORDER, DEFAULT_CONFIG } from './weapons.ts'
import { SPAWN_POINTS, JUMP_PADS, AMMO_SPOTS } from './sim/world.ts'
import type { World } from './sim/world.ts'
import { WORLD_W, WORLD_H } from './wrap.ts'

export interface Violation { code: string; message: string }

/** 武器数值约定（每把武器之间/自身的硬性规则，改动数值必须同步这里） */
export function weaponViolations(): Violation[] {
  const out: Violation[] = []
  const add = (code: string, message: string): void => { out.push({ code, message }) }

  for (const w of WEAPONS) {
    if (w.damage < 0) add('weapon.damage', `${w.name} damage < 0`)
    if (w.pellets < 1) add('weapon.pellets', `${w.name} pellets < 1`)
    if (w.magSize < 1) add('weapon.mag', `${w.name} magSize < 1`)
    if (w.maxReserve < 0) add('weapon.reserve', `${w.name} maxReserve < 0`)
    if (w.reloadTime <= 0) add('weapon.reload', `${w.name} reloadTime <= 0`)
    if (w.fireDelay < 0) add('weapon.firedelay', `${w.name} fireDelay < 0`)
    if (w.fovMult !== undefined && (w.fovMult < 1 || w.fovMult > 2)) add('weapon.fov', `${w.name} fovMult out of [1,2]`)
    for (const k of ['moveSpeedMult', 'fuelMult', 'ascendMult'] as const) {
      const v = w[k]
      if (v !== undefined && (v < 0 || v > 5)) add('weapon.mult', `${w.name} ${k} out of [0,5]`)
    }
    if (w.falloffStart !== undefined && w.falloffEnd !== undefined) {
      if (w.falloffStart >= w.falloffEnd) add('weapon.falloff', `${w.name} falloffStart >= falloffEnd`)
      if (w.falloffMin !== undefined && (w.falloffMin < 0 || w.falloffMin > 1)) add('weapon.falloffmin', `${w.name} falloffMin out of [0,1]`)
    }
    if (w.chargeSeconds !== undefined && w.chargeSeconds < 0) add('weapon.charge', `${w.name} chargeSeconds < 0`)
    if (w.damagePerSecond !== undefined && w.damagePerSecond < 0) add('weapon.dps', `${w.name} damagePerSecond < 0`)
    if (w.ammoPerSecond !== undefined && w.ammoPerSecond <= 0) add('weapon.aps', `${w.name} ammoPerSecond <= 0`)
  }

  // 副手平衡性阶梯解锁顺序硬性约定：frag(0) → obstacle(1) → shield(2) → teleport(3) → doll(4)
  const EXPECTED_SEC_ORDER = ['frag', 'obstacle', 'shield', 'teleport', 'doll']
  if (SECONDARY_UNLOCK_ORDER.join(',') !== EXPECTED_SEC_ORDER.join(',')) {
    add('secondary.order', `SECONDARY_UNLOCK_ORDER "${SECONDARY_UNLOCK_ORDER.join(',')}" !== "${EXPECTED_SEC_ORDER.join(',')}"`)
  }
  if (SECONDARIES['mine']) {
    add('secondary.mine', 'mine should be removed from SECONDARIES')
  }
  if (DEFAULT_CONFIG.shieldHp !== 100) {
    add('config.shieldHp', `DEFAULT_CONFIG.shieldHp=${DEFAULT_CONFIG.shieldHp} expected 100`)
  }
  EXPECTED_SEC_ORDER.forEach((secId, idx) => {
    const def = SECONDARIES[secId]
    if (!def) { add('secondary.missing', `missing secondary "${secId}"`); return }
    if (def.unlockStreak !== idx) add('secondary.streak', `secondary "${secId}" unlockStreak=${def.unlockStreak} expected ${idx}`)
    if (def.cd <= 0) add('secondary.cd', `secondary "${secId}" cd <= 0`)
  })

  const byName = (n: string) => WEAPONS.find(w => w.name === n)
  const rifle = byName('突击步枪')
  const m249 = byName('M249')
  const pistol = byName('手枪')
  const gravity = byName('引力枪')
  const shotgun = byName('霰弹枪')
  const sniper = byName('狙击步枪')
  const laser = byName('高斯枪')
  const rocket = byName('火箭筒')
  const smg = byName('冲锋枪')

  // 武器名必须与当前命名一致（防止 UI/文档里再出现旧名「激光」「加特林」）
  const EXPECTED_NAMES = ['霰弹枪', '突击步枪', '狙击步枪', '火箭筒', '高斯枪', 'M249', '引力枪', '手枪', '冲锋枪']
  EXPECTED_NAMES.forEach((name, idx) => {
    const w = WEAPONS[idx]
    if (!w) { add('rule.name', `missing weapon #${idx} (${name})`); return }
    if (w.name !== name) add('rule.name', `weapon #${idx} name "${w.name}" should be "${name}"`)
  })

  // 用户明确要求的跨武器规则
  if (rifle && m249 && m249.damage !== rifle.damage) add('rule.m249dmg', 'M249 伤害必须等于突击步枪')
  if (rifle && (rifle.magSize !== 30 || rifle.maxReserve !== 90)) add('rule.riflemag', '突击步枪弹药必须为 30/90')
  if (pistol && gravity && gravity.damage !== pistol.damage) add('rule.gravitydmg', '引力枪伤害必须等于手枪')
  if (pistol && smg && smg.damage !== pistol.damage) add('rule.smgdmg', '冲锋枪伤害必须等于手枪')
  if (smg && (smg.magSize !== 30 || smg.maxReserve !== 150)) add('rule.smgmag', '冲锋枪弹药必须为 30/150')
  if (pistol && pistol.magSize !== 12) add('rule.pistolmag', '手枪弹匣必须 12')
  if (pistol && pistol.maxReserve !== 60) add('rule.pistolreserve', '手枪备弹必须 60')
  if (rifle && Math.abs((rifle.fireDelay ?? 0) - 0.12) > 1e-9) add('rule.riflefire', '突击步枪射击间隔必须 0.12s')
  if (rifle && rifle.damage !== 37) add('rule.rifledmg', '突击步枪命中主体伤害必须 37')
  if (rifle && rifle.grazeDamageMin !== 30) add('rule.riflegraze', '突击步枪擦边最低伤害必须 30（分级 30~37）')
  if (m249 && m249.grazeDamageMin !== 30) add('rule.m249graze', 'M249 擦边最低伤害必须 30（与突击步枪同步）')
  if (rocket && (rocket.magSize !== 1 || rocket.maxReserve !== 20)) add('rule.rocketmag', '火箭筒必须 1/20 弹匣')
  if (rocket && rocket.fireDelay !== 0) add('rule.rocketfire', '火箭筒射击间隔必须 0')
  if (rocket && rocket.speed !== 780) add('rule.rocketspeed', '火箭筒弹速必须 780（520 × 1.5）')
  if (rocket && rocket.damage !== 160) add('rule.rocketdmg', '火箭筒爆炸伤害必须 160')
  if (rocket && rocket.terrainRadius !== 124) add('rule.rocketradius', '火箭筒爆炸范围必须保持 124（本次只改伤害与衰减）')
  if (rocket && (rocket.blastFalloffExponent ?? 1) <= 1) add('rule.rocketblast', '火箭筒爆炸衰减必须比线性更陡（blastFalloffExponent > 1）')
  if (sniper && (sniper.damage !== 137 || sniper.grazeDamageMin !== 99)) {
    add('rule.sniperedge', '狙击必须做连续分级：正中 137、擦边 99（中间插值）')
  }
  if (sniper && sniper.farRange === undefined) {
    add('rule.sniperfar', '狙击必须有远距离衰减（farRange/farDamage）')
  }
  if (shotgun && shotgun.pellets !== 8) add('rule.shotgunpellets', '霰弹必须 8 弹丸')
  if (shotgun && shotgun.headshotMult !== 1) add('rule.shotgunhead', '霰弹无爆头加成')
  if (shotgun && Math.abs((shotgun.fireDelay ?? 0) - 0.58) > 1e-9) add('rule.shotgunfire', '霰弹射击间隔必须为 0.58s（略微提高射速）')
  if (laser) {
    const dur = laser.magSize / (laser.ammoPerSecond ?? 1)
    if (Math.abs(dur - 4) > 1e-9) add('rule.laserdur', '高斯枪单匣必须连续 4 秒')
    if (laser.reloadTime !== 3) add('rule.laserreload', '高斯枪换弹必须 3 秒（平衡性补丁：6s 减半）')
    if (laser.damagePerSecond !== 90) add('rule.laserdps', '高斯枪 DPS 必须为 90（减半）')
    if ((laser.fovMult ?? 1) !== 1) add('rule.laserfov', '高斯枪视野必须正常（1.0）')
    if (!laser.beam) add('rule.laserbeam', '高斯枪必须是持续光束')
    if (laser.bounces !== 2) add('rule.laserbounces', '高斯枪必须反射 2 次')
    if (!laser.selfDamage) add('rule.laserself', '高斯枪必须开启自伤')
  }
  if (smg && Math.abs((smg.fireDelay ?? 0) - 0.05) > 1e-9) add('rule.smgfire', '冲锋枪射击间隔必须 0.05s')
  if (pistol && pistol.moveSpeedMult !== 1.5) add('rule.pistolmove', '手枪移速必须 1.5x')
  if (pistol && pistol.fuelMult !== 2) add('rule.pistolfuel', '手枪飞行容量必须 2x')
  if (pistol && pistol.ascendMult !== 1.25) add('rule.pistolascend', '手枪升空速度必须 1.25x')
  if (bazookaCheck()) add('rule.bazooka', '火箭筒移速/飞行/升空必须都是 0.7')

  return out

  function bazookaCheck(): boolean {
    return !rocket || rocket.moveSpeedMult !== 0.7 || rocket.fuelMult !== 0.7 || rocket.ascendMult !== 0.7
  }
}

/** 布局约定：默认地图下，所有地标都必须在空地上、在世界范围内；跳台必须贴地且上方无遮挡 */
export function layoutViolations(world: World, opts: { skipPads?: boolean } = {}): Violation[] {
  const out: Violation[] = []
  const add = (code: string, message: string): void => { out.push({ code, message }) }
  const inBounds = (x: number, y: number): boolean => x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H

  const points: { label: string; x: number; y: number; skipSolid?: boolean }[] = []
  for (const sp of SPAWN_POINTS) points.push({ label: `spawn:${sp.team}`, x: sp.x, y: sp.y })
  for (const c of world.capturePoints) points.push({ label: `cp:${c.id}`, x: c.x, y: c.y })
  for (const m of world.mortars) points.push({ label: `mortar:${m.id}`, x: m.x, y: m.y })
  for (const t of world.watchtowers) points.push({ label: `tower:${t.id}`, x: t.x, y: t.y })
  for (const wp of world.warpPortals) points.push({ label: `warp:${wp.id}`, x: wp.x, y: wp.y })
  for (const cr of world.supplyCrates) points.push({ label: `crate:${cr.id}`, x: cr.x, y: cr.y })
  for (const ap of world.ammoPacks) points.push({ label: `ammo:${ap.id}`, x: ap.x, y: ap.y })
  for (const mine of world.landmines) points.push({ label: `mine:${mine.id}`, x: mine.pos.x, y: mine.pos.y })
  for (const ob of world.obstacles) points.push({ label: `obstacle:${ob.id}`, x: ob.x, y: ob.y, skipSolid: true })
  for (const ammo of AMMO_SPOTS) points.push({ label: 'ammo:spot', x: ammo.x, y: ammo.y })
  for (const p of JUMP_PADS) points.push({ label: 'jumpPad', x: p.x, y: p.y - 2 })

  for (const pt of points) {
    if (!inBounds(pt.x, pt.y)) add('layout.bounds', `${pt.label} out of world bounds (${pt.x},${pt.y})`)
    if (!pt.skipSolid && world.terrain.isSolidAt(pt.x, pt.y)) add('layout.solid', `${pt.label} is inside solid terrain (${pt.x},${pt.y})`)
  }
  if (!opts.skipPads) {
    for (const p of JUMP_PADS) {
      if (!world.terrain.isSolidAt(p.x, p.y + 12)) add('layout.pad.ground', `jumpPad ${p.x} has no ground below`)
      if (world.terrain.isSolidAt(p.x, p.y - 8)) add('layout.pad.air', `jumpPad ${p.x} has solid above`)
    }
  }
  const cpIds = world.capturePoints.map(c => c.id)
  if (new Set(cpIds).size !== cpIds.length) add('layout.cpid', 'capture point ids duplicated')
  return out
}

/** 一次性校验（测试入口）：返回全部违规项 */
export function allViolations(world: World): Violation[] {
  return [...weaponViolations(), ...layoutViolations(world)]
}
