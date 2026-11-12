// tests/diag.test.ts —— 性能诊断记录器：帧记录 / 掉帧判定 / 报告结构 / Node 环境安全
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diagRecordFrame, diagMark, diagFrames, buildReport, reportToText,
  diagReset, diagSetEnabled, diagIsEnabled, diagStats,
} from '../src/web/app/diag.ts'
import type { FrameCtx } from '../src/web/app/diag.ts'

// 最小假的运行时上下文；diag 模块在 Node 下不得触碰 DOM
function ctx(over: Partial<FrameCtx> = {}): FrameCtx {
  return {
    world: { tick: 100, players: { length: 5 }, projectiles: { length: 3 } },
    localPlayer: {
      hp: 100, alive: true, deployed: true, weaponIndex: 1,
      pos: { x: 100, y: 200 },
    },
    camera: { x: 6600, y: 1500 },
    netState: { role: 'offline', peerCount: 0 },
    canvas: { width: 1280, height: 800 },
    ...over,
  }
}

const parts = (over: Partial<{ steps: number; stepMs: number; renderMs: number; hudMs: number }> = {}) => ({
  steps: 1, stepMs: 0.2, renderMs: 0.6, hudMs: 0.1, ...over,
})

/** 先喂一个基准帧建立 lastFrameTs；它自身的 dt=0，不计入掉帧 */
function prime(t0: number): number {
  diagRecordFrame(t0, parts(), ctx())
  return t0
}

test('诊断器：Node 环境可 import 且帧记录/统计正确', () => {
  diagReset()
  diagSetEnabled(true)
  assert.equal(diagIsEnabled(), true)

  // 60fps 稳定 10 帧（先 prime 建立基准帧）
  let t = prime(1000)
  for (let i = 0; i < 10; i++) {
    t += 16.7
    diagRecordFrame(t, parts(), ctx())
  }
  const frames = diagFrames()
  assert.ok(frames.length >= 10, `expect >=10 frames, got ${frames.length}`)
  assert.equal(diagStats.frames, 11, '基准帧 + 10 帧')
  assert.equal(diagStats.gapsOver24, 0, '稳定 16.7ms 不应记为掉帧')
  // busyMs = 0.2+0.6+0.1 = 0.9
  const last = frames[frames.length - 1]
  assert.ok(Math.abs(last.busyMs - 0.9) < 1e-6, `busyMs=${last.busyMs}`)
  assert.equal(last.tick, 100)
  assert.equal(last.canvasW, 1280)
  assert.equal(last.role, 'offline')
})

test('诊断器：超过 24ms 的帧间隔记为掉帧，且最差帧被统计', () => {
  diagReset()
  diagSetEnabled(true)
  let t = prime(5000)
  t += 16.7; diagRecordFrame(t, parts(), ctx())
  t += 120; diagRecordFrame(t, parts(), ctx())   // 严重掉帧
  t += 16.7; diagRecordFrame(t, parts(), ctx())
  t += 40; diagRecordFrame(t, parts(), ctx())    // 中度掉帧

  // 基准帧 1 + 4 帧
  assert.equal(diagStats.frames, 5)
  assert.equal(diagStats.gapsOver100, 1)
  assert.equal(diagStats.gapsOver24, 1)
  assert.equal(diagStats.worstGapMs, 120)

  const rep = buildReport()
  const gaps = rep.stutters.filter(s => s.kind === 'frame-gap')
  assert.equal(gaps.length, 2, `expect 2 frame-gap stutters, got ${gaps.length}`)
  const severe = gaps.find(g => g.dt === 120)!
  assert.equal(severe.detail.severity, 'severe')
  assert.equal(severe.detail.canvas, '1280x800@1')
  assert.equal(diagStats.gapsOver50, 0, '120ms 已计入 >100 档，不应重复计入 >50')
})

test('诊断器：报告结构完整，文本摘要可读', () => {
  diagReset()
  diagSetEnabled(true)
  let t = prime(9000)
  for (let i = 0; i < 30; i++) {
    t += i === 5 ? 90 : 16.7
    diagRecordFrame(t, parts({ steps: i === 5 ? 3 : 1, renderMs: i === 5 ? 8 : 0.6 }), ctx())
  }
  diagMark('local-death', { tick: 123 })

  const rep = buildReport()
  assert.ok(typeof rep.generatedAt === 'string' && rep.generatedAt.includes('T'))
  assert.ok(rep.env && typeof rep.env === 'object')
  assert.equal(rep.stats.frames, 31, '基准帧 + 30 帧')
  assert.ok(rep.stats.busyP50 >= 0 && rep.stats.busyP95 >= rep.stats.busyP50)
  assert.ok(rep.stats.gapHistogram, 'gapHistogram 必须存在')
  assert.equal(rep.marks.at(-1)?.kind, 'local-death')
  assert.ok(rep.frames.length >= 31)

  const txt = reportToText(rep)
  assert.ok(txt.includes('SkyBlast 2D 诊断日志'))
  assert.ok(txt.includes('掉帧计数'))
  assert.ok(txt.includes('最差帧间隔'))
  assert.ok(txt.includes('local-death'))
})

test('诊断器：禁用后不再累积记录，重新启用可继续', () => {
  diagReset()
  diagSetEnabled(true)
  let t = prime(20000)
  t += 16.7; diagRecordFrame(t, parts(), ctx())
  const n1 = diagStats.frames
  diagSetEnabled(false)
  for (let i = 0; i < 5; i++) { t += 16.7; diagRecordFrame(t, parts(), ctx()) }
  assert.equal(diagStats.frames, n1, '禁用期间不应增加统计帧数')
  diagSetEnabled(true)
  t += 16.7; diagRecordFrame(t, parts(), ctx())
  assert.equal(diagStats.frames, n1 + 1)
})

test('诊断器：环形缓冲有上界，长时间运行不无限增长', () => {
  diagReset()
  diagSetEnabled(true)
  let t = prime(100000)
  for (let i = 0; i < 3000; i++) {
    t += 16.7
    diagRecordFrame(t, parts(), ctx())
  }
  const frames = diagFrames()
  assert.ok(frames.length <= 1800, `环形缓冲必须有上界, got ${frames.length}`)
  assert.equal(diagStats.frames, 3001, '统计计数不受环形缓冲限制（基准帧 + 3000）')
  // 环形缓冲里应保留最新的帧（帧号递增）
  const last = frames[frames.length - 1]
  assert.equal(last.i, 3001)
})

test('诊断器：后台标签页节流的超长 gap 不计入掉帧统计（避免真机误判）', () => {
  diagReset()
  diagSetEnabled(true)
  // 在 Node 下 document.hidden 不存在，因此用 r.hidden 字段驱动：
  // 这里模拟"帧记录时页面可见，但上一帧标记为隐藏"（刚切回）的路径无法在 Node 构造，
  // 所以只断言：正常模式下超长 gap 一定被计入，确保过滤逻辑不会误杀真实掉帧。
  let t = prime(30000)
  t += 400 // 模拟 400ms 真卡顿
  diagRecordFrame(t, parts(), ctx())
  assert.equal(diagStats.gapsOver100, 1, '可见状态下的 400ms gap 必须计入')
  assert.equal(diagStats.throttledGaps, 0)
  const rep = buildReport()
  assert.ok(reportToText(rep).includes('后台节流'))
})
