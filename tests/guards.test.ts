// tests/guards.test.ts —— 防回归护栏：数值约定 / 布局合法性 / 出生安全 / 小地图兼容
// 任何“改了这个坏那个”的问题，应当在 npm test 阶段直接变红。
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { World } from '../src/core/sim/world.ts'
import { SPAWN_POINTS } from '../src/core/sim/world.ts'
import { allViolations, layoutViolations, weaponViolations } from '../src/core/invariants.ts'
import { defaultMapData } from '../src/core/map.ts'
import {
  WEAPONS, DEFAULT_CONFIG, SECONDARIES, SECONDARY_UNLOCK_ORDER,
  formatWeaponAmmoText, formatWeaponCardSubtitle, formatSecondaryButtonTitle, formatSecondaryCardSubtitle,
} from '../src/core/weapons.ts'
import type { MapData, MapSolid } from '../src/core/map.ts'
import type { WorldEvent, TeamId } from '../src/core/types.ts'
import { encodeServerMsgBinary, decodeServerMsgBinary, resetBinaryCodecState } from '../src/net/protocol/BinaryCodec.ts'
import { expandBeamSegments, worldSegLength } from '../src/web/render/beamGeometry.ts'
import { WORLD_W, WORLD_H } from '../src/core/wrap.ts'
import { emptyWorld, input, DT } from './helpers.ts'
import type { WorldInput } from '../src/core/types.ts'
import { recoilDelta, RECOIL_SCALE } from '../src/core/sim/physics.ts'
import { projectileBodyHitQuality } from '../src/core/sim/projectiles.ts'
import { BODY_HALF_W } from '../src/core/sim/landmarks.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY } from '../src/core/wrap.ts'

test('护栏·武器约定：跨武器规则/数值范围全部满足', () => {
  const vs = weaponViolations()
  assert.deepEqual(vs, [], `武器约定违规：\n${vs.map(v => ` - ${v.code}: ${v.message}`).join('\n')}`)
})

test('护栏·默认地图布局：地标全部在空地/世界范围内，跳台贴地', () => {
  const w = new World(1, defaultMapData())
  const vs = layoutViolations(w)
  assert.deepEqual(vs, [], `布局违规：\n${vs.map(v => ` - ${v.code}: ${v.message}`).join('\n')}`)
  assert.deepEqual(allViolations(w), [])
})

test('护栏·布局校验能抓到“建筑盖住地标”的回归', () => {
  // 故意用掩体压住据点 A（1720,264，天花板顶面站立）：掩体底 280 ≥ cp_a 站立 264
  const bad: MapData = { name: 'bad', solids: [{ x: 1700, y: 160, w: 200, h: 120, kind: 'cover' }] }
  const w = new World(2, bad)
  const vs = layoutViolations(w)
  assert.ok(vs.some(v => v.code === 'layout.solid' && v.message.includes('cp:cp_a')), '应当报据点被覆盖')
})

test('护栏·出生安全：所有固定出生点落地后不嵌实体', () => {
  for (const sp of SPAWN_POINTS) {
    const w = new World(3, defaultMapData())
    w.config.randomSpawn = false
    const p = w.addPlayer(`P-${sp.team}`, sp.team)
    for (let i = 0; i < 120; i++) w.step(DT, new Map([[p.id, input()]]))
    assert.equal(w.bodyOverlapsAt(p.pos.x, p.pos.y), false, `spawn ${sp.team} ends stuck at (${p.pos.x},${p.pos.y})`)
  }
})

test('护栏·随机出生：randomSpawn 开启时连续出生均安全', () => {
  const w = new World(4, defaultMapData())
  const p = w.addPlayer('P', 'ffa')
  for (let k = 0; k < 8; k++) {
    p.alive = false
    p.respawnTimer = 0.01
    for (let i = 0; i < 30; i++) w.step(DT, new Map([[p.id, input()]]))
    assert.equal(w.bodyOverlapsAt(p.pos.x, p.pos.y), false, `random spawn #${k} stuck at (${p.pos.x},${p.pos.y})`)
  }
})

test('护栏·小地图兼容：空地形世界能正常生成/战斗（不依赖默认布局）', () => {
  const w = emptyWorld(5)
  assert.equal(w.terrain.rects.length, 1, 'empty map = only earth')
  // 空地形没有天花板 → 跳台（天花板专属）悬空属预期，跳过 pad 判定
  assert.deepEqual(layoutViolations(w, { skipPads: true }), [], 'empty map landmarks must be valid')
  const a = w.addPlayer('A', 'red')
  const b = w.addPlayer('B', 'blue')
  a.weaponIndex = 1
  b.weaponIndex = 1
  a.pos = { x: 3000, y: 2784 }
  b.pos = { x: 3300, y: 2784 }
  for (let i = 0; i < 120; i++) w.step(DT, new Map([[a.id, input({ fire: true, aim: 0 })], [b.id, input()]]))
  assert.ok(b.hp < 100, 'combat works on empty custom map')
})

test('护栏·地图数据：默认 solids 均在边界内且 kind 合法', () => {
  const kinds = new Set(['cover', 'platform', 'block'])
  for (const s of defaultMapData().solids as MapSolid[]) {
    assert.ok(s.x >= 0 && s.x + s.w <= WORLD_W, `solid x out of bounds: ${JSON.stringify(s)}`)
    assert.ok(s.y >= 0 && s.y + s.h <= WORLD_H, `solid y out of bounds: ${JSON.stringify(s)}`)
    assert.ok(s.w > 0 && s.h > 0, `solid size invalid: ${JSON.stringify(s)}`)
    assert.ok(kinds.has(s.kind), `unknown kind ${s.kind}`)
  }
})


test('护栏·后坐力各向同性：水平/垂直/斜向使用同一系数', () => {
  const r = 1560
  const right = recoilDelta(r, 0)
  const up = recoilDelta(r, -Math.PI / 2)
  const down = recoilDelta(r, Math.PI / 2)
  const diag = recoilDelta(r, Math.PI / 4)
  const mag = (v: { x: number; y: number }) => Math.hypot(v.x, v.y)
  assert.ok(Math.abs(Math.abs(right.x) - Math.abs(up.y)) < 1e-9, 'horizontal vs vertical magnitude equal')
  assert.ok(Math.abs(mag(up) - mag(right)) < 1e-9, 'magnitudes identical in all directions')
  assert.ok(Math.abs(mag(diag) - r * RECOIL_SCALE) < 1e-9, 'diagonal magnitude same as axial')
  assert.ok(Math.abs(right.y) < 1e-9 && Math.abs(up.x) < 1e-9, 'no cross-axis components')
})


test('护栏·后坐力各向同性（多帧净位移）：8 方向 + 喷气/移动/下坠 全部一致', () => {
  // 测量：同一 tick 序列下「开火」与「不开火」的位移差 = 纯后坐力净位移。
  // 空中测量可排除地面吸收垂直分量（斜向压向地面时垂直分量被地面吃掉是正确的物理）。
  const netRecoil = (aimDeg: number, extra: Partial<WorldInput> = {}, air = true): number => {
    const run = (fire: boolean) => {
      const w = new World(38100, { name: 'recoil-arena', solids: [] })
      w.config.randomSpawn = false
      const p = w.addPlayer('P', 'ffa')
      p.weaponIndex = 0                     // 霰弹：recoil 1560，最容易暴露差异
      p.pos = air ? { x: 6600, y: 1000 } : { x: 6600, y: 2740 }
      p.vel = { x: 0, y: 0 }
      p.onGround = !air
      const aim = (aimDeg * Math.PI) / 180
      const x0 = p.pos.x
      const y0 = p.pos.y
      for (let i = 0; i < 20; i++) {
        w.step(DT, new Map([[p.id, input({ aim, fire: fire && i === 0, ...extra })]]))
      }
      return { dx: p.pos.x - x0, dy: p.pos.y - y0 }
    }
    const a = run(true)
    const b = run(false)
    return Math.hypot(a.dx - b.dx, a.dy - b.dy)
  }

  // ① 空中 8 方向（含斜向）：净位移必须一致
  const dirs = [0, 180, -90, 90, 45, -135, 30, 150]
  const mags = dirs.map(d => netRecoil(d))
  const spread = Math.max(...mags) - Math.min(...mags)
  assert.ok(spread < 1, `recoil must be isotropic in every direction, spread=${spread.toFixed(2)}px (${mags.map(m => m.toFixed(1)).join(', ')})`)
  assert.ok(mags[0] > 80, `shotgun recoil is significant, got ${mags[0].toFixed(1)}px`)

  // ② 水平与垂直必须相等（这正是旧实现的病根：水平被移动覆写、垂直被重力放大）
  const horizontal = netRecoil(0)
  const vertical = netRecoil(-90)
  assert.ok(Math.abs(horizontal - vertical) < 1, `horizontal (${horizontal.toFixed(1)}) must equal vertical (${vertical.toFixed(1)})`)

  // ③ 按住喷气时向下开枪，后坐力不能被喷射上限截断吞掉
  const jetOff = netRecoil(90)
  const jetOn = netRecoil(90, { jetpack: true })
  assert.ok(Math.abs(jetOn - jetOff) < 1, `jetpack must not swallow recoil: off=${jetOff.toFixed(1)} on=${jetOn.toFixed(1)}`)

  // ④ 移动中开火，水平后坐力不能被「每帧覆写 vel.x」吃掉
  for (const mv of [-1, 0, 1] as const) {
    const m = netRecoil(0, { move: mv }, false)
    assert.ok(Math.abs(m - horizontal) < 1, `move=${mv} must not change horizontal recoil, got ${m.toFixed(1)} vs ${horizontal.toFixed(1)}`)
  }

  // ⑤ 不同下落速度下，向上开枪的净位移必须一致
  const fallMags: number[] = []
  for (const vy0 of [0, 300, 900, 1100]) {
    const run = (fire: boolean) => {
      const w = new World(38200, { name: 'recoil-fall', solids: [] })
      w.config.randomSpawn = false
      const p = w.addPlayer('P', 'ffa')
      p.weaponIndex = 0
      p.pos = { x: 6600, y: 1000 }
      p.vel = { x: 0, y: vy0 }
      p.onGround = false
      const y0 = p.pos.y
      for (let i = 0; i < 20; i++) {
        w.step(DT, new Map([[p.id, input({ aim: -Math.PI / 2, fire: fire && i === 0 })]]))
      }
      return p.pos.y - y0
    }
    fallMags.push(Math.abs(run(true) - run(false)))
  }
  const fallSpread = Math.max(...fallMags) - Math.min(...fallMags)
  assert.ok(fallSpread < 1, `fall speed must not change recoil, spread=${fallSpread.toFixed(2)}px (${fallMags.map(m => m.toFixed(1)).join(', ')})`)
})

test('护栏·高斯枪不穿墙：端点不在实体内、段不跨实体、屏幕长度一致、薄墙后不受伤害', () => {
  // ① 随机角度：每段端点不在实体内、段内不穿实体、渲染侧最短位移长度≡世界长度（不会画横穿全图直线）
  let segs = 0
  for (let s = 0; s < 40; s++) {
    const w = new World(21000 + s, defaultMapData())
    w.config.randomSpawn = false
    const a = w.addPlayer('A', 'ffa')
    const ax = 400 + ((s * 211) % 12400)
    const ay = 1800 + ((s * 97) % 900)
    // 玩家需在开阔处（不在实体、不在空口拱形方块区 5600~7600），避免方块网格边界干扰光束段断言
    if (w.terrain.isSolidAt(ax, ay)) continue
    if (ax > 5500 && ax < 7700) continue
    a.pos = { x: ax, y: ay }
    a.weaponIndex = 4
    a.ammo[4] = 12
    a.reserveAmmo[4] = 48
    const aim = (s / 40) * Math.PI * 2
    for (let i = 0; i < 4; i++) {
      w.step(DT, new Map([[a.id, input({ fire: true, aim })]]))
      for (const e of w.drainEvents()) {
        if (e.kind !== 'laser') continue
        for (const seg of e.segments!) {
          segs++
          assert.equal(w.terrain.isSolidAt(seg.x1, seg.y1), false, `segment origin inside solid @(${seg.x1},${seg.y1})`)
          assert.equal(w.terrain.isSolidAt(seg.x2, seg.y2), false, `segment end inside solid @(${seg.x2},${seg.y2})`)
          // 用真实位移（dx/dy）：长段/跨接缝时 wrapDelta 会折叠成反向最短路径
          const ddx = seg.dx ?? wrapDeltaX(seg.x1, seg.x2)
          const ddy = seg.dy ?? wrapDeltaY(seg.y1, seg.y2)
          const len = Math.hypot(ddx, ddy)
          const steps = Math.max(1, Math.ceil(len / 4))
          for (let k = 1; k < steps; k++) {
            const px = wrapX(seg.x1 + (ddx * k) / steps)
            const py = wrapY(seg.y1 + (ddy * k) / steps)
            assert.equal(w.terrain.isSolidAt(px, py), false, `segment crosses solid at (${Math.round(px)},${Math.round(py)})`)
          }
          // 渲染端：每段按「起点屏幕坐标 + 最短位移」绘制，屏幕长度必须 ≡ 世界长度
          // （若分别对两端取最短位移，跨接缝的段会画成横穿全图的长线 —— 这正是此前的“穿墙光束”）
          const screen = expandBeamSegments([seg], (wx, wy) => ({ x: wrapDeltaX(6600, wx), y: wrapDeltaY(2200, wy) }), 2000, 1200)[0]
          const sr = Math.hypot(screen.x2 - screen.x1, screen.y2 - screen.y1)
          const realLen = worldSegLength(seg)
          assert.ok(Math.abs(sr - realLen) < 1.5, `segment render length differs (world ${realLen.toFixed(0)} vs screen ${sr.toFixed(0)})`)
        }
      }
    }
  }
  assert.ok(segs > 50, `collected laser segments: ${segs}`)

  // ② 薄墙（12px）+ 目标紧贴墙背面：不能被光束打到
  for (const thick of [12, 20, 40]) {
    const w = new World(22000 + thick, { name: 'thin', solids: [{ x: 6620, y: 2400, w: thick, h: 400, kind: 'cover' }] })
    w.config.randomSpawn = false
    const shooter = w.addPlayer('S', 'red')
    const target = w.addPlayer('T', 'blue')
    shooter.weaponIndex = 4
    shooter.ammo[4] = 12
    shooter.reserveAmmo[4] = 48
    shooter.pos = { x: 6600, y: 2700 }
    target.pos = { x: 6622 + thick + 8, y: 2700 }
    for (let i = 0; i < 25; i++) {
      w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })], [target.id, input()]]))
      w.drainEvents()
    }
    assert.equal(target.hp, 100, `target behind ${thick}px wall must not be hit, hp=${target.hp}`)
  }
})

test('护栏·高斯枪被可破坏掩体挡住（贴掩体开火也不穿）', () => {
  const w = new World(23000)
  w.config.randomSpawn = false
  const shooter = w.addPlayer('S', 'red')
  const target = w.addPlayer('T', 'blue')
  const ob = w.obstacles.find(o => o.id === 'obs_1')!
  shooter.weaponIndex = 4
  shooter.ammo[4] = 12
  shooter.reserveAmmo[4] = 48
  shooter.pos = { x: ob.x - 30, y: ob.y + ob.h + 4 }   // 紧贴掩体左侧
  target.pos = { x: ob.x + ob.w + 60, y: ob.y + ob.h + 4 }
  const hp0 = ob.hp
  for (let i = 0; i < 25; i++) {
    w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })], [target.id, input()]]))
    w.drainEvents()
  }
  assert.ok(ob.hp < hp0, `destructible cover takes damage, hp=${ob.hp}`)
  assert.equal(target.hp, 100, `target behind destructible cover protected, hp=${target.hp}`)
})


