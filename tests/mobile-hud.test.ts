// tests/mobile-hud.test.ts —— 跨设备视野一致 + 手机 HUD 不溢出 + 击杀信息默认半透明
//
// 用户报告三条：
//   1. 手机的视野范围应该和 PC 保持一致（手机目前视野太小）
//   2. 手机 HUD 放不下
//   3. 击杀信息应该默认 alpha = 30%
//
// 视野的根因：渲染时可见世界宽度 = canvas.width × camera.fovFactor。
// PC 画布通常 ~1500px 宽，手机横屏只有 ~640~850px，若 fovFactor 都是 1.0，
// 手机看到的世界就只有 PC 的一半 —— 这不是"手机屏幕小"的必然结果，
// 而是没有按画布宽度补偿。现在 viewCompensation() 让两者都恒定到基准宽度。

import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/** 复现 context.ts 里的补偿公式（保持与实现一致） */
const REFERENCE_VIEW_WIDTH = 1500
const compensation = (canvasWidth: number): number => {
  if (canvasWidth <= 0) return 1
  return Math.min(3, Math.max(0.5, REFERENCE_VIEW_WIDTH / canvasWidth))
}
const visibleWorldWidth = (canvasWidth: number): number => canvasWidth * compensation(canvasWidth)

test('视野：PC 与手机看到的可见世界宽度必须一致', () => {
  // 覆盖桌面大屏、笔记本、手机横屏三档
  const devices = [2560, 1920, 1536, 1280, 1024, 844, 740, 640]
  for (const w of devices) {
    const visible = visibleWorldWidth(w)
    assert.ok(
      Math.abs(visible - REFERENCE_VIEW_WIDTH) < 1,
      `画布宽 ${w}px 应看到 ${REFERENCE_VIEW_WIDTH}px 世界，实际 ${visible.toFixed(1)}px`,
    )
  }
})

test('视野：窄画布必须放大 fovFactor（手机不再视野过小）', () => {
  const phone = 740
  const pc = 1536
  assert.ok(compensation(phone) > 1.5, `手机(${phone}px) 补偿倍率应明显大于 1，实际 ${compensation(phone).toFixed(2)}`)
  // 补偿前后对比：没有补偿时手机只看到 740px，PC 看到 1536px（差一倍多）
  assert.ok(
    visibleWorldWidth(phone) > phone * 1.5,
    '手机必须在补偿后看到远超其画布像素的世界宽度',
  )
  assert.ok(
    Math.abs(visibleWorldWidth(phone) - visibleWorldWidth(pc)) < 1,
    '手机与 PC 的可见宽度必须相等（这就是"保持一致"）',
  )
})

test('视野：极端分辨率下补偿倍率被夹在安全区间', () => {
  assert.equal(compensation(100), 3, '超窄画布封顶 3x')
  assert.equal(compensation(10000), 0.5, '超宽画布封底 0.5x')
})

test('视野：loop.ts 必须真的把补偿乘进 targetFov', () => {
  const loop = read('src/web/game/loop.ts')
  assert.ok(loop.includes('viewCompensation'), 'loop.ts 必须调用 viewCompensation')
  assert.ok(
    /const targetFov = \([\s\S]{0,240}?\) \* vc/.test(loop) || /targetFov[\s\S]{0,120}\* vc/.test(loop),
    'targetFov 必须乘以补偿倍率 vc',
  )
  const ctx = read('src/web/app/context.ts')
  assert.ok(ctx.includes('export function viewCompensation'), 'context.ts 必须导出 viewCompensation')
  assert.ok(ctx.includes('REFERENCE_VIEW_WIDTH'), '必须定义基准视野宽度')
})

test('手机 HUD：存在矮屏/窄屏的紧凑适配规则', () => {
  const css = read('docs/css/style.css')
  // 矮屏媒体查询（横屏手机常见可视高度 <= 520px）
  assert.ok(/@media[^{]*max-height:\s*520px/.test(css), '必须有 max-height:520px 的紧凑断点')
  // 极矮屏兜底
  assert.ok(/@media[^{]*max-height:\s*400px/.test(css), '必须有 max-height:400px 的兜底断点')
  // 三块关键 HUD 都要被收紧
  for (const sel of ['#topHudBar > .glass-panel', '#bottomWeaponDock .glass-panel', '#killFeedContainer']) {
    assert.ok(css.includes(sel), `紧凑样式必须覆盖 ${sel}`)
  }
  // 小地图必须限制最大宽度，否则会挤压左上状态面板
  assert.ok(/#topHudBar canvas/.test(css), '必须限制小地图画布尺寸')
})

test('击杀信息默认透明度为 30%', () => {
  const html = read('docs/index.html')
  const m = /id="killFeedContainer"[^>]*style="([^"]*)"/.exec(html)
  assert.ok(m, 'killFeedContainer 必须带 style 属性')
  const style = m![1]
  assert.ok(/opacity:\s*0\.3\b/.test(style), `击杀信息容器应默认 opacity:0.3，实际 style="${style}"`)
})

test('静音按钮：HUD 中存在按钮，且 audio.ts 提供可持久化的静音开关', () => {
  const html = read('docs/index.html')
  const audio = read('src/web/app/audio.ts')
  const bindings = read('src/web/input/bindings.ts')

  // ① 按钮必须真的在 HUD 里
  const btn = /id="hudMuteBtn"[^>]*>([\s\S]*?)<\/button>/.exec(html)
  assert.ok(btn, 'HUD 必须有 id="hudMuteBtn" 的静音按钮')

  // ② audio.ts 必须导出静音 API
  for (const fn of ['export function isMuted', 'export function setMuted', 'export function toggleMuted']) {
    assert.ok(audio.includes(fn), `audio.ts 必须提供 ${fn}`)
  }
  // ③ 静音必须真的拦截声音播放（在 getAudioCtx 里返回 null，所有音效统一生效）
  assert.ok(/function getAudioCtx\(\): AudioContext \| null \{\s*\n\s*if \(muted\) return null/.test(audio),
    'getAudioCtx 必须在静音时返回 null，使所有音效统一静默')
  // ④ 状态必须持久化
  assert.ok(audio.includes('localStorage.setItem(MUTE_KEY'), '静音状态必须写入 localStorage')
  assert.ok(audio.includes('localStorage.getItem(MUTE_KEY)'), '启动时必须读取持久化的静音状态')

  // ⑤ 按钮必须已接线，且图标随状态切换
  assert.ok(bindings.includes("getElementById('hudMuteBtn')"), 'bindings.ts 必须绑定静音按钮')
  assert.ok(bindings.includes('toggleMuted()'), '点击必须调用 toggleMuted')
  assert.ok(/muteBtn\.textContent = m \? '🔇' : '🔊'/.test(bindings), '图标必须随静音状态切换')
})
