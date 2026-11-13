// tests/aim.test.ts —— 武器朝向：朝左瞄准时枪口必须指向瞄准方向
//
// 曾经的 bug：武器变换写的是 rotate(aim - PI) + scale(1, -1)，
// 而 canvas 变换是后乘（CTM = CTM · M），局部 +x 方向被映射到 aim + PI，
// 即枪口与瞄准方向**正好相反**（dot = -1）。视觉表现为
// "瞄准左半边时枪口指向右半边"。
//
// 正确写法：rotate(aim + PI) + scale(-1, 1)，局部 +x 精确映射到 aim。
// 这里用矩阵复现 canvas 的变换语义，直接断言"武器指向角"与瞄准方向一致。

import { test } from 'node:test'
import assert from 'node:assert/strict'

const PI = Math.PI

/** 2D 仿射矩阵 [a,b,c,d,e,f]，与 canvas DOMMatrix 同构 */
type Mat = [number, number, number, number, number, number]

const rot = (t: number): Mat => [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]
const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0]

/** a·b：先应用 b 再应用 a（对应 canvas 的后乘语义） */
function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    0, 0,
  ]
}

const apply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y,
  m[1] * x + m[3] * y,
]

const facingOf = (aim: number): 1 | -1 => (Math.cos(aim) >= 0 ? 1 : -1)

/** 复现 renderWeapon 当前的变换顺序，返回武器尖端(局部 +x)的世界方向 */
function weaponDir(aim: number, fixed: boolean): [number, number] {
  const facing = facingOf(aim)
  const angle = fixed ? aim + (facing < 0 ? PI : 0) : aim - (facing < 0 ? PI : 0)
  const sc = fixed ? scale(facing < 0 ? -1 : 1, 1) : scale(1, facing < 0 ? -1 : 1)
  const m = mul(rot(angle), sc)
  return apply(m, 1, 0)
}

function dot(a: [number, number], b: [number, number]): number {
  return a[0] * b[0] + a[1] * b[1]
}

test('武器朝向：朝左瞄准时枪口与瞄准方向一致（修复后的不变量）', () => {
  // 覆盖朝左、正左、朝左上、朝左下等各种角度
  const aims = [PI - 0.3, PI - 1.2, PI, PI + 0.3, PI + 1.2, 2.0, 4.2, 3.0]
  for (const aim of aims) {
    const want: [number, number] = [Math.cos(aim), Math.sin(aim)]
    const got = weaponDir(aim, true)
    const d = dot(want, got)
    assert.ok(
      Math.abs(d - 1) < 1e-9,
      `aim=${aim.toFixed(3)} 武器方向应与瞄准一致 (dot 应≈1)，实际 dot=${d.toFixed(3)}`,
    )
  }
})

test('武器朝向：朝右瞄准不受修复影响', () => {
  const aims = [0, 0.3, -0.3, 1.2, -1.2, PI / 2 - 0.01, -PI / 2 + 0.01]
  for (const aim of aims) {
    const want: [number, number] = [Math.cos(aim), Math.sin(aim)]
    const got = weaponDir(aim, true)
    assert.ok(Math.abs(dot(want, got) - 1) < 1e-9, `aim=${aim.toFixed(3)} 朝右也必须一致`)
  }
})

test('武器朝向：回归护栏 —— 旧的 rotate(aim-PI)+scale(1,-1) 在朝左时方向相反', () => {
  // 这条测试锁住"旧写法是错的"这一事实，防止有人改回去。
  const aim = PI - 0.3
  const want: [number, number] = [Math.cos(aim), Math.sin(aim)]
  const oldDir = weaponDir(aim, false)
  const oldDot = dot(want, oldDir)
  assert.ok(oldDot < -0.99, `旧写法在朝左时应指向反方向 (dot≈-1)，实际 ${oldDot.toFixed(3)}`)

  const newDir = weaponDir(aim, true)
  assert.ok(dot(want, newDir) > 0.99, '新写法必须指向瞄准方向')
})