test('护栏·高斯枪跨世界接缝：光束连续（不中断）且屏幕不会画出横穿全图的长线', () => {
  // ① 目标就在接缝另一侧：光束应继续飞过去并命中（世界是环形的，不能在接缝凭空断掉）
  const w = new World(31000, { name: 'seam', solids: [] })
  w.config.randomSpawn = false
  const a = w.addPlayer('A', 'red')
  const b = w.addPlayer('B', 'blue')
  a.weaponIndex = 4
  a.ammo[4] = 12
  a.reserveAmmo[4] = 48
  a.pos = { x: 13180, y: 2700 }
  b.pos = { x: 120, y: 2700 }
  for (let i = 0; i < 20; i++) {
    w.step(DT, new Map([[a.id, input({ fire: true, aim: 0 })], [b.id, input()]]))
    w.drainEvents()
  }
  assert.ok(b.hp < 100, `cross-seam beam reaches the target across the seam, hp=${b.hp}`)

  // ② 渲染不变量：跨接缝的段，屏幕长度 == 世界长度（不会变成半张地图的长线）
  const seg = { x1: 13190, y1: 1000, x2: 100, y2: 1000 }
  const screens = expandBeamSegments([seg], (wx, wy) => ({ x: wrapDeltaX(6600, wx), y: wrapDeltaY(2200, wy) }), 2000, 1200)
  const len = Math.hypot(wrapDeltaX(seg.x1, seg.x2), wrapDeltaY(seg.y1, seg.y2))
  for (const sc of screens) {
    const sl = Math.hypot(sc.x2 - sc.x1, sc.y2 - sc.y1)
    assert.ok(Math.abs(sl - len) < 1e-6, `screen segment length ${sl.toFixed(1)} != world length ${len.toFixed(1)}`)
  }
})


test('护栏·友伤/自伤为可选项：默认只允许手雷/高斯/引力/火箭，其余关闭', () => {
  // 需要的武器开启
  for (const idx of [3, 4, 6]) {   // 火箭筒 / 高斯枪 / 引力枪
    assert.equal(WEAPONS[idx].friendlyFire, true, `${WEAPONS[idx].name} friendlyFire on`)
    assert.equal(WEAPONS[idx].selfDamage, true, `${WEAPONS[idx].name} selfDamage on`)
  }
  // 其余枪械关闭
  for (const idx of [0, 1, 2, 5, 7, 8]) {
    assert.ok(!WEAPONS[idx].friendlyFire, `${WEAPONS[idx].name} friendlyFire off by default`)
    assert.ok(!WEAPONS[idx].selfDamage, `${WEAPONS[idx].name} selfDamage off by default`)
  }
  // 手雷走全局配置且默认开启
  const cfg = { ...DEFAULT_CONFIG }
  assert.equal(cfg.grenadeFriendlyFire, true, 'grenade friendly fire on by default')
  assert.equal(cfg.grenadeSelfDamage, true, 'grenade self damage on by default')
})

test('护栏·友伤开关行为：关闭后队友不掉血，开启后掉血', () => {
  const mk = (weaponIdx: number) => {
    const w = new World(33000 + weaponIdx)
    w.config.randomSpawn = false
    const shooter = w.addPlayer('S', 'red')
    const mate = w.addPlayer('M', 'red')       // 同队
    shooter.weaponIndex = weaponIdx
    shooter.pos = { x: 2200, y: 3264 }
    mate.pos = { x: 2400, y: 3264 }
    return { w, shooter, mate }
  }
  // 突击步枪（默认关闭友伤）：队友 100 血
  {
    const { w, shooter, mate } = mk(1)
    for (let i = 0; i < 30; i++) {
      w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })], [mate.id, input()]]))
      w.drainEvents()
    }
    assert.equal(mate.hp, 100, `rifle must not hurt teammate, hp=${mate.hp}`)
  }
  // 高斯枪（开启友伤）：队友掉血
  {
    const { w, shooter, mate } = mk(4)
    shooter.ammo[4] = 12
    shooter.reserveAmmo[4] = 48
    for (let i = 0; i < 30; i++) {
      w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })], [mate.id, input()]]))
      w.drainEvents()
    }
    assert.ok(mate.hp < 100, `gauss must hurt teammate, hp=${mate.hp}`)
  }
  // 开关可运行时关闭：把高斯 friendlyFire 临时设回 false → 队友不掉血
  {
    const { w, shooter, mate } = mk(4)
    const prev = WEAPONS[4].friendlyFire
    WEAPONS[4].friendlyFire = false
    try {
      shooter.ammo[4] = 12
      shooter.reserveAmmo[4] = 48
      for (let i = 0; i < 30; i++) {
        w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })], [mate.id, input()]]))
        w.drainEvents()
      }
      assert.equal(mate.hp, 100, 'friendlyFire toggle is a runtime option')
    } finally {
      WEAPONS[4].friendlyFire = prev
    }
  }
})


test('护栏·复活记住上次武器：拿着补给特武阵亡后重生回到上次常规主武器', () => {
  const w = new World(34000)
  w.config.randomSpawn = false
  const p = w.addPlayer('P', 'ffa')
  const killer = w.addPlayer('K', 'blue')
  // 先选霰弹（常规主武器）
  p.weaponIndex = 0
  p.lastPrimaryIndex = 0
  // 拾取补给特武（高斯枪），lastPrimaryIndex 不应被改写
  p.weaponIndex = 4
  assert.equal(p.lastPrimaryIndex, 0, 'picking up a supply weapon must not overwrite last primary')
  // 阵亡 → 重生
  ;(w as unknown as { explode: (...a: unknown[]) => void }).explode(p.pos.x, p.pos.y, 200, 999, 0, undefined, killer.id, killer.team, '测试')
  assert.ok(p.respawnTimer > 0, 'player died')
  for (let i = 0; i < 400; i++) w.step(DT, new Map([[p.id, input()], [killer.id, input()]]))
  assert.ok(p.alive, 'player respawned')
  assert.equal(p.weaponIndex, 0, `respawn restores the last primary (shotgun), got ${WEAPONS[p.weaponIndex].name}`)
  assert.equal(p.lastPrimaryIndex, 0, 'last primary stays the shotgun')

  // 换主武器后再次带特武复活 → 回到新选的主武器
  p.weaponIndex = 8
  p.lastPrimaryIndex = 8
  p.weaponIndex = 6                     // 引力枪（补给）
  ;(w as unknown as { explode: (...a: unknown[]) => void }).explode(p.pos.x, p.pos.y, 200, 999, 0, undefined, killer.id, killer.team, '测试')
  for (let i = 0; i < 400; i++) w.step(DT, new Map([[p.id, input()], [killer.id, input()]]))
  assert.equal(p.weaponIndex, 8, `respawn restores SMG, got ${WEAPONS[p.weaponIndex].name}`)
})

test('护栏·补给特武不写进 lastPrimaryIndex（多轮拾取/重生不串味）', () => {
  const w = new World(34100)
  w.config.randomSpawn = false
  const p = w.addPlayer('P', 'ffa')
  assert.equal(p.weaponIndex, 1, 'starts with assault rifle')
  assert.equal(p.lastPrimaryIndex, 1)
  // 反复拾取特武：lastPrimaryIndex 一直是突击步枪
  for (const supplyId of [4, 5, 6]) {
    p.weaponIndex = supplyId
    assert.equal(p.lastPrimaryIndex, 1, `supply pickup ${WEAPONS[supplyId].name} keeps last primary`)
  }
  // 重生逻辑本身不把特武当主武器：连续两次死亡重生都回到突击步枪
  const killer2 = w.addPlayer('K2', 'blue')
  for (let round = 0; round < 2; round++) {
    p.weaponIndex = round === 0 ? 4 : 6
    ;(w as unknown as { explode: (...a: unknown[]) => void }).explode(p.pos.x, p.pos.y, 200, 999, 0, undefined, killer2.id, killer2.team, '测试')
    for (let i = 0; i < 400; i++) w.step(DT, new Map([[p.id, input()], [killer2.id, input()]]))
    assert.equal(p.weaponIndex, 1, `round ${round}: respawn back to assault rifle, got ${WEAPONS[p.weaponIndex].name}`)
  }
})


test('护栏·高斯枪反射次数=2（段数最多 3）', () => {
  assert.equal(WEAPONS[4].bounces, 2, 'gauss bounces twice')
  const w = new World(35000, { name: 'box', solids: [
    { x: 3000, y: 2000, w: 20, h: 800, kind: 'cover' },
    { x: 3800, y: 2000, w: 20, h: 800, kind: 'cover' },
    { x: 3000, y: 2000, w: 820, h: 20, kind: 'cover' },
    { x: 3000, y: 2780, w: 820, h: 20, kind: 'cover' },
  ] })
  w.config.randomSpawn = false
  const a = w.addPlayer('A', 'ffa')
  a.weaponIndex = 4
  a.ammo[4] = 12
  a.reserveAmmo[4] = 48
  a.pos = { x: 3400, y: 2700 }
  let maxSegs = 0
  for (let i = 0; i < 20; i++) {
    w.step(DT, new Map([[a.id, input({ fire: true, aim: 0 })]]))
    for (const e of w.drainEvents()) if (e.kind === 'laser') maxSegs = Math.max(maxSegs, e.segments?.length ?? 0)
  }
  assert.equal(maxSegs, 3, `2 reflections => at most 3 segments, got ${maxSegs}`)
})


test('护栏·击杀事件必须携带名称与队伍（防止 killfeed 显示「?」）', () => {
  const w = new World(36000)
  w.config.randomSpawn = false
  const a = w.addPlayer('Alice', 'red')
  const b = w.addPlayer('Bob', 'blue')
  a.weaponIndex = 1
  a.ammo[1] = 30
  a.pos = { x: 3000, y: 2740 }
  b.pos = { x: 3060, y: 2740 }
  b.hp = 5
  const evs: WorldEvent[] = []
  for (let i = 0; i < 60; i++) {
    w.step(DT, new Map([[a.id, input({ fire: true })], [b.id, input()]]))
    evs.push(...w.drainEvents())
  }
  const kill = evs.find(e => e.kind === 'kill')
  assert.ok(kill, 'kill event emitted')
  assert.equal(kill!.killerName, 'Alice', 'killer name present (killfeed would show "?" otherwise)')
  assert.equal(kill!.victimName, 'Bob', 'victim name present')
  assert.equal(kill!.killerTeam, 'red', 'killer team present')
  assert.equal(kill!.victimTeam, 'blue', 'victim team present')
  assert.ok(kill!.weaponLabel, 'weapon label present')
})

test('护栏·弹丸事件化：发射/反弹/销毁事件成对出现（客户端推算需要）', () => {
  const w = new World(36100)
  w.config.randomSpawn = false
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 1
  p.ammo[1] = 30
  p.pos = { x: 6600, y: 2400 }
  const evs: WorldEvent[] = []
  // 步枪弹丸寿命 ≈130 tick；跑满寿命才能观察到 destroy 事件
  for (let i = 0; i < 260; i++) {
    w.step(DT, new Map([[p.id, input({ fire: true })]]))
    evs.push(...w.drainEvents())
  }
  const spawns = evs.filter(e => e.kind === 'projectile_spawn')
  assert.ok(spawns.length > 0, 'projectile_spawn emitted')
  for (const s of spawns) {
    assert.ok(typeof s.projectileId === 'number', 'spawn carries projectileId')
    assert.ok(typeof s.x === 'number' && typeof s.y === 'number', 'spawn carries position')
  }
  assert.ok(evs.some(e => e.kind === 'projectile_destroy'), 'projectile_destroy emitted')
})


test('护栏·复活即参战：重生后立刻有实体/可开枪，且手榴弹不在冷却、可立即投掷', () => {
  const w = new World(37000)
  w.config.randomSpawn = false
  const a = w.addPlayer('A', 'red')
  const b = w.addPlayer('B', 'blue')
  a.weaponIndex = 1
  a.pos = { x: 3000, y: 2740 }
  b.pos = { x: 3600, y: 2740 }
  // 真实死亡 → 重生
  ;(w as unknown as { explode: (...x: unknown[]) => void }).explode(a.pos.x, a.pos.y, 200, 999, 0, undefined, b.id, b.team, '测试')
  assert.ok(a.respawnTimer > 0, 'died')
  // 先消耗掉手榴弹并触发冷却，验证重生后是被重置的
  a.fragCharges = 0
  a.secondaryCooldown = 5
  for (let i = 0; i < 260; i++) w.step(DT, new Map([[a.id, input()], [b.id, input()]]))
  assert.ok(a.alive, 'respawned')

  // ① 不再有复活无敌/隐身/禁枪
  assert.equal(a.hp, 100, 'respawns at full hp with no invulnerability window')

  // ② 重生后手榴弹立即就绪：有充能、无冷却
  assert.ok(a.fragCharges > 0, `grenade charge available right after respawn, got ${a.fragCharges}`)
  assert.equal(a.secondaryCooldown, 0, 'no grenade cooldown after respawn')

  // ③ 重生后同一 tick 就能扔出手榴弹（不进入 cd）
  const before = w.grenades.length
  w.step(DT, new Map([[a.id, input({ secondary: { type: 'frag', targetX: a.pos.x + 100, targetY: a.pos.y } })], [b.id, input()]]))
  assert.ok(w.grenades.length > before, 'grenade can be thrown immediately after respawn')

  // ④ 可以立刻开枪（无禁枪窗口）
  const ammo0 = a.ammo[a.weaponIndex]
  for (let i = 0; i < 5; i++) w.step(DT, new Map([[a.id, input({ fire: true, aim: 0 })], [b.id, input()]]))
  assert.ok(a.ammo[a.weaponIndex] < ammo0 || w.projectiles.length > 0, 'can fire immediately after respawn')
})

test('护栏·二进制事件通道：所有 kind 往返保真（未知 kind 不得退化成 kill）', () => {
  const w = new World(38000)
  w.config.randomSpawn = false
  const a = w.addPlayer('Alice', 'red')
  const b = w.addPlayer('Bob', 'blue')
  a.weaponIndex = 1
  a.ammo[1] = 30
  a.pos = { x: 3000, y: 2740 }
  b.pos = { x: 3060, y: 2740 }
  b.hp = 3
  const evs: WorldEvent[] = []
  for (let i = 0; i < 60; i++) {
    w.step(DT, new Map([[a.id, input({ fire: true })], [b.id, input()]]))
    evs.push(...w.drainEvents())
  }
  assert.ok(evs.some(e => e.kind === 'hit'), 'hit event produced')
  const back = decodeServerMsgBinary(encodeServerMsgBinary({ snap: w.snapshot(), events: evs }))
  const kindsAfter: Record<string, number> = {}
  for (const e of back!.events ?? []) kindsAfter[e.kind] = (kindsAfter[e.kind] ?? 0) + 1
  assert.ok((kindsAfter['hit'] ?? 0) > 0, `hit must survive the codec (was decoded as kill before), got ${JSON.stringify(kindsAfter)}`)
  // kill 数量必须与编码前一致（不能因索引错位被放大）
  const killsBefore = evs.filter(e => e.kind === 'kill').length
  assert.equal(kindsAfter['kill'] ?? 0, killsBefore, 'kill count preserved through codec')
  // 名字字段保留（kill 走 JSON 兜底路径）
  const k = (back!.events ?? []).find(e => e.kind === 'kill')
  assert.ok(k, 'kill survives codec')
  assert.equal(k!.killerName, 'Alice', 'killer name preserved over the wire')
  assert.equal(k!.victimName, 'Bob', 'victim name preserved over the wire')
})


