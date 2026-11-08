// tests/guards.test.ts —— 防回归护栏：数值约定 / 布局合法性 / 出生安全 / 小地图兼容
// 任何“改了这个坏那个”的问题，应当在 npm test 阶段直接变红。
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { World } from '../src/core/sim/world.ts'
import { SPAWN_POINTS } from '../src/core/sim/world.ts'
import { allViolations, layoutViolations, weaponViolations } from '../src/core/invariants.ts'
import { defaultMapData } from '../src/core/map.ts'
import { WEAPONS, DEFAULT_CONFIG } from '../src/core/weapons.ts'
import type { MapData, MapSolid } from '../src/core/map.ts'
import type { WorldEvent } from '../src/core/types.ts'
import { encodeServerMsgBinary, decodeServerMsgBinary } from '../src/net/protocol/BinaryCodec.ts'
import { expandBeamSegments, worldSegLength } from '../src/web/render/beamGeometry.ts'
import { WORLD_W, WORLD_H } from '../src/core/wrap.ts'
import { emptyWorld, input, DT } from './helpers.ts'
import type { WorldInput } from '../src/core/types.ts'
import { recoilDelta, RECOIL_SCALE } from '../src/core/sim/physics.ts'
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
    shooter.pos = { x: 3000, y: 2784 }
    mate.pos = { x: 3200, y: 2784 }
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


test('护栏·蓄力锁定方向：狙击蓄力期间瞄准输入不再改变发射方向，松手后可重新瞄准', () => {
  const w = new World(39000, { name: 'charge-arena', solids: [] })
  w.config.randomSpawn = false
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 2                 // 狙击：chargeSeconds 0.6
  p.ammo[2] = 3
  p.reserveAmmo[2] = 15
  p.pos = { x: 6600, y: 1600 }

  // 前 20 帧朝右蓄力，之后把瞄准转到正下方；发射方向必须仍锁在 0 rad
  let firedAngle: number | null = null
  for (let i = 0; i < 60; i++) {
    const aim = i < 20 ? 0 : Math.PI / 2
    w.step(DT, new Map([[p.id, input({ fire: true, aim })]]))
    for (const e of w.drainEvents()) {
      if (e.kind !== 'projectile_spawn') continue
      const pr = w.projectiles.find(x => x.id === e.projectileId)
      if (pr) firedAngle = Math.atan2(pr.vel.y, pr.vel.x)
    }
  }
  assert.ok(firedAngle !== null, 'sniper eventually fires after charging')
  assert.ok(Math.abs(firedAngle!) < 0.05, `charge must lock the firing direction at 0 rad, got ${(firedAngle! * 180 / Math.PI).toFixed(1)}°`)

  // 松手后锁定解除：可以自由转向
  for (let i = 0; i < 10; i++) w.step(DT, new Map([[p.id, input({ aim: -Math.PI / 2 })]]))
  assert.ok(Math.abs(p.aim + Math.PI / 2) < 0.05, `aim is free again after releasing, got ${(p.aim * 180 / Math.PI).toFixed(1)}°`)
  assert.equal(p.chargeTimer, 0, 'charge timer reset after fire')
  assert.equal(p.chargeAim, undefined, 'aim lock cleared after firing')

  // 半途松手也解除锁定（不发射）
  const w2 = new World(39001, { name: 'charge-cancel', solids: [] })
  w2.config.randomSpawn = false
  const q = w2.addPlayer('Q', 'ffa')
  q.weaponIndex = 2
  q.ammo[2] = 3
  q.pos = { x: 6600, y: 1600 }
  for (let i = 0; i < 10; i++) w2.step(DT, new Map([[q.id, input({ fire: true, aim: 0 })]]))
  assert.ok(q.chargeTimer > 0, 'charging')
  for (let i = 0; i < 10; i++) w2.step(DT, new Map([[q.id, input({ aim: Math.PI / 2 })]]))
  assert.ok(Math.abs(q.aim - Math.PI / 2) < 0.05, 'aim unlocked after cancelling the charge')
  assert.equal(q.chargeAim, undefined, 'aim lock cleared on cancel')
})

import {
  SECONDARIES,
  SECONDARY_UNLOCK_ORDER,
  formatWeaponCardSubtitle,
  formatSecondaryButtonTitle,
  formatSecondaryCardSubtitle,
} from '../src/core/weapons.ts'

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
    const { p, segments } = fireOnce(w, { x: 1500, y: 2784 }, -Math.PI / 2)
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
