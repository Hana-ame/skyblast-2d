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
  // 故意用掩体压住据点 A（1720,2740）
  const bad: MapData = { name: 'bad', solids: [{ x: 1700, y: 2700, w: 200, h: 100, kind: 'cover' }] }
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
  assert.deepEqual(layoutViolations(w), [], 'empty map landmarks must be valid')
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