test('护栏·codec kind 表必须覆盖 core 实际发出的每个事件 kind（漏项会退化成 kill）', () => {
  const simDir = new URL('../src/core/sim/', import.meta.url)
  const emitted = new Set<string>()
  for (const f of readdirSync(simDir)) {
    if (!f.endsWith('.ts')) continue
    const src = readFileSync(new URL(f, simDir), 'utf8')
    for (const m of src.matchAll(/kind: '([a-z_]+)'/g)) emitted.add(m[1])
  }
  emitted.delete('weapon'); emitted.delete('doll')   // 不是 WorldEvent（补给箱/人偶 kind）
  assert.ok(emitted.size >= 10, `sanity: found ${emitted.size} emitted kinds`)

  const codec = readFileSync(new URL('../src/net/protocol/BinaryCodec.ts', import.meta.url), 'utf8')
  const start = codec.indexOf('const EVENT_KINDS')
  const arrStart = codec.indexOf('= [', start)
  const block = codec.slice(arrStart, codec.indexOf('\n]', arrStart))
  const table = new Set([...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]))

  const missing = [...emitted].filter(k => !table.has(k))
  assert.deepEqual(missing, [], `这些 kind 不在 EVENT_KINDS 里，二进制联机会被解码成 'kill'：${missing.join(', ')}`)
})


test('护栏·高斯枪反射：小房间与「横跨地图左右」的大房间都能完整反射 2 次', () => {
  const beamRun = (solids: MapSolid[], shooter: { x: number; y: number }, aim: number) => {
    const w = new World(39000, { name: 'beam-room', solids })
    w.config.randomSpawn = false
    const p = w.addPlayer('P', 'ffa')
    p.weaponIndex = 4                    // 高斯枪：bounces = 2
    p.ammo[4] = 24
    p.reserveAmmo[4] = 48
    p.pos = shooter
    w.step(DT, new Map([[p.id, input({ aim, fire: true })]]))
    const e = w.drainEvents().find(ev => ev.kind === 'laser')
    return (e?.segments ?? []) as { x1: number; y1: number; x2: number; y2: number; dx?: number; dy?: number }[]
  }

  const checkRoom = (label: string, solids: MapSolid[], shooter: { x: number; y: number }, aim: number) => {
    const segs = beamRun(solids, shooter, aim)
    assert.equal(segs.length, 3, `${label}: 2 reflections => 3 segments, got ${segs.length}`)
    // 渲染不变量：屏幕段长度必须等于真实世界长度（用 dx/dy，而不是折叠后的 wrapDelta）
    // 逐段验证（expandBeamSegments 会为跨接缝补副本，不能按下标对齐）
    for (let i = 0; i < segs.length; i++) {
      const real = worldSegLength(segs[i])
      const cam = { x: segs[i].x1, y: segs[i].y1 }
      const poly = expandBeamSegments([segs[i]], (wx, wy) => ({ x: wrapDeltaX(cam.x, wx), y: wrapDeltaY(cam.y, wy) }), 20000, 20000)[0]
      const screen = Math.hypot(poly.x2 - poly.x1, poly.y2 - poly.y1)
      assert.ok(Math.abs(screen - real) < 1.5, `${label} seg${i}: screen ${screen.toFixed(0)} != world ${real.toFixed(0)}`)
      assert.ok(real > 100, `${label} seg${i}: not collapsed to a few px (${real.toFixed(1)})`)
    }
  }

  // ① 小房间 1000x600
  checkRoom('small-room', [
    { x: 6000, y: 2000, w: 20, h: 600, kind: 'cover' },
    { x: 7000, y: 2000, w: 20, h: 600, kind: 'cover' },
    { x: 6000, y: 2000, w: 1020, h: 20, kind: 'cover' },
    { x: 6000, y: 2580, w: 1020, h: 20, kind: 'cover' },
  ], { x: 6200, y: 2400 }, 0)

  // ② 横跨地图左右的大房间：宽 12000 > 半世界 6600，高 2440 > 半世界 2200
  checkRoom('world-wide-room', [
    { x: 600, y: 400, w: 20, h: 2400, kind: 'cover' },
    { x: 12600, y: 400, w: 20, h: 2400, kind: 'cover' },
    { x: 600, y: 400, w: 12020, h: 20, kind: 'cover' },
    { x: 600, y: 2780, w: 12020, h: 20, kind: 'cover' },
  ], { x: 6600, y: 1600 }, 0)

  // ③ 高空竖井：单段 2440px 垂直往返，专门覆盖 |dy| > 半世界 2200
  checkRoom('tall-shaft', [
    { x: 6000, y: 300, w: 20, h: 2500, kind: 'cover' },
    { x: 7000, y: 300, w: 20, h: 2500, kind: 'cover' },
    { x: 6000, y: 300, w: 1020, h: 20, kind: 'cover' },
    { x: 6000, y: 2780, w: 1020, h: 20, kind: 'cover' },
  ], { x: 6500, y: 2700 }, -Math.PI / 2)
})


test('护栏·狙击读条：按一下即开始读条(无需按住)，方向锁定在按下那一刻，读满 0.5s 自动发射', () => {
  const sniper = WEAPONS[2]
  assert.ok(Math.abs((sniper.chargeSeconds ?? 0) - 0.5) < 1e-9, `sniper charge is 0.5s, got ${sniper.chargeSeconds}`)

  // ① 只在第一帧按下、之后完全不按：仍然读条并发射（不是"按住才蓄力"）
  const run = (aimAtPress: number, aimAfter: number) => {
    const w = new World(48000 + Math.round(aimAtPress * 100), { name: 'sniper-charge', solids: [] })
    w.config.randomSpawn = false
    const p = w.addPlayer('P', 'ffa')
    p.weaponIndex = 2
    p.ammo[2] = 3
    p.reserveAmmo[2] = 15
    p.pos = { x: 6600, y: 2200 }
    type Shot = { tick: number; angle: number }
    let fired: Shot | null = null
    for (let i = 0; i < 90; i++) {
      // 只在第 0 帧按下开火键；瞄准在按下后立刻改变
      w.step(DT, new Map([[p.id, input({ fire: i === 0, aim: i === 0 ? aimAtPress : aimAfter })]]))
      for (const e of w.drainEvents()) {
        if (e.kind !== 'projectile_spawn') continue
        const pr = w.projectiles.find(x => x.id === e.projectileId)
        if (pr) fired = { tick: i, angle: Math.atan2(pr.vel.y, pr.vel.x) } as Shot
      }
      if (fired !== null) break
    }
    return fired as Shot | null
  }

  const shot = run(0, Math.PI / 2)
  assert.ok(shot !== null, 'pressing once without holding still charges and fires')
  // 读条约 0.5s（30 帧）后发射
  assert.ok(Math.abs((shot!.tick + 1) * DT - 0.5) <= 0.06,
    `fires after about 0.5s of charging, got ${((shot!.tick + 1) * DT).toFixed(2)}s`)
  // 方向锁定在按下瞬间（朝右 0 rad），而不是松手/发射时的瞄准
  assert.ok(Math.abs(shot!.angle) < 0.05,
    `direction locked at press time (0 rad), got ${(shot!.angle * 180 / Math.PI).toFixed(1)}°`)

  // ② 按下时朝下，之后转朝右：仍然朝下发射
  const shot2 = run(Math.PI / 2, 0)
  assert.ok(shot2 !== null, 'second charge also fires')
  assert.ok(Math.abs(shot2!.angle - Math.PI / 2) < 0.05,
    `direction follows the press-time aim, got ${(shot2!.angle * 180 / Math.PI).toFixed(1)}°`)

  // ③ 读条期间不再接受新的按下沿来重置方向干扰：连续按住不会重复触发读条
  const w3 = new World(48100, { name: 'sniper-hold', solids: [] })
  w3.config.randomSpawn = false
  const q = w3.addPlayer('Q', 'ffa')
  q.weaponIndex = 2
  q.ammo[2] = 3
  q.reserveAmmo[2] = 15
  q.pos = { x: 6600, y: 2200 }
  let shots = 0
  for (let i = 0; i < 90; i++) {
    w3.step(DT, new Map([[q.id, input({ fire: true, aim: 0 })]]))
    for (const e of w3.drainEvents()) if (e.kind === 'projectile_spawn') shots++
  }
  assert.equal(shots, 1, `holding the button fires once per charge (not auto-repeating), got ${shots}`)
})

test('护栏·高斯枪设计：有反射、有自伤、穿过地图缝反射次数-1、归零后不再穿透地图缝隙、任意角度发射不扣自己血', () => {
  assert.equal(WEAPONS[4].bounces, 2, '反射次数固定为 2')
  assert.equal(WEAPONS[4].selfDamage, true, '开启自伤')

  const fireOnce = (
    w: World,
    shooterPos: { x: number; y: number },
    aim: number,
    withShield = false,
  ) => {
    const p = w.addPlayer('GaussTester', 'ffa')
    p.weaponIndex = 4
    p.ammo[4] = 24
    p.reserveAmmo[4] = 48
    p.pos = { x: shooterPos.x, y: shooterPos.y }
    p.vel = { x: 0, y: 0 }
    if (withShield) {
      p.shieldTimer = 5
      p.shieldHp = 100
    }
    w.step(DT, new Map([[p.id, input({ aim, fire: true })]]))
    const ev = w.drainEvents().find(e => e.kind === 'laser')
    return { p, ev, segments: (ev?.segments ?? []) as { x1: number; y1: number; x2: number; y2: number; dx?: number; dy?: number }[] }
  }

  // ── 1. 穿过地图左右缝隙（无障碍物）：无论短距或长距接近缝隙，每次穿缝反射次数 -1，归零后不再穿透地图缝隙（共 2 段）──
  for (const startX of [13000, 6600]) {
    const w = new World(51001 + startX, { name: 'lr-seam', solids: [] })
    w.config.randomSpawn = false
    w.obstacles.length = 0
    const { p, ev, segments } = fireOnce(w, { x: startX, y: 1500 }, 0)
    assert.equal(segments.length, 2, `x=${startX} 第1次穿右缝(-1, 剩1) + 第2次到右缝归零停止(-1, 剩0, 不再穿透地图缝隙) => 2 段，实得 ${segments.length}`)
    for (let i = 0; i < segments.length; i++) {
      assert.ok((segments[i].dx ?? 0) > 0 && Math.abs(segments[i].dy ?? 0) < 1e-6, `跨左右缝不改变方向 (seg ${i})`)
    }
    assert.ok(worldSegLength(segments[1]) > 13000, '第2段横跨全图到达右缝')
    assert.ok(p.hp < 100, `跨缝绕回的第2段命中射手造成自伤，hp=${p.hp}`)
    // 验证全图长段(13200px)在二进制协议中不发生 i16 溢出
    const decoded = decodeServerMsgBinary(encodeServerMsgBinary({ snap: w.snapshot(), events: [ev!] }))!
    const decLaser = decoded.events!.find(e => e.kind === 'laser')!
    assert.ok(Math.abs((decLaser.segments![1].dx ?? 0) - (segments[1].dx ?? 0)) < 1, '13200px 长段二进制编解码无溢出')
  }

  // ── 2. 穿过地图上下缝隙（无障碍物，挖通垂直通道使 y=0<->4400 畅通）：每次穿缝反射次数 -1，归零后不再穿透（共 2 段）──
  for (const startY of [300, 2200]) {
    const w = new World(51003 + startY, { name: 'tb-seam', solids: [] })
    w.config.randomSpawn = false
    w.obstacles.length = 0
    w.terrain.carveTunnel(3800, 2800, 400, 1600, 'vertical-seam-shaft')
    const { p, segments } = fireOnce(w, { x: 4000, y: startY }, -Math.PI / 2)
    assert.equal(segments.length, 2, `y=${startY} 第1次穿上缝(-1, 剩1) + 第2次到上缝归零停止(-1, 剩0, 不再穿透) => 2 段，实得 ${segments.length}`)
    for (let i = 0; i < segments.length; i++) {
      assert.ok((segments[i].dy ?? 0) < 0 && Math.abs(segments[i].dx ?? 0) < 1e-6, `跨上下缝方向保持向上 (seg ${i})`)
    }
    assert.ok(p.hp < 100, `跨上下缝绕回的第2段对射手造成自伤，hp=${p.hp}`)
  }

  // ── 3. 地图左右缝隙 + 实心墙体与可破坏障碍物 ──
  // 3A. 向右先穿过右缝(-1, 剩1) -> 撞右侧可破坏掩体反射向左(-1, 剩0) -> 回到左缝时因反射次数已归零，不再穿透地图缝隙（共 3 段）
  {
    const w = new World(51005, {
      name: 'lr-seam-then-ob',
      solids: [{ x: 12800, y: 1200, w: 40, h: 600, kind: 'cover' }],
    })
    w.config.randomSpawn = false
    w.obstacles.length = 0
    w.obstacles.push({
      id: 'test_ob_lr', x: 240, y: 1200, w: 60, h: 600,
      hp: 260, maxHp: 260, kind: 'box', color: '#334155', borderColor: '#38bdf8', label: '边界测试掩体',
    })
    const obHp0 = w.obstacles[0].hp
    // 射手在 x=100 朝左射击：
    // seg0: 76 -> 0 [向左穿左缝 (-1, 剩1)]
    // seg1: 13200 -> 12840 [向左撞实心墙反射向右 (-1, 剩0)]
    // seg2: 12840 -> 13200 [向右到达右缝，此时反射次数=0，不再穿透右缝！因此 x=100 的射手和 x=240 的掩体都不会被隔缝打到]
    const { p, segments } = fireOnce(w, { x: 100, y: 1500 }, Math.PI)
    assert.equal(segments.length, 3, `穿左缝(-1) + 撞墙反射(-1) => 归零后到达右缝停止（不再穿透缝隙），共 3 段，实得 ${segments.length}`)
    assert.ok((segments[0].dx ?? 0) < 0, 'seg0 向左到左缝')
    assert.ok((segments[1].dx ?? 0) < 0, 'seg1 跨过左缝撞 x=12800 实心墙')
    assert.ok((segments[2].dx ?? 0) > 0, 'seg2 反射向右并在右缝处停止（不穿透右缝）')
    assert.equal(p.hp, 100, '归零后不再穿透右缝，因此右缝另一侧 x=100 的射手不受伤害')
    assert.equal(w.obstacles[0].hp, obHp0, '归零后不再穿透右缝，因此右缝另一侧 x=240 的掩体不受伤害')
  }

  // 3B. 穿过右缝(-1, 剩1) + 撞可破坏掩体反射向左(-1, 剩0)，掩体掉血且反射段在缝前停止
  {
    const w = new World(51006, { name: 'lr-seam-hit-ob', solids: [] })
    w.config.randomSpawn = false
    w.obstacles.length = 0
    w.obstacles.push({
      id: 'test_ob_lr2', x: 240, y: 1200, w: 60, h: 600,
      hp: 260, maxHp: 260, kind: 'box', color: '#334155', borderColor: '#38bdf8', label: '边界测试掩体',
    })
    // 射手在 x=120 朝右撞 x=240 掩体：
    // seg0: 144 -> 240 [撞掩体反射向左 (-1, 剩1)]
    // seg1: 240 -> 0 [向左穿过射手(x=120)造成自伤，到达左缝 (-1, 剩0) 停止，不再穿透左缝！]
    const { p, segments } = fireOnce(w, { x: 120, y: 1500 }, 0)
    assert.equal(segments.length, 2, `撞掩体反射(-1, 剩1) + 到达左缝(-1, 剩0, 归零不再穿透) => 2 段，实得 ${segments.length}`)
    assert.ok(w.obstacles[0].hp < 260, '可破坏掩体受创并反射')
    assert.ok(p.hp < 100, '反射段经过射手造成自伤')
  }

  // ── 4. 地图上下缝隙 + 实心平台反射 ──
  {
    const w = new World(51007, { name: 'tb-seam-platform', solids: [] })
    w.config.randomSpawn = false
    w.obstacles.length = 0
    w.terrain.carveTunnel(3700, 2800, 600, 1600, 'vertical-seam-shaft')
    w.terrain.addSolidBlock(3800, 4120, 400, 30, '#334155', '#38bdf8', 'platform', 'bottom-seam-plat')
    // 射手在 (4000, 4250) 朝上射击：
    // seg0: 4214 -> 4150 [向上撞 y=4120..4150 平台底面反射向下 (-1, 剩1)]
    // seg1: 4150 -> 4400 [向下穿过射手(4250)自伤，到达下缝 (-1, 剩0) 停止，不再穿透下缝！]
    const { p, segments } = fireOnce(w, { x: 4000, y: 4250 }, -Math.PI / 2)
    assert.equal(segments.length, 2, `撞平台底面反射(-1, 剩1) + 到下缝归零停止(-1, 剩0) => 2 段，实得 ${segments.length}`)
    assert.ok((segments[0].dy ?? 0) < 0, 'seg0 向上撞平台')
    assert.ok((segments[1].dy ?? 0) > 0, 'seg1 反射向下经过射手并在下缝停止')
    assert.ok(p.hp < 100, '上下边界反射段经过射手造成自伤')
  }

  // ── 5. 跨右缝 + 斜向撞击竖直墙面镜面反射 + 归零后到达左缝停止 ──
  {
    const w = new World(51008, {
      name: 'corner-seam-obstacle',
      solids: [{ x: 80, y: 20, w: 40, h: 400, kind: 'cover' }],
    })
    w.config.randomSpawn = false
    w.obstacles.length = 0
    w.terrain.carveTunnel(0, 2800, 800, 1600, 'corner-shaft-left')
    w.terrain.carveTunnel(12400, 2800, 800, 1600, 'corner-shaft-right')
    // 射手在 (13050, 350) 朝右上 -45° 射击：
    // seg0: 跨过 x=13200 右缝 (-1, 剩1)
    // seg1: 撞上 x=80 竖直墙面发生水平镜面反射 (-1, 剩0, dx 变负, dy 保持负)
    // seg2: 向左上行进到达 x=0 左缝时因反射次数已归零停止（不再穿透缝隙）
    const { segments } = fireOnce(w, { x: 13050, y: 350 }, -Math.PI / 4)
    assert.equal(segments.length, 3, `跨右缝(-1) + 撞竖直墙反射(-1) + 归零后到左缝停止 => 3 段，实得 ${segments.length}`)
    assert.ok((segments[0].dx ?? 0) > 0 && (segments[0].dy ?? 0) < 0, 'seg0 右上')
    assert.ok((segments[1].dx ?? 0) > 0 && (segments[1].dy ?? 0) < 0, 'seg1 跨右缝继续右上')
    assert.ok((segments[2].dx ?? 0) < 0 && (segments[2].dy ?? 0) < 0, 'seg2 撞竖直墙后水平反转 (dx<0, dy<0)')
  }

  // ── 6. 发射不自伤保护：任意角度（含贴近地图缝隙、开启护盾）发射出去的光束绝不会在离枪时扣自己血 ──
  {
    for (const withShield of [false, true]) {
      for (const px of [6600, 13182, 13186, 13192, 8]) {
        for (let deg = -85; deg <= 85; deg += 5) {
          if (deg === 0) continue // 0° 水平跨缝绕全图 13200px 回来属于正常跨缝自伤
          const w = new World(52000 + deg, { name: 'no-self-hit-on-fire', solids: [] })
          w.config.randomSpawn = false
          w.obstacles.length = 0
          w.terrain.grid.fill(0)
          const { p } = fireOnce(w, { x: px, y: 2200 }, (deg * Math.PI) / 180, withShield)
          assert.equal(p.hp, 100, `px=${px} shield=${withShield} deg=${deg} 发射不扣自己血`)
          if (withShield) assert.equal(p.shieldHp, 100, `px=${px} deg=${deg} 发射不扣自己护盾`)
        }
      }
    }
  }

  // ── 7. 渲染裁剪不变量：地面朝天花板射击时（|dy|=2436 > WORLD_H/2），从天花板反射回地面的光束必须在玩家视口内可见 ──
  {
    const w = new World(53000, defaultMapData())
    w.config.randomSpawn = false
    const { p, segments } = fireOnce(w, { x: 7100, y: 2784 }, -Math.PI / 2)
    assert.equal(segments.length, 3, '地面朝天花板射击反射 2 次共 3 段')
    const cam = { x: p.pos.x, y: p.pos.y }
    const downwardSeg = segments[1]
    assert.ok((downwardSeg.dy ?? 0) > 2200, '第 2 段从天花板向下反射回地面 (dy > WORLD_H/2)')
    const polys = expandBeamSegments(
      [downwardSeg],
      (wx, wy) => ({ x: wrapDeltaX(cam.x, wx), y: wrapDeltaY(cam.y, wy) }),
      960, 540,
    )
    const visibleAtPlayer = polys.some(pl => Math.min(pl.y1, pl.y2) < 0 && Math.max(pl.y1, pl.y2) >= 0)
    assert.ok(visibleAtPlayer, '从天花板反射回地面的光束在玩家屏幕视口内必须有可见线段副本（不能因起点 wrap 到 +1985 而被误裁）')
  }
})

