// input/InputMapper.ts —— 操作层：触摸状态 → Intent[]
// 只做"输入 → 意图"，不碰网络、不碰渲染
import type { Intent } from './intent.ts'

// 归一化触摸状态（虚拟摇杆 / 按键）
export interface TouchState {
  moveX: number        // -1..1
  aimAngle: number     // 弧度，360°
  fire: boolean
  jump: boolean
  jetpack: boolean
  reload: boolean
}

export class InputMapper {
  map(t: TouchState): Intent[] {
    const out: Intent[] = []
    if (t.moveX !== 0) out.push({ t: 'move', dir: Math.sign(t.moveX) as -1 | 1 })
    if (t.jump) out.push({ t: 'jump' })
    if (t.jetpack) out.push({ t: 'jetpack', on: true })
    out.push({ t: 'aim', angle: t.aimAngle })
    out.push({ t: 'fire', on: t.fire })
    if (t.reload) out.push({ t: 'reload' })
    return out
  }
}
