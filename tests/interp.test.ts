// tests/interp.test.ts —— 渲染插值：基准捕获、插值方向、传送排除、连续捕获不清空
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capturePrevPositions, buildPositionOverlay, getRenderPos, hasRenderPos,
  prunePrevPositions, clearInterp, beginOverlayFrame,
} from '../src/web/game/interp.ts'

const mk = (id: number, x: number, y: number) => ({ id, pos: { x, y } })

test('插值：alpha=0 时取上一 tick 位置，alpha=1 时取当前 tick 位置', () => {
  clearInterp()
  const ents = [mk(1, 100, 200)]
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 160   // 模拟 tick 后移动 60px
  buildPositionOverlay('p', ents, 0)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 100, 'alpha=0 应返回上一 tick 位置')
  buildPositionOverlay('p', ents, 1)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 160, 'alpha=1 应返回当前 tick 位置')
  buildPositionOverlay('p', ents, 0.5)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 130, 'alpha=0.5 应为中点')
})

test('插值：连续捕获玩家与弹丸不会互相清空（曾经的 bug）', () => {
  clearInterp()
  const players = [mk(1, 10, 10)]
  const projectiles = [mk(100, 500, 500)]
  // 分两次捕获，模拟 loop 里的调用顺序
  capturePrevPositions('p', players)
  capturePrevPositions('p', projectiles)
  prunePrevPositions()

  players[0].pos.x = 20
  projectiles[0].pos.x = 600
  beginOverlayFrame()
  buildPositionOverlay('p', players, 0.5)
  buildPositionOverlay('p', projectiles, 0.5)

  // 两类都应各有插值覆盖；若 capture 内部做了 clear()，先捕获的那类会丢失
  assert.ok(hasRenderPos('p', 1), '玩家必须有插值基准')
  assert.ok(hasRenderPos('p', 100), '弹丸必须有插值基准')
  assert.equal(getRenderPos('p', 1, 0, 0).x, 15)
  assert.equal(getRenderPos('p', 100, 0, 0).x, 550)
})

test('插值：传送（位移 >400px）不插值，避免穿墙滑行', () => {
  clearInterp()
  const ents = [mk(1, 100, 100)]
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 5000   // 瞬移
  buildPositionOverlay('p', ents, 0.5)
  assert.equal(hasRenderPos('p', 1), false, '大幅位移不应产生插值覆盖')
  // 回退到真实位置
  assert.equal(getRenderPos('p', 1, ents[0].pos.x, ents[0].pos.y).x, 5000)
})

test('插值：消失的实体通过 prune 清理，不无限增长', () => {
  clearInterp()
  for (let i = 0; i < 50; i++) capturePrevPositions('p', [mk(i, i, i)])
  prunePrevPositions()
  // 下一帧只剩 1 个实体
  capturePrevPositions('p', [mk(999, 0, 0)])
  prunePrevPositions()
  const ents = [mk(999, 10, 10)]
  buildPositionOverlay('p', ents, 0.5)
  assert.ok(hasRenderPos('p', 999), '新实体应有基准')
  assert.equal(hasRenderPos('p', 0), false, '已消失的实体不应再有基准')
})

test('插值：alpha 超出 0..1 会被夹紧', () => {
  clearInterp()
  const ents = [mk(1, 0, 0)]
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 100
  buildPositionOverlay('p', ents, -5)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 0, '负 alpha 夹到 0')
  buildPositionOverlay('p', ents, 5)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 100, '大于 1 的 alpha 夹到 1')
})