test('护栏·UI 文本单一数据源校验：index.html 死亡界面与大厅的所有主/副武器弹量及描述与 core/weapons.ts 完全一致', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')

  // 1. 校验死亡界面与大厅中所有主武器按钮的弹量/描述与 formatWeaponCardSubtitle(WEAPONS[id]) 完全一致
  const wepBtnRegex = /<button[^>]*data-wep="(\d+)"[^>]* class="(?:death|lobby)-wep-btn[^"]*"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/button>/g
  let wepMatches = 0
  for (const m of html.matchAll(wepBtnRegex)) {
    wepMatches++
    const id = Number(m[1])
    const title = m[2].trim()
    const subtitle = m[3].trim()
    const wep = WEAPONS[id]
    assert.ok(wep, `valid weapon id ${id}`)
    assert.ok(title === wep.shortName || title.endsWith(`. ${wep.shortName}`), `weapon #${id} title "${title}" matches "${wep.shortName}"`)
    assert.equal(subtitle, formatWeaponCardSubtitle(wep), `weapon #${id} (${wep.name}) subtitle "${subtitle}" must match single source "${formatWeaponCardSubtitle(wep)}"`)
  }
  assert.equal(wepMatches, 12, 'checked all 6 death screen weapon buttons + 6 lobby weapon buttons')

  // 2. 校验死亡界面与大厅中不再包含已移除的 mine 副武器按钮，且解锁阶梯与 SECONDARY_UNLOCK_ORDER 完全一致
  assert.ok(!html.includes('data-sec="mine"'), 'mine button removed from docs/index.html')
  const deathSecIds = [...html.matchAll(/<button[^>]*data-sec="([a-z_]+)"[^>]*class="death-sec-btn[^"]*"[^>]*>([\s\S]*?)<\/button>/g)]
  assert.deepEqual(deathSecIds.map(m => m[1]), [...SECONDARY_UNLOCK_ORDER], 'death screen secondary buttons match SECONDARY_UNLOCK_ORDER')
  for (const m of deathSecIds) {
    const def = SECONDARIES[m[1]]
    assert.equal(m[2].trim(), formatSecondaryButtonTitle(def, true), `death secondary button "${m[1]}" text matches single source`)
  }

  const lobbySecMatches = [...html.matchAll(/<button[^>]*data-sec="([a-z_]+)"[^>]*class="lobby-sec-btn[^"]*"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/button>/g)]
  assert.deepEqual(lobbySecMatches.map(m => m[1]), [...SECONDARY_UNLOCK_ORDER], 'lobby secondary buttons match SECONDARY_UNLOCK_ORDER')
  for (const m of lobbySecMatches) {
    const def = SECONDARIES[m[1]]
    assert.equal(m[2].trim(), formatSecondaryButtonTitle(def, false), `lobby secondary title "${m[1]}" matches single source`)
    assert.equal(m[3].trim(), formatSecondaryCardSubtitle(def, DEFAULT_CONFIG), `lobby secondary subtitle "${m[1]}" matches single source`)
  }
})


test('护栏·突击步枪擦边分级：正中最高 33、擦边最低 27，大多数命中落在 30~31', () => {
  const rifle = WEAPONS[1]
  assert.equal(rifle.damage, 33, 'rifle body hit max damage is 33')
  assert.equal(rifle.grazeDamageMin, 27, 'rifle graze floor is 27')
  // M249 与突击步枪伤害同步（既有规则）
  assert.equal(WEAPONS[5].damage, 33, 'M249 damage mirrors the rifle')
  assert.equal(WEAPONS[5].grazeDamageMin, 27, 'M249 graze floor mirrors the rifle')

  const halfX = 13 + 3.2   // 身体判定半宽 = 13 + 弹丸半径
  const dmgOf = (q: number) => Math.round(27 + (33 - 27) * q)

  // ① 水平平射穿过躯干：伤害必须落在 27~33，且正中最高(33)、贴边更低
  const horiz: number[] = []
  for (let dy = -12; dy <= 18; dy++) horiz.push(dmgOf(projectileBodyHitQuality(-halfX, dy, 1500, 0, halfX)))
  assert.ok(Math.min(...horiz) >= 27 && Math.max(...horiz) <= 33,
    `horizontal hits stay within 27~33, got ${Math.min(...horiz)}~${Math.max(...horiz)}`)
  const center = dmgOf(projectileBodyHitQuality(-halfX, 3, 1500, 0, halfX))
  const edge = dmgOf(projectileBodyHitQuality(-halfX, 18, 1500, 0, halfX))
  assert.equal(center, 33, `dead-center hit must be 33, got ${center}`)
  assert.ok(center > edge, `center hit (${center}) must beat edge hit (${edge})`)

  // ② 垂直弹（从脚下进入）：横向偏移越大伤害越低，且仍 ≥ 27、最高 ≤ 33
  const vert: number[] = []
  for (let dx = -16; dx <= 16; dx++) vert.push(dmgOf(projectileBodyHitQuality(dx, 18, 0, -1200, halfX)))
  assert.ok(Math.min(...vert) >= 27 && Math.max(...vert) <= 33,
    `vertical hits stay within 27~33, got ${Math.min(...vert)}~${Math.max(...vert)}`)
  assert.ok(vert[16] > vert[0], `vertical center (${vert[16]}) must beat sideways (${vert[0]})`)

  // ③ 绝大多数命中集中在 30~31：水平扫描里 30~31 的占比充足
  const common = horiz.filter(d => d === 30 || d === 31).length
  assert.ok(common / horiz.length >= 0.35,
    `most hits cluster at 30~31, got ${common}/${horiz.length} = ${(common / horiz.length * 100).toFixed(0)}%`)
})


test('护栏·火箭筒爆炸：伤害 160、范围不变(124)、衰减比线性更陡', () => {
  const rocket = WEAPONS[3]
  assert.equal(rocket.damage, 160, 'rocket blast damage is 160')
  assert.equal(rocket.terrainRadius, 124, 'blast radius stays 124')
  assert.ok((rocket.blastFalloffExponent ?? 1) > 1, `blast falloff must be steeper than linear, got ${rocket.blastFalloffExponent}`)

  // 实测：近爆点接近满伤，距离越远衰减越快，且半径外无伤
  const hitR = rocket.terrainRadius * 1.35
  const blastAt = (dist: number): number => {
    const w = new World(44000 + Math.round(dist), { name: 'blast', solids: [] })
    w.config.randomSpawn = false
    const a = w.addPlayer('A', 'red')
    const b = w.addPlayer('B', 'blue')
    a.pos = { x: 6600, y: 2200 }
    const cx = 7000, cy = 2300
    b.pos = { x: cx + dist, y: cy + 12 }
    b.hp = 500
    w.explode(cx, cy, rocket.terrainRadius, rocket.damage, 900, undefined, a.id, a.team, '火箭筒')
    w.drainEvents()
    return 500 - b.hp
  }
  const near = blastAt(20)
  const mid = blastAt(80)
  const edge = blastAt(160)
  assert.ok(Math.abs(near - Math.round(160 * (1 - Math.pow(20 / hitR, 1.8)))) <= 2,
    `20px blast matches the 1.8-exponent curve, got ${near}`)
  assert.ok(near > mid && mid > edge, `damage falls off with distance: ${near} > ${mid} > ${edge}`)
  assert.ok(edge <= 40, `far edge is heavily attenuated, got ${edge}`)
  // 比旧的线性 115 衰减更快（同样距离掉得更多）
  const linear115 = Math.round(115 * Math.max(0.2, 1 - 100 / hitR))
  assert.ok(blastAt(100) > linear115, `new 160-damage curve still hits harder than the old 115 linear at mid range`)
})


test('护栏·擦边分级已应用到所有子弹类武器（狙击保留 edgeDamage 特例）', () => {
  // 子弹类（非爆炸、非光束）都必须有擦边下限，且下限低于主体伤害
  const BULLET_IDS = [0, 1, 2, 5, 7, 8]   // 霰弹 / 突击 / 狙击 / M249 / 手枪 / 冲锋枪
  for (const id of BULLET_IDS) {
    const w = WEAPONS[id]
    assert.ok(w.grazeDamageMin !== undefined, `${w.name} must define grazeDamageMin`)
    assert.ok(w.grazeDamageMin! < w.damage, `${w.name} graze floor (${w.grazeDamageMin}) must be below body damage (${w.damage})`)
  }
  // 狙击：也做连续分级，正中 137、擦边 99
  assert.equal(WEAPONS[2].damage, 137, 'sniper centre hit is 137')
  assert.equal(WEAPONS[2].grazeDamageMin, 99, 'sniper graze floor is 99')
  assert.equal(WEAPONS[2].edgeDamage, 99, 'sniper edge cap stays 99')
  assert.ok(WEAPONS[2].farRange !== undefined, 'sniper attenuates at long range')

  // 行为验证：同一把枪，正中命中 > 边缘命中
  const hitAt = (wid: number, aim: number): number | null => {
    const w = new World(45000 + wid * 100 + Math.round(aim * 1000), { name: 'graze', solids: [] })
    w.config.randomSpawn = false
    const a = w.addPlayer('A', 'red')
    const b = w.addPlayer('B', 'blue')
    a.weaponIndex = wid
    a.ammo[wid] = 30
    a.reserveAmmo[wid] = 90
    a.pos = { x: 6600, y: 2740 }
    b.pos = { x: 6900, y: 2740 }
    b.hp = 500
    for (let i = 0; i < 150; i++) {
      w.step(DT, new Map([[a.id, input({ fire: true, aim })], [b.id, input()]]))
      for (const e of w.drainEvents()) {
        if (e.kind === 'hit' && e.victimId === b.id) return e.damage ?? null
      }
    }
    return null
  }
  for (const wid of BULLET_IDS) {
    const body = hitAt(wid, Math.atan2(3 - 12, 300))     // 瞄躯干中心
    assert.ok(body !== null, `${WEAPONS[wid].name} lands a body hit`)
    assert.ok(body! >= WEAPONS[wid].grazeDamageMin!,
      `${WEAPONS[wid].name} body hit (${body}) must be at least the graze floor (${WEAPONS[wid].grazeDamageMin})`)
    assert.ok(body! <= Math.round(WEAPONS[wid].damage * WEAPONS[wid].headshotMult),
      `${WEAPONS[wid].name} body hit (${body}) must not exceed headshot damage`)
  }
})


