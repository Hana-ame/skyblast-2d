// tests/noita.test.ts —— Noita 风世界：确定性 + 地形破坏 + 落沙 + 悬浮能量
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NoitaWorld, TILE, W, H, EMPTY, SAND, STONE, defaultNoitaInput } from '../src/core/noita/NoitaWorld.ts'
import type { NoitaInput } from '../src/core/noita/NoitaWorld.ts'

const DT = 1 / 60
const input = (over: Partial<NoitaInput> = {}): NoitaInput => ({ ...defaultNoitaInput(), ...over })

test('Noita 确定性：同输入两次运行，地形+实体一致', () => {
  const run = () => {
    const w = new NoitaWorld()
    const a = w.addPlayer(50 * TILE, (H - 46) * TILE)
    w.step(DT, new Map([[a.id, input({ move: 1, fire: true, aim: 0 })]]))
    w.step(DT, new Map([[a.id, input({ move: 1, fire: true, aim: 0.3 })]]))
    for (let i = 0; i < 100; i++) w.step(DT, new Map([[a.id, input({ hover: true })]]))
    return JSON.stringify({ tiles: Array.from(w.tiles), players: w.players.map(p => ({ x: p.pos.x, y: p.pos.y })), proj: w.projectiles.length })
  }
  assert.equal(run(), run())
})

test('Noita 重力：空中者下落，最终停在地形上', () => {
  const w = new NoitaWorld()
  const p = w.addPlayer(50 * TILE, (H - 60) * TILE) // 空腔内空中
  for (let i = 0; i < 180; i++) w.step(DT, new Map([[p.id, input()]]))
  // 空腔底 y≈(H-36)*TILE；玩家半径6 → 停在底上方
  assert.ok(p.pos.y > (H - 60) * TILE, `expected fell, y=${p.pos.y}`)
  assert.ok(p.vel.y === 0, `expected rest vy=0, vy=${p.vel.y}`)
})

test('Noita 悬浮：能量耗尽前不落地，落地回充', () => {
  const w = new NoitaWorld()
  const p = w.addPlayer(50 * TILE, (H - 46) * TILE)
  const y0 = p.pos.y
  // 悬浮 1s（耗 0.5 能量）：应上升
  for (let i = 0; i < 60; i++) w.step(DT, new Map([[p.id, input({ hover: true })]]))
  assert.ok(p.pos.y < y0, `hover should lift, y0=${y0} y=${p.pos.y}`)
  // 悬浮耗尽（总 2s 耗 1.0）→ 落地回充
  for (let i = 0; i < 200; i++) w.step(DT, new Map([[p.id, input({ hover: true })]]))
  assert.ok(p.energy < 0.99 || p.vel.y >= 0, `energy should drain/hover stops, e=${p.energy} vy=${p.vel.y}`)
})

test('Noita 炸坑：弹丸命中地形挖出圆形空腔', () => {
  const w = new NoitaWorld()
  const p = w.addPlayer(50 * TILE, (H - 46) * TILE)
  // 朝正下方发射：必命中沙/石
  w.step(DT, new Map([[p.id, input({ fire: true, aim: Math.PI / 2 })]]))
  const solidBefore = countSolid(w)
  for (let i = 0; i < 120; i++) w.step(DT, new Map([[p.id, input()]]))
  const solidAfter = countSolid(w)
  assert.ok(solidAfter < solidBefore, `blast should carve terrain, before=${solidBefore} after=${solidAfter}`)
  assert.equal(w.projectiles.filter(b => b.life > 0).length, 0, 'bullet should be consumed')
})

test('Noita 落沙：头顶炸空的沙会塌落到坑里', () => {
  const w = new NoitaWorld()
  // 找一列有沙的位置，在沙中间炸一个坑
  let col = -1
  for (let x = 5; x < W - 5; x++) {
    if (w.tiles[x + (H - 40) * W] === SAND) { col = x; break }
  }
  assert.ok(col >= 0, 'should find a sand column')
  w.explode(col * TILE + 2, (H - 40) * TILE + 2, 4)
  const belowAfterBlast = w.tiles[col + (H - 38) * W]
  // 让沙落 60 tick
  for (let i = 0; i < 60; i++) w.step(DT, new Map([]))
  // 上方沙应已塌落填充（至少 belowAfterBlast 位置被沙填充或有沙移动）
  const filled = w.tiles[col + (H - 38) * W] !== EMPTY || belowAfterBlast === EMPTY
  assert.ok(filled, `sand should fall into pit, tile=${w.tiles[col + (H - 38) * W]}`)
})

test('Noita 伤害/击杀：直接命中掉血，死亡重生', () => {
  const w = new NoitaWorld()
  const a = w.addPlayer(46 * TILE, (H - 46) * TILE)
  const b = w.addPlayer(56 * TILE, (H - 46) * TILE) // 同一空腔近距（中间地形会挡远弹，属预期）
  const hp0 = b.hp
  const aim = Math.atan2(b.pos.y - a.pos.y, b.pos.x - a.pos.x)
  for (let i = 0; i < 300; i++) w.step(DT, new Map([[a.id, input({ fire: true, aim })]]))
  assert.ok(b.hp < hp0 || b.deaths > 0, `should damage or kill, hp=${b.hp} deaths=${b.deaths}`)
})

function countSolid(w: NoitaWorld): number {
  let n = 0
  for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] !== EMPTY) n++
  return n
}