test('插值：一帧内多次 tick 时基准与插值方向正确（不会倒退）', () => {
  // 确定性模拟：玩家匀速右移，144Hz 显示，验证渲染位置单调不倒退。
  // 这条测试专门防「alpha 用 1-acc/FIXED（反了）」这类 bug：
  // 反了会让 58% 的帧位置向后跳，肉眼就是抖动。
  clearInterp()
  const FIXED = 1 / 60
  const hz = 144
  const frameDt = 1 / hz
  const speed = 200
  const ent = { id: 7, pos: { x: 0, y: 0 } }
  const list = [ent]
  let acc = FIXED * 0.5
  const rendered: number[] = []
  for (let f = 0; f < 200; f++) {
    acc += frameDt
    const willStep = acc >= FIXED
    if (willStep) {
      capturePrevPositions('p', list)
      prunePrevPositions()
    }
    while (acc >= FIXED) {
      ent.pos.x += speed * FIXED     // 模拟 world.step 推进
      acc -= FIXED
    }
    const alpha = Math.max(0, Math.min(1, acc / FIXED))
    beginOverlayFrame()
    buildPositionOverlay('p', list, alpha)
    rendered.push(getRenderPos('p', 7, ent.pos.x, ent.pos.y).x)
  }
  // 渲染位置必须单调不减（匀速右移不该出现任何倒退）
  let backwards = 0
  let maxBack = 0
  for (let i = 1; i < rendered.length; i++) {
    const d = rendered[i] - rendered[i - 1]
    if (d < -0.001) { backwards++; if (-d > maxBack) maxBack = -d }
  }
  assert.equal(backwards, 0, `渲染位置出现 ${backwards} 次倒退（最大 ${maxBack.toFixed(2)}px），说明插值方向反了`)
  // 并且应该确实有前进（不是一直不动）
  let forward = 0
  for (let i = 1; i < rendered.length; i++) if (rendered[i] - rendered[i - 1] > 0.001) forward++
  assert.ok(forward > 150, `应有大量前进帧，实际 ${forward}`)
})

test('插值：不同实体类别的相同 id 不互相覆盖（id 空间冲突 bug）', () => {
  // 实测发现：玩家 id 1..8，弹丸 id 也从 1 开始，且弹丸销毁后 id 会被复用。
  // 若插值只用数字 id 做 key，玩家 id=1 与弹丸 id=1 会互相覆盖位置，
  // 导致弹丸画到玩家身上、或玩家被拉到弹丸位置 —— 画面直接错乱。
  clearInterp()
  const player = { id: 1, pos: { x: 100, y: 100 } }
  const proj = { id: 1, pos: { x: 900, y: 900 } }   // 同 id，不同类别
  const players = [player]
  const projectiles = [proj]

  capturePrevPositions('p', players)
  capturePrevPositions('pr', projectiles)
  prunePrevPositions()

  player.pos.x = 110; player.pos.y = 110
  proj.pos.x = 950; proj.pos.y = 950

  beginOverlayFrame()
  buildPositionOverlay('p', players, 0.5)
  buildPositionOverlay('pr', projectiles, 0.5)

  // 两类各自的插值必须独立正确
  assert.equal(getRenderPos('p', 1, 0, 0).x, 105, '玩家插值应为 105，不能被弹丸污染')
  assert.equal(getRenderPos('pr', 1, 0, 0).x, 925, '弹丸插值应为 925，不能被玩家污染')

  // 交叉读取不应该拿到对方的覆盖（同 id 但不同 kind）
  assert.equal(hasRenderPos('g', 1), false, '未捕获的类别不应有覆盖')
})

test('插值：弹丸 id 复用时不会沿用旧位置（类别前缀 + 覆盖语义）', () => {
  clearInterp()
  // 第一颗弹丸 id=5
  const p1 = { id: 5, pos: { x: 0, y: 0 } }
  capturePrevPositions('pr', [p1])
  prunePrevPositions()
  p1.pos.x = 60
  beginOverlayFrame()
  buildPositionOverlay('pr', [p1], 0.5)
  assert.equal(getRenderPos('pr', 5, 0, 0).x, 30)

  // 弹丸销毁、id=5 被复用为一颗完全不同的弹丸（在远处生成）
  const p2 = { id: 5, pos: { x: 5000, y: 5000 } }
  capturePrevPositions('pr', [p2])
  prunePrevPositions()
  beginOverlayFrame()
  buildPositionOverlay('pr', [p2], 0.5)
  // 新弹丸的 prev 就是它自己的出生位置，插值结果应在 5000 附近而不是 30
  const got = getRenderPos('pr', 5, 0, 0).x
  assert.ok(got > 4000, `id 复用的新弹丸不应继承旧位置，实际 ${got}`)
})