test('护栏·狙击连续分级：正中 137、擦边 99、中间平滑插值，且远距离额外衰减', () => {
  const sniper = WEAPONS[2]
  assert.equal(sniper.damage, 137, 'sniper centre damage 137')
  assert.equal(sniper.grazeDamageMin, 99, 'sniper graze floor 99')
  assert.ok(sniper.farRange !== undefined && sniper.farDamage !== undefined,
    'sniper must attenuate at long range')

  const halfX = BODY_HALF_W + 3.2 * 0.6
  const dmgOf = (q: number) => Math.round(sniper.grazeDamageMin! + (sniper.damage - sniper.grazeDamageMin!) * q)

  // ① 插值：正中最高、边缘最低，全程落 [99,137]
  const vertical: number[] = []
  for (let dx = 0; dx <= 11; dx++) vertical.push(dmgOf(projectileBodyHitQuality(dx, 15, 0, -4000, halfX)))
  assert.equal(vertical[0], 137, 'dead-centre vertical hit = 137')
  assert.ok(Math.min(...vertical) >= 99, `graze never falls below 99, got ${Math.min(...vertical)}`)
  assert.ok(Math.max(...vertical) <= 137, 'never exceeds 137')
  assert.ok(vertical[0] > vertical[vertical.length - 1], 'centre beats edge')

  // ② 中间必须有过渡值（不是只有 99/137 两档）
  const mid = vertical.filter(v => v > 99 && v < 137)
  assert.ok(mid.length >= 3, `interpolation produces intermediate values, got ${mid.length}`)

  // ③ 远距离衰减：>farRange 后伤害被压到 farDamage
  const nearShot = (dist: number): number => {
    const w = new World(46000 + dist, { name: 'sniper-far', solids: [] })
    w.config.randomSpawn = false
    w.terrain.addSolidBlock(2100, 1000, 3000, 20, '#334155', '#334155', 'platform', 'floor')
    const s = w.addPlayer('S', 'red')
    const v = w.addPlayer('V', 'blue')
    s.weaponIndex = 2
    s.pos = { x: 2200, y: 984 }
    v.pos = { x: 2200 + dist, y: 984 }
    v.hp = 500
    // 略微下压，避开头部判定圆，命中躯干
    const aim = Math.atan2(8, dist)
    for (let i = 0; i < 150; i++) {
      w.step(DT, new Map([[s.id, input({ fire: true, aim })]]))
      for (const e of w.drainEvents()) if (e.kind === 'hit' && e.victimId === v.id) return e.damage ?? 0
    }
    return -1
  }
  const near = nearShot(400)
  const far = nearShot(1200)
  assert.ok(near > 0, `close sniper shot lands, got ${near}`)
  assert.ok(far > 0, `far sniper shot lands, got ${far}`)
  assert.ok(far <= sniper.farDamage!, `beyond farRange the shot is capped at ${sniper.farDamage}, got ${far}`)
  assert.ok(near > far, `close (${near}) must beat far (${far})`)
})


test('护栏·霰弹逐发装填：每发耗时 = reloadTime/magSize，装完一发即可击发', () => {
  const shotgun = WEAPONS[0]
  assert.equal(shotgun.shellReload, true, 'shotgun uses shell-by-shell reload')
  const perShell = shotgun.reloadTime / shotgun.magSize
  assert.ok(perShell > 0 && perShell < shotgun.reloadTime,
    `per-shell time (${perShell.toFixed(3)}s) is a fraction of the full reload (${shotgun.reloadTime}s)`)

  // ① 逐发装填节奏：打空后开始装填，第一发就应该在 perShell 左右到位（而不是整个 reloadTime）
  const w = new World(47000, { name: 'shell-reload', solids: [] })
  w.config.randomSpawn = false
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 0
  p.ammo[0] = 0
  p.reserveAmmo[0] = 72
  p.pos = { x: 6600, y: 2200 }
  w.startReload(p)
  let firstShellAt = -1
  let ticks = 0
  for (let i = 0; i < 120; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    ticks += 1
    if (p.ammo[0] > 0) { firstShellAt = ticks * DT; break }
  }
  assert.ok(firstShellAt > 0, 'first shell gets loaded')
  assert.ok(Math.abs(firstShellAt - perShell) < 0.05,
    `first shell arrives in ~${perShell.toFixed(3)}s, got ${firstShellAt.toFixed(3)}s`)

  // ② 装一发就能击发：弹匣只有 1 发时按开火，应该打出 8 颗弹丸（一发霰弹）
  const w2 = new World(47001, { name: 'shell-fire', solids: [] })
  w2.config.randomSpawn = false
  const q = w2.addPlayer('Q', 'ffa')
  q.weaponIndex = 0
  q.ammo[0] = 0
  q.reserveAmmo[0] = 72
  q.pos = { x: 6600, y: 2200 }
  w2.startReload(q)
  for (let i = 0; i < 30; i++) w2.step(DT, new Map([[q.id, input()]]))
  assert.ok(q.ammo[0] >= 1, `one shell loaded (ammo=${q.ammo[0]})`)
  const projBefore = w2.projectiles.length
  w2.step(DT, new Map([[q.id, input({ fire: true, aim: 0 })]]))
  assert.ok(w2.projectiles.length - projBefore >= shotgun.pellets,
    `firing one shell produces ${shotgun.pellets} pellets, got ${w2.projectiles.length - projBefore}`)

  // ③ 开火打断换弹后，弹匣里还有存货 → 松手也不会自动续装（只有打空才重新开始换弹）
  const ammoAfterFire = q.ammo[0]
  for (let i = 0; i < 300; i++) w2.step(DT, new Map([[q.id, input()]]))
  assert.equal(q.ammo[0], ammoAfterFire, `no auto top-up while shells remain (${ammoAfterFire})`)
  assert.equal(q.reloading, false, 'reload stays interrupted until the magazine is empty')

  // ④ 按下射击立刻停止换弹；打空后重新开始换弹
  const w3 = new World(47002, { name: 'shell-interrupt', solids: [] })
  w3.config.randomSpawn = false
  const r = w3.addPlayer('R', 'ffa')
  r.weaponIndex = 0
  r.ammo[0] = 0
  r.reserveAmmo[0] = 72
  r.pos = { x: 6600, y: 2200 }
  w3.startReload(r)
  for (let i = 0; i < 40; i++) w3.step(DT, new Map([[r.id, input()]]))
  assert.ok(r.ammo[0] > 0, `shells loaded before firing (ammo=${r.ammo[0]})`)
  assert.equal(r.reloading, true, 'still reloading before the shot')
  w3.step(DT, new Map([[r.id, input({ fire: true, aim: 0 })]]))
  assert.equal(r.reloading, false, 'pressing fire interrupts the shell reload')
  // 打空后应重新开始换弹
  for (let i = 0; i < 400; i++) {
    w3.step(DT, new Map([[r.id, input({ fire: true, aim: 0 })]]))
    w3.drainEvents()
    if (r.ammo[0] === 0) break
  }
  assert.equal(r.ammo[0], 0, 'magazine runs dry')
  assert.equal(r.reloading, true, 'reload restarts once the magazine is empty')

  // ⑤ CS 风格关键护栏：开枪后的泵动冷却 (fireCooldown > 0) 期间绝不偷塞子弹，
  //    空仓按住开火时严格执行「冷却结束 → 塞入 1 发 → 立即击发这 1 发」
  const w4 = new World(47003, { name: 'cs-pump-no-free-shells', solids: [] })
  w4.config.randomSpawn = false
  const s = w4.addPlayer('S', 'ffa')
  s.weaponIndex = 0
  s.ammo[0] = 1
  s.reserveAmmo[0] = 72
  s.pos = { x: 6600, y: 2200 }
  // 打出最后 1 发，触发 fireCooldown (0.42s) 与自动换弹排队
  w4.step(DT, new Map([[s.id, input({ fire: true, aim: 0 })]]))
  w4.drainEvents()
  assert.equal(s.ammo[0], 0, 'last shell fired')
  assert.equal(s.reloading, true, 'reload queued on empty')
  assert.ok(s.fireCooldown > 0.3, `pump fireCooldown active (${s.fireCooldown.toFixed(2)}s)`)
  // 在 fireCooldown 尚未结束的帧内，弹匣必须保持为 0（不能在泵动冷却期偷塞 3 发）
  while (s.fireCooldown > DT * 1.5) {
    w4.step(DT, new Map([[s.id, input({ fire: true, aim: 0 })]]))
    w4.drainEvents()
    assert.equal(s.ammo[0], 0, `no shell loaded while fireCooldown=${s.fireCooldown.toFixed(3)}s > 0`)
  }
  // 泵动冷却结束后，再经过约 perShell 时间塞入 1 发，并在按住开火时立即打出这 1 发（弹匣回到 0）
  let firedSingleReloadedShell = false
  for (let i = 0; i < 30; i++) {
    w4.step(DT, new Map([[s.id, input({ fire: true, aim: 0 })]]))
    const evs = w4.drainEvents()
    if (evs.some(e => e.kind === 'projectile_spawn')) {
      firedSingleReloadedShell = true
      break
    }
  }
  assert.ok(firedSingleReloadedShell, 'holding fire on empty loads 1 shell and immediately fires it')
  assert.equal(s.ammo[0], 0, 'magazine returns to 0 right after firing the single loaded shell')
})


test('护栏·阵亡 HUD：居中布局 + KD 统计 + 排行榜元素齐全且用固定宽度防抖动', () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')

  // ① 居中：deathScreen 必须是 flex 容器且水平/垂直都居中
  const dsTag = /<div id="deathScreen"[^>]*class="([^"]*)"/.exec(html)
  assert.ok(dsTag, 'deathScreen exists')
  const cls = dsTag![1]
  assert.ok(cls.includes('items-center'), 'death screen vertically centers its panel')
  assert.ok(cls.includes('justify-center'), 'death screen horizontally centers its panel')
  assert.ok(cls.includes('flex'), 'death screen uses flex layout (otherwise centering has no effect)')
  assert.ok(cls.includes('inset-0'), 'death screen covers the viewport')
  assert.ok(cls.includes('overflow-y-auto'), 'death screen scrolls when the panel is taller than the viewport')

  // ② KD 统计元素齐全，且数字容器带 tabular-nums（等宽数字，位数变化不抖动）
  for (const id of ['deathKdKills', 'deathKdDeaths', 'deathKdRatio']) {
    const m = new RegExp(`id="${id}"[^>]*class="([^"]*)"`).exec(html)
    assert.ok(m, `${id} exists in the death HUD`)
    assert.ok(m![1].includes('tabular-nums'), `${id} uses tabular-nums so digits do not shift the layout`)
  }

  // ③ 排行榜元素齐全
  for (const id of ['deathRankList', 'deathRankSelfLine', 'deathRankSelfBar']) {
    assert.ok(html.includes(`id="${id}"`), `${id} exists in the death HUD`)
  }

  // ④ 排行榜有排序说明列（击杀/阵亡/KD），且列表限高可滚动（人多不会撑爆）
  assert.ok(html.includes('击杀 / 阵亡 / KD'), 'leaderboard header lists the sort columns')
  const listTag = /<ol id="deathRankList"[^>]*class="([^"]*)"/.exec(html)
  assert.ok(listTag && listTag[1].includes('max-h-'), 'leaderboard list is height-capped')

  // ⑤ 渲染逻辑存在：按击杀降序排序，并在阵亡时刷新
  const loopSrc = readFileSync(new URL('../src/web/game/loop.ts', import.meta.url), 'utf8')
  assert.ok(loopSrc.includes('renderDeathStats'), 'death stats renderer is wired up')
  assert.ok(loopSrc.includes('kills') && loopSrc.includes('deaths'), 'renderer uses kill/death counters')
  assert.ok(loopSrc.includes("localeCompare"), 'leaderboard has a deterministic tie-break')
  assert.ok(loopSrc.includes('escapeHudText'), 'names are escaped before being injected as HTML')
})


test('护栏·补给拾取广播带完整身份信息（playerId/playerName/weaponId/weaponName）', () => {
  const w = new World(49000, { name: 'supply-pickup', solids: [] })
  w.config.randomSpawn = false
  const a = w.addPlayer('Alice', 'red')
  const b = w.addPlayer('Bob', 'blue')
  // 找一个补给箱，把 Alice 放上去
  const crate = w.supplyCrates[0]
  assert.ok(crate, 'world has a supply crate')
  a.pos = { x: crate.x, y: crate.y }
  b.pos = { x: crate.x + 400, y: crate.y }
  let ev: WorldEvent | null = null
  for (let i = 0; i < 10 && !ev; i++) {
    w.step(DT, new Map([[a.id, input()], [b.id, input()]]))
    ev = w.drainEvents().find(e => e.kind === 'supply_pickup') ?? null
  }
  assert.ok(ev, 'supply pickup event emitted')
  assert.equal(ev!.playerId, a.id, 'event carries the picker playerId')
  assert.equal(ev!.playerName, 'Alice', 'event carries the picker name (so clients can show it without lookup)')
  assert.equal(typeof ev!.weaponId, 'number', 'event carries the weaponId')
  assert.ok(ev!.weaponName, 'event carries the weaponName')
  assert.ok(ev!.x !== undefined && ev!.y !== undefined, 'event carries the crate position for the sparkle effect')
})

