// input/InputMapper.ts —— 操作层：触摸状态 → Intent[]
// 只做"输入 → 意图"，不碰网络、不碰渲染
// 合并扩展：interact(E) / secondary(副武器+准星) / switchWeapon（均为瞬时；momentary 由调用方消费）
import type { Intent } from './intent.ts'

// 归一化触摸状态（虚拟摇杆 / 按键）
export interface TouchState {
  moveX: number        // -1..1
  aimAngle: number     // 弧度，360°
  fire: boolean
  jump: boolean
  jetpack: boolean
  dive?: boolean
  reload: boolean
  // v2 扩展（瞬时动作：调用方每帧消费后清零）
  interact?: boolean                       // E 键按下沿
  secondary?: { kind: string; targetX: number; targetY: number } | null
  switchWeapon?: number | null
}

export class InputMapper {
  map(t: TouchState): Intent[] {
    const out: Intent[] = []
    if (t.moveX !== 0) out.push({ t: 'move', dir: Math.sign(t.moveX) as -1 | 1 })
    if (t.jump) out.push({ t: 'jump' })
    out.push({ t: 'jetpack', on: t.jetpack })
    if (t.dive) out.push({ t: 'dive', on: true })
    out.push({ t: 'aim', angle: t.aimAngle })
    out.push({ t: 'fire', on: t.fire })
    if (t.reload) out.push({ t: 'reload' })
    if (t.interact) out.push({ t: 'interact' })
    if (t.secondary) out.push({ t: 'secondary', kind: t.secondary.kind, targetX: t.secondary.targetX, targetY: t.secondary.targetY })
    if (t.switchWeapon !== null && t.switchWeapon !== undefined) out.push({ t: 'switchWeapon', index: t.switchWeapon })
    return out
  }
}
