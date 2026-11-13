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
  capturePrevPositions(ents)
  prunePrevPositions()
  ents[0].pos.x = 160   // 模拟 tick 后移动 60px
  buildPositionOverlay(ents, 0)
  assert.equal(getRenderPos(1, 0, 0).x, 100, 'alpha=0 应返回上一 tick 位置')
  buildPositionOverlay(ents, 1)
  assert.equal(getRenderPos(1, 0, 0).x, 160, 'alpha=1 应返回当前 tick 位置')
  buildPositionOverlay(ents, 0.5)
  assert.equal(getRenderPos(1, 0, 0).x, 130, 'alpha=0.5 应为中点')
})

test('插值：连续捕获玩家与弹丸不会互相清空（曾经的 bug）', () => {
  clearInterp()
  const players = [mk(1, 10, 10)]
  const projectiles = [mk(100, 500, 500)]
  // 分两次捕获，模拟 loop 里的调用顺序
  capturePrevPositions(players)
  capturePrevPositions(projectiles)
  prunePrevPositions()

  players[0].pos.x = 20
  projectiles[0].pos.x = 600
  beginOverlayFrame()
  buildPositionOverlay(players, 0.5)
  buildPositionOverlay(projectiles, 0.5)

  // 两类都应各有插值覆盖；若 capture 内部做了 clear()，先捕获的那类会丢失
  assert.ok(hasRenderPos(1), '玩家必须有插值基准')
  assert.ok(hasRenderPos(100), '弹丸必须有插值基准')
  assert.equal(getRenderPos(1, 0, 0).x, 15)
  assert.equal(getRenderPos(100, 0, 0).x, 550)
})

test('插值：传送（位移 >400px）不插值，避免穿墙滑行', () => {
  clearInterp()
  const ents = [mk(1, 100, 100)]
  capturePrevPositions(ents)
  prunePrevPositions()
  ents[0].pos.x = 5000   // 瞬移
  buildPositionOverlay(ents, 0.5)
  assert.equal(hasRenderPos(1), false, '大幅位移不应产生插值覆盖')
  // 回退到真实位置
  assert.equal(getRenderPos(1, ents[0].pos.x, ents[0].pos.y).x, 5000)
})

test('插值：消失的实体通过 prune 清理，不无限增长', () => {
  clearInterp()
  for (let i = 0; i < 50; i++) capturePrevPositions([mk(i, i, i)])
  prunePrevPositions()
  // 下一帧只剩 1 个实体
  capturePrevPositions([mk(999, 0, 0)])
  prunePrevPositions()
  const ents = [mk(999, 10, 10)]
  buildPositionOverlay(ents, 0.5)
  assert.ok(hasRenderPos(999), '新实体应有基准')
  assert.equal(hasRenderPos(0), false, '已消失的实体不应再有基准')
})

test('插值：alpha 超出 0..1 会被夹紧', () => {
  clearInterp()
  const ents = [mk(1, 0, 0)]
  capturePrevPositions(ents)
  prunePrevPositions()
  ents[0].pos.x = 100
  buildPositionOverlay(ents, -5)
  assert.equal(getRenderPos(1, 0, 0).x, 0, '负 alpha 夹到 0')
  buildPositionOverlay(ents, 5)
  assert.equal(getRenderPos(1, 0, 0).x, 100, '大于 1 的 alpha 夹到 1')
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
      capturePrevPositions(list)
      prunePrevPositions()
    }
    while (acc >= FIXED) {
      ent.pos.x += speed * FIXED     // 模拟 world.step 推进
      acc -= FIXED
    }
    const alpha = Math.max(0, Math.min(1, acc / FIXED))
    beginOverlayFrame()
    buildPositionOverlay(list, alpha)
    rendered.push(getRenderPos(7, ent.pos.x, ent.pos.y).x)
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