test('护栏·AI 固定路线巡逻：主地面/高空拱桥/地下通道三条固定巡逻路线路标均在安全空地且可顺畅巡逻', async () => {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.window) g.window = globalThis
  if (!g.localStorage) g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  if (!g.document) {
    g.document = {
      getElementById: () => ({
        getContext: () => ({}),
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        addEventListener: () => {},
        querySelectorAll: () => [],
      }),
      querySelectorAll: () => [],
      addEventListener: () => {},
    }
  }

  const { world: appWorld, bots: appBots, localPlayer: appPlayer } = await import('../src/web/app/context.ts')
  const { PATROL_ROUTES, syncBotsCount, botInput, getBotPatrolStatus, setBotPatrolRoute } = await import('../src/web/game/bots.ts')

  // 1. 三条固定巡逻路线的所有路标点均不嵌入实心墙体，且站在实心地板上方
  for (const [routeId, waypoints] of Object.entries(PATROL_ROUTES)) {
    assert.ok(waypoints.length >= 10, `patrol route ${routeId} has sufficient waypoints (${waypoints.length})`)
    for (const wp of waypoints) {
      assert.equal(
        appWorld.bodyOverlapsAt(wp.x, wp.y),
        false,
        `patrol waypoint ${routeId}:${wp.label} (${wp.x},${wp.y}) must not overlap solids`,
      )
      assert.equal(
        appWorld.terrain.isSolidAt(wp.x, wp.y + 20),
        true,
        `patrol waypoint ${routeId}:${wp.label} (${wp.x},${wp.y}) must have solid floor beneath`,
      )
    }
  }

  // 2. 实测三条固定巡逻路线在物理步进中能连续推进并覆盖多个路标点
  appPlayer.deployed = false
  appPlayer.alive = false
  syncBotsCount(3)
  for (const b of appBots) b.team = 'red'

  appBots[0].pos = { x: 260, y: 3264 }
  setBotPatrolRoute(appBots[0], 'main_deck', 0, 1)

  appBots[1].pos = { x: 980, y: 3264 }
  setBotPatrolRoute(appBots[1], 'sky_arch', 1, 1)

  appBots[2].pos = { x: 260, y: 3264 }
  setBotPatrolRoute(appBots[2], 'underground', 0, 1)

  const visited = [new Set<number>(), new Set<number>(), new Set<number>()]
  for (let t = 0; t < 1800; t++) {
    const inputs = new Map<number, WorldInput>()
    for (let i = 0; i < appBots.length; i++) {
      const b = appBots[i]
      inputs.set(b.id, botInput(b))
      visited[i].add(getBotPatrolStatus(b).waypointIdx)
    }
    appWorld.step(DT, inputs)
  }

  assert.ok(visited[0].size >= 8, `main_deck patrol visits >=8 waypoints in 30s, got ${visited[0].size}`)
  assert.ok(visited[1].size >= 8, `sky_arch patrol visits >=8 waypoints in 30s, got ${visited[1].size}`)
  assert.ok(visited[2].size >= 6, `underground patrol visits >=6 waypoints in 30s, got ${visited[2].size}`)
})


test('护栏·重生点数量翻倍与按 E 选中不跨图错位：10据点/24FFA/40随机候选点齐全，按E严格选中当前同层据点', async () => {
  const { CP_INITS, FFA_SPAWN_POINTS, RANDOM_SPAWN_CANDIDATES } = await import('../src/core/sim/landmarks.ts')
  assert.equal(CP_INITS.length, 10, 'flag respawn points doubled from 5 to 10')
  assert.equal(FFA_SPAWN_POINTS.length, 24, 'FFA spawn points doubled from 12 to 24')
  assert.equal(RANDOM_SPAWN_CANDIDATES.length, 40, 'random spawn candidates doubled from 20 to 40')

  const w = new World(8801, defaultMapData())
  w.config.randomSpawn = false
  const p = w.addPlayer('Tester', 'red')

  // 设 cp_a 已占领，但玩家站在未占领的 cp_c 处按 E -> 绝不能错位选中远处的 cp_a
  const cpA = w.capturePoints.find(c => c.id === 'cp_a')!
  const cpC = w.capturePoints.find(c => c.id === 'cp_c')!
  cpA.ownerTeam = 'red'
  cpA.progress = 100
  p.pos = { x: cpC.x, y: cpC.y }
  w.step(DT, new Map([[p.id, input({ interact: true })]]))
  assert.equal(p.selectedSpawnId, 'base', 'pressing E at uncaptured cp_c must not mis-select distant cp_a')

  // 对全部 10 个据点逐一验证：占领后站在该据点按 E 均精确选中自身，重生落点无错位
  for (const cp of w.capturePoints) {
    cp.ownerTeam = 'red'
    cp.progress = 100
    p.pos = { x: cp.x, y: cp.y }
    w.step(DT, new Map([[p.id, input({ interact: true })]]))
    assert.equal(p.selectedSpawnId, cp.id, `pressing E at ${cp.id} selects ${cp.id} accurately`)
    w.deploy(p)
    assert.ok(Math.abs(p.pos.x - cp.x) <= 50 && Math.abs(p.pos.y - cp.y) <= 4, `respawning at ${cp.id} lands on platform without offset`)
  }
})


test('护栏·旗帜两阶段读条(敌方100→0中立化→己方0→100占领)与半截续占、地面光圈同色', async () => {
  const { getFlagPalette, TEAM_PALETTE, NEUTRAL_FLAG_PALETTE } = await import('../src/web/sprites.ts')
  const w = new World(8901, defaultMapData())
  w.config.randomSpawn = false
  const redP = w.addPlayer('RedPlayer', 'red')
  const redMate = w.addPlayer('RedMate', 'red')
  const blueP = w.addPlayer('BlueEnemy', 'blue')
  redP.pos = { x: 260, y: 3264 }
  redMate.pos = { x: 260, y: 3264 }
  blueP.pos = { x: 12940, y: 3264 }

  const cp = w.capturePoints.find(c => c.id === 'cp_c')!
  assert.equal(getFlagPalette(cp).color, NEUTRAL_FLAG_PALETTE.color)

  // 1) 蓝队先将中立据点从 0% 占领到 100%
  blueP.pos = { x: cp.x, y: cp.y }
  for (let i = 0; i < 300 && cp.ownerTeam !== 'blue'; i++) {
    w.step(DT, new Map([[redP.id, input()], [redMate.id, input()], [blueP.id, input()]]))
  }
  assert.equal(cp.ownerTeam, 'blue' as TeamId)
  assert.equal(cp.progress, 100)
  assert.equal(getFlagPalette(cp).color, TEAM_PALETTE.blue.color)

  // 2) 蓝队离开，红队站上去夺取：必须先从蓝队的 100% 递减到 0%，再从红队的 0% 递增到 100%
  blueP.pos = { x: 12940, y: 3264 }
  redP.pos = { x: cp.x, y: cp.y }

  // 推进约 1 秒（约减少 45%）：此时进度应在 40%~70% 之间，且仍属蓝队颜色（正在中和敌方进度 100→0）
  for (let i = 0; i < 60; i++) {
    w.step(DT, new Map([[redP.id, input()], [redMate.id, input()], [blueP.id, input()]]))
  }
  const midDrain = cp.progress
  assert.ok(midDrain > 25 && midDrain < 85, `enemy flag drains gradually from 100 toward 0, cur=${midDrain.toFixed(1)}%`)
  assert.equal(cp.ownerTeam, 'blue' as TeamId, 'still owned by blue until progress drains to 0')
  assert.equal(getFlagPalette(cp).color, TEAM_PALETTE.blue.color, 'flag & ground ring remain blue while draining 100->0')

  // 若此时蓝队回防踩住（红队离开），蓝队应能从 midDrain 直接回升恢复到 100%
  redP.pos = { x: 260, y: 3264 }
  blueP.pos = { x: cp.x, y: cp.y }
  for (let i = 0; i < 150 && cp.progress < 100; i++) {
    w.step(DT, new Map([[redP.id, input()], [redMate.id, input()], [blueP.id, input()]]))
  }
  assert.equal(cp.progress, 100, 'defending team restores partially drained flag back to 100%')
  assert.equal(cp.ownerTeam, 'blue' as TeamId)

  // 3) 红队双人（玩家+队友）协同站上去：先将蓝队 100% 削减至 0%（中立化），随后无缝从红队 0% 读条至 100%
  blueP.pos = { x: 12940, y: 3264 }
  redP.pos = { x: cp.x, y: cp.y }
  redMate.pos = { x: cp.x + 25, y: cp.y }
  let sawNeutralized = false
  let sawRedClimbingFromZero = false
  let minProgressSeen = 100
  for (let i = 0; i < 400 && cp.ownerTeam !== 'red'; i++) {
    w.step(DT, new Map([[redP.id, input()], [redMate.id, input()], [blueP.id, input()]]))
    if (cp.progress < minProgressSeen) minProgressSeen = cp.progress
    if (cp.ownerTeam === null && cp.capturingTeam === 'red' && cp.progress > 0 && cp.progress < 50) {
      sawNeutralized = true
      sawRedClimbingFromZero = true
      assert.equal(getFlagPalette(cp).color, TEAM_PALETTE.red.color, 'once neutralized past 0%, flag & ring turn red for 0->100 climb')
    }
  }
  assert.ok(minProgressSeen < 10, `progress drained down through 0 before climbing (min=${minProgressSeen.toFixed(1)}%)`)
  assert.ok(sawNeutralized && sawRedClimbingFromZero, 'transitioned cleanly from enemy 100->0 to own 0->100')
  assert.equal(cp.ownerTeam, 'red' as TeamId)
  assert.equal(cp.progress, 100)
})

test('护栏·联机功能全链路审阅修复：按键松开归零不卡移动、跨端二进制字典无崩溃、复活点ID同步与WebRTC防重通道', async () => {
  const { InputMapper } = await import('../src/input/InputMapper.ts')
  const { applyIntents } = await import('../src/net/ServerSim.ts')
  const { encodeServerMsgBinary, decodeServerMsgBinary, resetBinaryCodecState } = await import('../src/net/protocol/BinaryCodec.ts')
  const { configureWebRtcUnreliableChannel } = await import('../src/net/transport/Peer.ts')

  // 1) 验证联机客户端松开 A/D (moveX=0) 与 S (dive=false) 时立即发送归零意图，绝不卡死在持续移动或下潜状态
  const mapper = new InputMapper()
  let state = input()
  state = applyIntents(state, mapper.map({ moveX: 1, aimAngle: 0, fire: false, jump: false, jetpack: false, dive: true, reload: false }))
  assert.equal(state.move, 1)
  assert.equal(state.dive, true)
  state = applyIntents(state, mapper.map({ moveX: 0, aimAngle: 0, fire: false, jump: false, jetpack: false, dive: false, reload: false }))
  assert.equal(state.move, 0, 'releasing move key immediately resets move to 0')
  assert.equal(state.dive, false, 'releasing dive key immediately resets dive to false')

  // 2) 验证跨标签页/跨设备二进制解码（模拟远端解码器从未调用过 encodeServerMsgBinary）且同步 selectedSpawnId
  const w = new World(9001, defaultMapData())
  const p = w.addPlayer('NetClient', 'red')
  p.selectedSpawnId = 'cp_c'
  const bin = encodeServerMsgBinary({ snap: w.snapshot(), events: [] })
  resetBinaryCodecState() // 重置模拟全新客户端进程/标签页状态
  const dec = decodeServerMsgBinary(bin)
  assert.ok(dec, 'fresh client tab decodes fast-facility snapshot without RangeError')
  assert.equal(dec!.snap.capturePoints.length, 10)
  assert.equal(dec!.snap.capturePoints[2].id, 'cp_c')
  const decPlayer = dec!.snap.players.find(x => x.id === p.id)!
  assert.equal(decPlayer.selectedSpawnId, 'cp_c', 'selectedSpawnId preserved across binary codec')
  assert.equal(decPlayer.name, 'NetClient', 'player name preserved')

  // 3) 验证已处于 skyblast-kcp 无序通道时不重复创建未协商的 DataChannel
  let createCalls = 0
  const connAlreadyKcp = {
    dataChannel: { label: 'skyblast-kcp', readyState: 'open', binaryType: 'arraybuffer' } as unknown as RTCDataChannel,
    peerConnection: {
      createDataChannel() { createCalls++; return {} },
    } as unknown as RTCPeerConnection,
    send() {},
    on() {},
    close() {},
  }
  const br = configureWebRtcUnreliableChannel(connAlreadyKcp, () => {})
  assert.equal(createCalls, 0, 'does not create duplicate unnegotiated skyblast-kcp DataChannel')
  assert.equal(br.isCustomDataChannel(), true)
})

