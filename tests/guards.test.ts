// tests/guards.test.ts —— 防回归护栏：数值约定 / 布局合法性 / 出生安全 / 小地图兼容
// 任何“改了这个坏那个”的问题，应当在 npm test 阶段直接变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/core/sim/world.ts'
import { SPAWN_POINTS } from '../src/core/sim/world.ts'
import { allViolations, layoutViolations, weaponViolations } from '../src/core/invariants.ts'
import { defaultMapData } from '../src/core/map.ts'
import type { MapData, MapSolid } from '../src/core/map.ts'
import { WORLD_W, WORLD_H } from '../src/core/wrap.ts'
import { emptyWorld, input, DT } from './helpers.ts'
import { recoilDelta, RECOIL_SCALE } from '../src/core/sim/physics.ts'
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY } from '../src/core/wrap.ts'
import { expandBeamSegments } from '../src/web/render/beamGeometry.ts'

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


test('护栏·后坐力各向同性（行为级）：扣除重力后四方向踢力一致', () => {
  const measure = (aim: number): number => {
    // 同一 tick 的「开火」与「不开火」两次模拟相减 → 精确隔离后坐力增量（排除重力/上限）
    const run = (fire: boolean): { x: number; y: number } => {
      const w = emptyWorld(77)
      w.config.randomSpawn = false
      const p = w.addPlayer('P', 'ffa')
      p.weaponIndex = 0        // 霰弹（recoil 最大，最容易看出各向差异）
      p.pos = { x: 6200, y: 2000 }
      p.vel = { x: 0, y: 0 }
      p.onGround = false
      w.step(DT, new Map([[p.id, input({ fire, aim })]]))
      return { x: p.vel.x, y: p.vel.y }
    }
    const a = run(true)
    const b = run(false)
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const dirs = [0, Math.PI, -Math.PI / 2, Math.PI / 2, Math.PI / 4, -Math.PI * 0.75]
  const kicks = dirs.map(measure)
  const expected = kicks[0]
  for (const k of kicks) {
    assert.ok(Math.abs(k - expected) < 1e-6, `recoil kick differs by direction: ${kicks.map(v => v.toFixed(2)).join(', ')}`)
  }
  assert.ok(expected > 500, 'shotgun recoil is significant')
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
          const ddx = wrapDeltaX(seg.x1, seg.x2)
          const ddy = wrapDeltaY(seg.y1, seg.y2)
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
          assert.ok(Math.abs(sr - len) < 1.5, `segment render length differs (world ${len.toFixed(0)} vs screen ${sr.toFixed(0)})`)
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