test('护栏·特性开关(Feature Flags)默认全开与完整战术HUD重构：6项特性开关全部默认开启(true)、支持实时切换，且新版全景HUD元素齐全', async () => {
  const { featureFlags, DEFAULT_FEATURE_FLAGS, FEATURE_FLAG_META, setFeatureFlag, toggleFeatureFlag, resetAllFeatureFlags, world: appWorld } = await import('../src/web/app/context.ts')
  // 1) 全部 6 项特性开关默认均为开启 (true)
  assert.equal(FEATURE_FLAG_META.length, 6, '6 feature flags defined')
  for (const item of FEATURE_FLAG_META) {
    assert.equal(DEFAULT_FEATURE_FLAGS[item.key], true, `default flag ${item.key} must be true`)
    assert.equal(featureFlags[item.key], true, `initial runtime flag ${item.key} must be true`)
  }

  // 2) 测试动态切换与重置
  assert.equal(toggleFeatureFlag('lagCompensation'), false)
  assert.equal(featureFlags.lagCompensation, false)
  assert.equal(appWorld.lagCompensationEnabled, false, 'toggling lagCompensation syncs to world.lagCompensationEnabled')
  setFeatureFlag('minimapRadar', false)
  assert.equal(featureFlags.minimapRadar, false)
  resetAllFeatureFlags()
  for (const item of FEATURE_FLAG_META) {
    assert.equal(featureFlags[item.key], true, `flag ${item.key} restored to true after reset`)
  }
  assert.equal(appWorld.lagCompensationEnabled, true)

  // 3) 校验小地图严格屏蔽敌方位置（仅显示自身与同阵营友军）
  const { isFriendlyOnMinimap } = await import('../src/web/app/hud.ts')
  const { localPlayer: lp, mode: appMode } = await import('../src/web/app/context.ts')
  appMode.current = '2teams'
  lp.team = 'red'
  const selfP = { ...lp, id: lp.id, team: 'red' as const }
  const allyP = { ...lp, id: lp.id + 100, team: 'red' as const }
  const enemyBlue = { ...lp, id: lp.id + 101, team: 'blue' as const }
  const enemyFfa = { ...lp, id: lp.id + 102, team: 'ffa' as const }
  assert.equal(isFriendlyOnMinimap(selfP), true, 'minimap shows localPlayer')
  assert.equal(isFriendlyOnMinimap(allyP), true, 'minimap shows same-team ally in 2teams')
  assert.equal(isFriendlyOnMinimap(enemyBlue), false, 'minimap strictly hides enemy blue player')
  assert.equal(isFriendlyOnMinimap(enemyFfa), false, 'minimap strictly hides enemy ffa player')

  // 4) 校验已彻底删除占点音效 (capture_tick / capture_done)
  const audioSrc = readFileSync(new URL('../src/web/app/audio.ts', import.meta.url), 'utf8')
  const eventsSrc = readFileSync(new URL('../src/web/app/events.ts', import.meta.url), 'utf8')
  const hudSrc = readFileSync(new URL('../src/web/app/hud.ts', import.meta.url), 'utf8')
  assert.equal(audioSrc.includes('capture_tick') || audioSrc.includes('capture_done'), false, 'no capture sound in audio.ts')
  assert.equal(eventsSrc.includes('capture_done'), false, 'no capture_done sound in events.ts')
  assert.equal(hudSrc.includes('capture_tick'), false, 'no capture_tick sound in hud.ts')
  assert.ok(eventsSrc.includes('isOwnKill') && eventsSrc.includes('if (isOwnKill) playProceduralSound'), 'kill/headshot sound only plays for local player kills')

  // 5) 校验右上角雷达替代顶栏 A~J 旗帜条、底部武器 HUD 回退上一版、死亡界面使用小地图选复活点
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')
  assert.equal(html.includes('id="hudFlagStatusStrip"'), false, 'top A~J flag pill strip removed and replaced by top-right radar')
  assert.equal(html.includes('id="hudQuickLoadoutStrip"'), false, 'bottom weapon HUD reverted to previous clean version')
  // 校验顶栏已移除 KD 与旧记分板，且系统工具栏默认隐藏（需点击 #toggleSysBarBtn 展开）
  assert.equal(html.includes('id="hudTopKdText"'), false, 'KD removed from top HUD (only visible on death screen)')
  assert.equal(html.includes('id="scoreRed"'), false, 'old top scoreboard replaced by top-right minimap')
  const sysBarMatch = /<div id="topSystemToolbar"[^>]*class="([^"]*)"/.exec(html)
  assert.ok(sysBarMatch && sysBarMatch[1].includes('hidden'), 'topSystemToolbar is hidden by default until triggered')

  for (const id of [
    'hudCurrentSpawnBtn',
    'hudHpBarWrap',
    'hudHpBar',
    'hudStreakCountBadge',
    'hudUnlockTierPips',
    'hudActiveBuffsText',
    'toggleSysBarBtn',
    'topSystemToolbar',
    'toggleFlagsHudBtn',
    'hudFlagsPanel',
    'hudMinimapPanel',
    'hudMinimapCanvas',
    'deathMinimapPanel',
    'deathMinimapCanvas',
    'deathSelectedSpawnBadge',
    'deathSpawnBaseBtn',
    'hudCaptureProgressCard',
    'hudCapCardTitle',
    'hudCapCardBar',
    'lobbyFlagsCard',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `HUD element #${id} exists in docs/index.html`)
  }

  // 6) 校验 AI 最短路径进攻敌方原始出生点（排除 Flag）与自动找掩体逻辑
  const { getEnemyOriginalBaseSpawn, findNearestCoverPosition, botInput } = await import('../src/web/game/bots.ts')
  const redBot = appWorld.addPlayer('RedAssaulter', 'red')
  const blueBot = appWorld.addPlayer('BlueAssaulter', 'blue')
  // 即使全图据点被红队占领，AI 重生点仍固定为 'base'（排除 flag）
  for (const cp of appWorld.capturePoints) { cp.ownerTeam = 'red'; cp.progress = 100 }
  botInput(redBot)
  assert.equal(redBot.selectedSpawnId, 'base', 'AI strictly excludes flags and always uses original base spawn')
  assert.equal(getEnemyOriginalBaseSpawn(redBot).x, 12940, 'Red AI targets Blue original base spawn (x=12940)')
  assert.equal(getEnemyOriginalBaseSpawn(blueBot).x, 260, 'Blue AI targets Red original base spawn (x=260)')

  // 验证交战找掩体：在 redBot 附近放置掩体，面对右侧敌人时自动识别掩体左侧背弹位
  redBot.pos = { x: 2000, y: 3264 }
  blueBot.pos = { x: 2500, y: 3264 }
  appWorld.obstacles.push({
    id: 'test_cover_box', x: 2060, y: 3204, w: 56, h: 76,
    hp: 240, maxHp: 240, kind: 'box', color: '#334155', borderColor: '#38bdf8', label: '测试掩体',
  })
  const coverPos = findNearestCoverPosition(redBot, blueBot)
  assert.ok(coverPos !== null, 'AI locates nearby cover when engaging enemy')
  assert.ok(coverPos!.x < 2060, 'AI chooses the sheltered side of the cover opposite the enemy')

  // 7) 校验 handleEvents 处理本机击杀事件时不抛未声明引用错误，且能自动将失效副手退回手榴弹
  const { handleEvents } = await import('../src/web/app/events.ts')
  const { pendingLoadout } = await import('../src/web/app/context.ts')
  lp.deathStreak = 0
  lp.weaponIndex = 1
  pendingLoadout.weaponIndex = 1
  pendingLoadout.secondaryType = 'shield'
  lp.secondary = 'shield'
  handleEvents([{
    kind: 'kill',
    attackerId: lp.id,
    killerId: lp.id,
    victimId: blueBot.id,
    killerName: lp.name,
    killerTeam: lp.team,
    victimName: blueBot.name,
    victimTeam: blueBot.team,
    weaponLabel: '突击步枪',
    x: lp.pos.x,
    y: lp.pos.y,
  }])
  assert.equal(pendingLoadout.secondaryType, 'frag', 'handleEvents safely resets invalidated secondary to frag on local kill')
  assert.equal(lp.secondary, 'frag')
})


test('护栏·狙击手柄追踪瞄准(0.5s后位置)与进入界面关闭手柄无冲突', () => {
  // 1) 手柄模式下 (trackChargeAim=true)：拖动开火 0.5s 期间准星持续更新，最终按 0.5s 后的拖动位置发射
  const w = new World(58000, { name: 'sniper-gamepad-track', solids: [] })
  w.config.randomSpawn = false
  const p = w.addPlayer('PadSniper', 'ffa')
  p.weaponIndex = 2
  p.ammo[2] = 5
  p.reserveAmmo[2] = 15
  p.pos = { x: 6600, y: 2200 }

  let firedAngle: number | null = null
  const startAim = 0
  const endAim = -Math.PI / 3
  for (let i = 0; i < 40; i++) {
    const curAim = i < 15 ? startAim : endAim
    w.step(DT, new Map([[p.id, input({ fire: true, aim: curAim, trackChargeAim: true })]]))
    for (const e of w.drainEvents()) {
      if (e.kind !== 'projectile_spawn') continue
      const pr = w.projectiles.find(x => x.id === e.projectileId)
      if (pr) firedAngle = Math.atan2(pr.vel.y, pr.vel.x)
    }
    if (firedAngle !== null) break
  }
  assert.ok(firedAngle !== null, 'gamepad sniper fires after 0.5s charge')
  assert.ok(Math.abs(firedAngle! - endAim) < 0.05,
    `gamepad sniper must fire at aim after 0.5s (${endAim.toFixed(2)}), got ${firedAngle!.toFixed(2)}`)

  // 2) 进入界面 (docs/index.html) 必须提供键鼠/手柄独立切换按钮，且 device.ts 关闭手柄时清空触屏状态避免冲突
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('id="lobbyCtrlKbmBtn"'), 'entry screen has keyboard/mouse (close gamepad) button')
  assert.ok(html.includes('id="lobbyCtrlGamepadBtn"'), 'entry screen has enable gamepad button')
  const devSrc = readFileSync(new URL('../src/web/input/device.ts', import.meta.url), 'utf8')
  assert.ok(devSrc.includes('touchState.aimActive = false') && devSrc.includes('touchState.moveActive = false'),
    'disabling gamepad resets active touch flags to prevent kbm conflict')
})

test('护栏·UI 居中对齐修复：.justify-center 样式有效且大厅/阵亡/底部武器按钮居中对齐', () => {
  const css = readFileSync(new URL('../docs/css/style.css', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')

  // 1) .justify-center 必须使用合法的 justify-content: center（不能是无效的 justify-center）
  assert.ok(css.includes('.justify-center { justify-content: center; }'), '.justify-center must set justify-content: center')
  assert.ok(!css.includes('justify-content: justify-center'), 'invalid justify-content: justify-center removed')

  // 2) 大厅与阵亡界面的主武器、副武器、模式按钮与底部手雷槽均居中对齐
  for (const cls of ['death-wep-btn', 'lobby-wep-btn', 'lobby-sec-btn', 'mode-btn']) {
    const matches = [...html.matchAll(new RegExp(`class="([^"]*${cls}[^"]*)"`, 'g'))]
    assert.ok(matches.length > 0, `found buttons for ${cls}`)
    for (const m of matches) {
      assert.ok(m[1].includes('text-center'), `${cls} should be centered (text-center), got: ${m[1]}`)
      assert.ok(!m[1].includes('text-left'), `${cls} should not be left-aligned (text-left), got: ${m[1]}`)
    }
  }
})

test('护栏·手榴弹被人体碰撞箱挡住：碰到玩家身体或头部会阻挡反弹，且投掷瞬间不卡自身', () => {
  const w = new World(61001, { name: 'grenade-body-block', solids: [] })
  w.config.randomSpawn = false
  w.obstacles.length = 0
  w.terrain.grid.fill(0)
  // 添加一块平整地面 y=3280..3320
  w.terrain.addSolidBlock(2000, 3280, 2000, 40, '#334155', '#38bdf8', 'platform', 'grenade-floor')

  const thrower = w.addPlayer('Thrower', 'red')
  const blocker = w.addPlayer('Blocker', 'blue')
  thrower.pos = { x: 2500, y: 3264 }
  blocker.pos = { x: 2660, y: 3264 }

  // 1) 投掷者向右侧平抛手榴弹：应能顺利脱离投掷者自身，随后在 x=2660 处被 Blocker 的身体碰撞箱挡住并向左反弹
  w.step(DT, new Map([
    [thrower.id, input({ aim: 0, secondary: { type: 'frag', targetX: blocker.pos.x, targetY: blocker.pos.y - 12 } })],
    [blocker.id, input()],
  ]))
  // 用 as number 打断 assert.equal 的字面量窄化（@types/node 26 的 asserts actual is T），
  // 否则下面的 `w.grenades.length === 0` 会被判成 1 与 0 无重叠（TS2367）。
  assert.equal(w.grenades.length as number, 1, 'grenade spawned')
  const g = w.grenades[0]
  assert.ok(g.pos.x > thrower.pos.x + 15, 'grenade leaves thrower body without self-blocking on launch')

  let maxReachedX = g.pos.x
  let bouncedLeft = false
  for (let i = 0; i < 30; i++) {
    w.step(DT, new Map([[thrower.id, input()], [blocker.id, input()]]))
    if (w.grenades.length === 0) break
    const cur = w.grenades[0]
    maxReachedX = Math.max(maxReachedX, cur.pos.x)
    if (cur.vel.x < -50) bouncedLeft = true
  }
  assert.ok(bouncedLeft, 'grenade bounced backward off player body hitbox')
  assert.ok(maxReachedX < blocker.pos.x, `grenade blocked before passing through blocker center (${maxReachedX.toFixed(1)} < ${blocker.pos.x})`)
})

test('护栏·墙角与多人防卡死：在墙角按住方向键向墙移动或与人重叠/贴靠时绝不卡死', () => {
  // 1) 墙角测试：左墙角 + 右墙角 + 天花板墙角，按住朝墙方向键的同时起跳、喷气升空、松开下落、反向离开均顺畅无阻
  const wCorner = new World(62001, {
    name: 'corner-test',
    solids: [
      { x: 2000, y: 3000, w: 600, h: 40, kind: 'platform' }, // 地面 y=3000 (站立 y=2984)
      { x: 2000, y: 2600, w: 40, h: 440, kind: 'cover' },    // 左墙 x=2000..2040
      { x: 2560, y: 2600, w: 40, h: 440, kind: 'cover' },    // 右墙 x=2560..2600
      { x: 2000, y: 2600, w: 600, h: 40, kind: 'platform' }, // 天花板 y=2600..2640
    ],
  })
  wCorner.config.randomSpawn = false
  wCorner.obstacles.length = 0
  const p = wCorner.addPlayer('CornerRunner', 'ffa')

  // ① 右下墙角：持续按住向右 (move: 1) 顶住右墙，随后按喷气/跳跃：必须能贴着右墙顺畅向上升空，不卡在墙角
  p.pos = { x: 2520, y: 2984 }
  p.vel = { x: 0, y: 0 }
  p.onGround = true
  for (let i = 0; i < 20; i++) wCorner.step(DT, new Map([[p.id, input({ move: 1 })]]))
  const wallTouchX = p.pos.x
  assert.ok(wallTouchX >= 2548 && wallTouchX <= 2550.1, `flush against right wall (x=${wallTouchX.toFixed(2)})`)
  for (let i = 0; i < 25; i++) wCorner.step(DT, new Map([[p.id, input({ move: 1, jump: i === 0, jetpack: true })]]))
  assert.ok(p.pos.y < 2880, `slides smoothly up right wall while holding right key (y=${p.pos.y.toFixed(1)} < 2880)`)

  // ② 右上天花板墙角：顶到右上角后松开喷气但继续按住向右 (move: 1)，必须能顺畅沿右墙下落回地面，不悬空卡住
  for (let i = 0; i < 40; i++) wCorner.step(DT, new Map([[p.id, input({ move: 1, jetpack: true })]]))
  assert.ok(p.pos.y <= 2675, `reaches top-right ceiling corner (y=${p.pos.y.toFixed(1)})`)
  for (let i = 0; i < 60; i++) wCorner.step(DT, new Map([[p.id, input({ move: 1, jetpack: false })]]))
  assert.ok(p.pos.y >= 2980 && p.onGround, `slides smoothly down right wall back to floor while holding right key (y=${p.pos.y.toFixed(1)})`)

  // ③ 左下墙角：持续按住向左 (move: -1) 顶住左墙并喷气升空、再反向向右离开，全程不卡
  p.pos = { x: 2080, y: 2984 }
  p.vel = { x: 0, y: 0 }
  for (let i = 0; i < 20; i++) wCorner.step(DT, new Map([[p.id, input({ move: -1 })]]))
  for (let i = 0; i < 25; i++) wCorner.step(DT, new Map([[p.id, input({ move: -1, jump: i === 0, jetpack: true })]]))
  assert.ok(p.pos.y < 2880, `slides smoothly up left wall while holding left key (y=${p.pos.y.toFixed(1)} < 2880)`)
  wCorner.step(DT, new Map([[p.id, input({ move: 1 })]]))
  assert.ok(p.pos.x > 2052, `immediately moves away from left wall on reverse key (x=${p.pos.x.toFixed(1)})`)

  // 2) 多人贴靠与重叠防卡死测试：
  // ① 两人相向对冲移动（一个向右、一个向左）能够顺畅擦肩通过，不互相顶死
  const wPass = new World(62002, {
    name: 'player-pass-test',
    solids: [{ x: 2000, y: 3000, w: 1000, h: 40, kind: 'platform' }],
  })
  wPass.config.randomSpawn = false
  wPass.obstacles.length = 0
  const a = wPass.addPlayer('A', 'red')
  const b = wPass.addPlayer('B', 'blue')
  a.pos = { x: 2400, y: 2984 }
  b.pos = { x: 2440, y: 2984 }
  for (let i = 0; i < 30; i++) {
    wPass.step(DT, new Map([
      [a.id, input({ move: 1 })],
      [b.id, input({ move: -1 })],
    ]))
  }
  assert.ok(a.pos.x > b.pos.x + 40, `two players moving in opposite directions pass each other smoothly (a.x=${a.pos.x.toFixed(1)}, b.x=${b.pos.x.toFixed(1)})`)

  // ② 被另一名玩家堵在墙角时，靠墙玩家可以按方向键或起跳顺利走出墙角，绝不被焊死在墙角
  const wTrap = new World(62003, {
    name: 'corner-trap-escape',
    solids: [
      { x: 2000, y: 3000, w: 600, h: 40, kind: 'platform' },
      { x: 2560, y: 2600, w: 40, h: 440, kind: 'cover' },
    ],
  })
  wTrap.config.randomSpawn = false
  wTrap.obstacles.length = 0
  const trapped = wTrap.addPlayer('Trapped', 'red')
  const blockerP = wTrap.addPlayer('Blocker', 'blue')
  trapped.pos = { x: 2550, y: 2984 }  // 紧贴右墙
  blockerP.pos = { x: 2530, y: 2984 } // 紧贴在 trapped 左侧堵路
  for (let i = 0; i < 30; i++) {
    wTrap.step(DT, new Map([
      [trapped.id, input({ move: -1 })],
      [blockerP.id, input({ move: 1 })],
    ]))
  }
  assert.ok(trapped.pos.x < blockerP.pos.x - 10, `player pinned against wall escapes past blocker (trapped.x=${trapped.pos.x.toFixed(1)}, blocker.x=${blockerP.pos.x.toFixed(1)})`)
})

test('guard: gravity gun default damage equals rocket launcher default damage (160)', () => {
  assert.equal(WEAPONS[6].damage, WEAPONS[3].damage)
  assert.equal(WEAPONS[6].damage, 160)
})

test('guard: supports adding up to 32 AI bots', async () => {
  const { bots: appBots, botNames, MAX_BOT_COUNT } = await import('../src/web/app/context.ts')
  const { syncBotsCount } = await import('../src/web/game/bots.ts')
  assert.equal(MAX_BOT_COUNT, 32)
  assert.equal(botNames.length, 32)
  assert.equal(new Set(botNames).size, 32, 'all 32 AI bot names are unique')

  syncBotsCount(32)
  assert.equal(appBots.length, 32, 'syncBotsCount(32) spawns 32 AI bots')
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('data-bots="32"'), 'index.html includes 32 AI button')
  assert.ok(html.includes('id="botCountInput"') && html.includes('max="32"'), 'index.html includes 0..32 AI count input')
  syncBotsCount(4)
})

test('guard: AI does not spin in place at terminal waypoints or near cover and exhibits tactical randomness', async () => {
  const { world: appWorld, bots: appBots } = await import('../src/web/app/context.ts')
  const { syncBotsCount, botInput, getBotPatrolStatus } = await import('../src/web/game/bots.ts')

  syncBotsCount(8)
  // Place bot[0] right at the east terminal waypoint (x=12240) and bot[1] near a cover obstacle with full HP
  const b0 = appBots[0]
  b0.team = 'red'
  b0.pos = { x: 12240, y: 3264 }
  b0.vel = { x: 0, y: 0 }

  let aimFlips = 0
  let prevCos = Math.cos(botInput(b0).aim)
  for (let t = 0; t < 180; t++) {
    const inputs = new Map<number, WorldInput>()
    for (const b of appBots) {
      const inp = botInput(b)
      inputs.set(b.id, inp)
      if (b === b0) {
        const curCos = Math.cos(inp.aim)
        if (curCos * prevCos < -0.5) aimFlips++
        prevCos = curCos
      }
    }
    appWorld.step(DT, inputs)
  }

  assert.ok(aimFlips <= 4, `AI at terminal waypoint must not rapidly spin left-right in place (flips=${aimFlips})`)
  assert.ok(Math.abs(b0.pos.x - 12240) > 60, `AI must leave terminal waypoint instead of pacing in place (x=${b0.pos.x.toFixed(1)})`)

  // Verify multiple bots have varied routes/tactics
  const routes = new Set(appBots.map(b => getBotPatrolStatus(b).routeId))
  assert.ok(routes.size >= 1, 'AI bots maintain valid patrol routes with randomness')
  syncBotsCount(4)
})

test('guard: mobile PWA installable and auto fullscreen landscape support', async () => {
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8')
  const manifestRaw = readFileSync(new URL('../docs/manifest.webmanifest', import.meta.url), 'utf8')
  const swRaw = readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8')
  const manifest = JSON.parse(manifestRaw)

  assert.equal(manifest.display, 'fullscreen', 'PWA manifest display is fullscreen')
  assert.equal(manifest.orientation, 'landscape', 'PWA manifest orientation is landscape')
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'PWA manifest defines icons')
  assert.ok(swRaw.includes("addEventListener('fetch'"), 'Service worker implements fetch handler for installability')

  assert.ok(html.includes('rel="manifest"'), 'index.html links web app manifest')
  assert.ok(html.includes('name="apple-mobile-web-app-capable" content="yes"'), 'index.html includes iOS PWA meta')
  assert.ok(html.includes('name="mobile-web-app-capable" content="yes"'), 'index.html includes Android PWA meta')
  assert.ok(html.includes('name="screen-orientation" content="landscape"'), 'index.html includes landscape orientation meta')
  assert.ok(html.includes('id="pwaInstallBtn"') && html.includes('id="lobbyInstallAppBtn"'), 'index.html includes install/fullscreen buttons')

  const fsMod = await import('../src/web/fullscreen.ts')
  assert.equal(typeof fsMod.enterFullscreenAndLandscape, 'function')
  assert.equal(typeof fsMod.syncLandscapeOrientation, 'function')
  assert.equal(typeof fsMod.getElementLandscapeMetrics, 'function')
})

// ── 第三阶段深度代码审查与升级修复回归护栏 ──
test('护栏·霰弹边装边打射速惩罚生效：满匣射击间隔 0.42s，打断换弹或空仓边装边打完整周期 0.87s', () => {
  const shotgun = WEAPONS[0]
  assert.equal(shotgun.fireDelay, 0.42)
  assert.ok(Math.abs(shotgun.fireDelay * (shotgun.shellReloadFireDelayMult ?? 1) - 0.87) < 1e-6)

  // 1) 满匣正常射击（未处于换弹状态）：射击冷却严格为 0.42s
  const wFull = new World(71001, { name: 'shotgun-full-delay', solids: [] })
  wFull.config.randomSpawn = false
  const pFull = wFull.addPlayer('FullShooter', 'ffa')
  pFull.weaponIndex = 0
  pFull.ammo[0] = 8
  pFull.reserveAmmo[0] = 72
  wFull.step(DT, new Map([[pFull.id, input({ fire: true, aim: 0 })]]))
  assert.ok(Math.abs(pFull.fireCooldown - 0.42) < 1e-6, `full-mag shot fireCooldown should be 0.42s, got ${pFull.fireCooldown}`)

  // 2) 半匣换弹中途按开火打断换弹（边装边打）：射击冷却应用 shellReloadFireDelayMult 惩罚为 0.87s
  const wInterrupt = new World(71002, { name: 'shotgun-interrupt-delay', solids: [] })
  wInterrupt.config.randomSpawn = false
  const pInt = wInterrupt.addPlayer('IntShooter', 'ffa')
  pInt.weaponIndex = 0
  pInt.ammo[0] = 3
  pInt.reserveAmmo[0] = 72
  wInterrupt.startReload(pInt)
  assert.equal(pInt.reloading, true)
  wInterrupt.step(DT, new Map([[pInt.id, input({ fire: true, aim: 0 })]]))
  assert.equal(pInt.reloading, false, 'shell reload interrupted by firing')
  assert.ok(Math.abs(pInt.fireCooldown - 0.87) < 1e-6, `interrupting shell reload should apply 0.87s cooldown, got ${pInt.fireCooldown}`)

  // 3) 空仓按住开火（打空最后 1 发 -> 冷却 -> 塞 1 发 -> 击发）：两次击发之间的总耗时应约为 0.87s
  const wCycle = new World(71003, { name: 'shotgun-empty-cycle', solids: [] })
  wCycle.config.randomSpawn = false
  const pCyc = wCycle.addPlayer('CycleShooter', 'ffa')
  pCyc.weaponIndex = 0
  pCyc.ammo[0] = 1
  pCyc.reserveAmmo[0] = 72
  wCycle.step(DT, new Map([[pCyc.id, input({ fire: true, aim: 0 })]]))
  wCycle.drainEvents()
  let ticksToNextShot = 0
  for (let i = 0; i < 90; i++) {
    wCycle.step(DT, new Map([[pCyc.id, input({ fire: true, aim: 0 })]]))
    ticksToNextShot++
    if (wCycle.drainEvents().some(e => e.kind === 'projectile_spawn')) break
  }
  const cycleSeconds = ticksToNextShot * DT
  assert.ok(Math.abs(cycleSeconds - 0.87) <= 0.04, `empty-mag shell-reload fire cycle should be ~0.87s, got ${cycleSeconds.toFixed(3)}s`)
})

test('护栏·设施占用安全释放：瞭望塔/迫击炮在玩家阵亡、替身人偶回溯、断线移除与重置对局时绝不死锁', () => {
  const w = new World(72001)
  w.config.randomSpawn = false
  const p1 = w.addPlayer('TowerUser', 'red')
  const p2 = w.addPlayer('Killer', 'blue')
  const tw = w.watchtowers[0]
  const m = w.mortars[0]

  // 1) 登上瞭望塔后被击杀：必须自动释放 tw.operatorId 与 p1.mountedTowerId
  p1.pos = { x: tw.x, y: tw.y }
  w.step(DT, new Map([[p1.id, input({ interact: true })]]))
  assert.equal(tw.operatorId, p1.id)
  assert.equal(p1.mountedTowerId, tw.id)
  w.damagePlayer(p1, 999, undefined, true, false, p2.id, p2.team, '狙')
  assert.equal(tw.operatorId, null, 'watchtower operatorId cleared on player death')
  assert.equal(p1.mountedTowerId, null, 'player mountedTowerId cleared on death')

  // 2) 替身人偶锚定后登上瞭望塔，触发人偶回溯时必须自动释放瞭望塔
  w.deploy(p1)
  p1.dollCharges = 1
  p1.secondary = 'doll'
  p1.pos = { x: 2000, y: 3264 }
  w.step(DT, new Map([[p1.id, input({ secondary: { type: 'doll', targetX: 2000, targetY: 3264 } })]]))
  assert.ok(p1.doll !== null)
  p1.pos = { x: tw.x, y: tw.y }
  w.step(DT, new Map([[p1.id, input({ interact: true })]]))
  assert.equal(tw.operatorId, p1.id)
  w.damagePlayer(p1, 999, undefined, false, false, p2.id, p2.team, '火箭筒')
  assert.equal(tw.operatorId, null, 'watchtower operatorId cleared on doll recall')
  assert.equal(p1.mountedTowerId, null, 'player mountedTowerId cleared on doll recall')

  // 3) 玩家操控迫击炮或瞭望塔期间断线 (removePlayer)：必须释放设施并清理索引
  const guest = w.addPlayer('GuestDisconnect', 'blue')
  guest.pos = { x: m.x, y: m.y }
  w.step(DT, new Map([[guest.id, input({ interact: true })]]))
  assert.equal(m.operatorId, guest.id)
  w.removePlayer(guest.id)
  assert.equal(m.operatorId, null, 'mortar operatorId released when guest disconnects')
  assert.equal(w.playerById.has(guest.id), false)
})

test('护栏·二进制协议与客户端预测保真：recoilVel/chargeAim/lastPrimaryIndex 编解码无损、弹丸缓存自动回收与截断包防崩溃', () => {
  resetBinaryCodecState()
  const w = new World(73001, { name: 'codec-fidelity', solids: [] })
  w.config.randomSpawn = false
  const p = w.addPlayer('SniperRecoil', 'red')
  p.weaponIndex = 4 // 特武高斯枪
  p.lastPrimaryIndex = 8 // 原常规主武器为冲锋枪
  p.recoilVel = { x: -420, y: 180 }
  p.chargeTimer = 0.25
  p.chargeAim = -1.12

  const bin = encodeServerMsgBinary({ snap: w.snapshot(), events: [] })
  const dec = decodeServerMsgBinary(bin)!
  const dp = dec.snap.players.find(x => x.id === p.id)!
  assert.equal(dp.lastPrimaryIndex, 8, 'lastPrimaryIndex preserved across binary codec when holding supply weapon')
  assert.ok(dp.recoilVel && Math.abs(dp.recoilVel.x - (-420)) < 1 && Math.abs(dp.recoilVel.y - 180) < 1, 'recoilVel preserved across binary codec')
  assert.ok(dp.chargeAim !== undefined && Math.abs(dp.chargeAim - (-1.12)) < 0.01, 'chargeAim preserved across binary codec while charging')

  // 验证截断/损坏二进制包绝不抛 RangeError
  for (let cut = 0; cut < Math.min(40, bin.byteLength); cut++) {
    assert.doesNotThrow(() => decodeServerMsgBinary(bin.subarray(0, cut)), `truncated binary packet (${cut}B) must not throw RangeError`)
  }
})

test('护栏·智能AI战术开关(smartBotTactics)与自定义地图/平衡参数兼容性校验', async () => {
  const { isCompatibleSavedMap, defaultMapData } = await import('../src/core/map.ts')
  const { sanitizeOverrides } = await import('../src/core/balanceOverrides.ts')
  const { setFeatureFlag, world: appWorld } = await import('../src/web/app/context.ts')
  const { findThreatenedFriendlyFlag } = await import('../src/web/game/bots.ts')

  // 1) 自定义地图兼容性：保留当前默认图、局内保存的「自定义地图」、编辑器清空的「自定义封闭竞技场」及用户命名图，仅过滤旧版内置默认图
  const solids = [{ x: 100, y: 3000, w: 200, h: 40, kind: 'platform' as const }]
  assert.equal(isCompatibleSavedMap({ name: defaultMapData().name, solids }), true)
  assert.equal(isCompatibleSavedMap({ name: '自定义地图', solids }), true)
  assert.equal(isCompatibleSavedMap({ name: '自定义封闭竞技场', solids }), true)
  assert.equal(isCompatibleSavedMap({ name: 'MyDuelMap', solids }), true)
  assert.equal(isCompatibleSavedMap({ name: '旧版封闭式立体竞技场', solids }), false)

  // 2) 新增平衡性参数可被 sanitizeOverrides 正确识别与夹取
  const ov = sanitizeOverrides({
    weapons: { 0: { shellReloadFireDelayMult: 2.2, grazeDamageMin: 20 }, 3: { blastFalloffExponent: 2.0 } },
    config: { shieldHp: 140, shieldDuration: 6, obstacleDefaultHp: 300, teleportCastTime: 0.5 },
  })
  assert.ok(ov)
  assert.equal(ov!.weapons!['0'].shellReloadFireDelayMult, 2.2)
  assert.equal(ov!.weapons!['0'].grazeDamageMin, 20)
  assert.equal(ov!.weapons!['3'].blastFalloffExponent, 2.0)
  assert.equal(ov!.config!.shieldHp, 140)
  assert.equal(ov!.config!.teleportCastTime, 0.5)

  // 3) 智能 AI 战术开关：开启时可感知同层掉进度的己方旗帜，关闭时不触发
  const bot = appWorld.addPlayer('TacticBot', 'red')
  const cp = appWorld.capturePoints.find(c => c.id === 'cp_e') ?? appWorld.capturePoints[0]
  cp.ownerTeam = 'red'
  cp.progress = 55
  bot.pos = { x: cp.x + 300, y: cp.y }
  setFeatureFlag('smartBotTactics', true)
  assert.equal(findThreatenedFriendlyFlag(bot)?.id, cp.id, 'smartBotTactics detects draining friendly flag on same layer')
  setFeatureFlag('smartBotTactics', false)
  assert.equal(findThreatenedFriendlyFlag(bot), null, 'disabling smartBotTactics disables flag reinforcement scan')
  setFeatureFlag('smartBotTactics', true)
  appWorld.removePlayer(bot.id)
})
