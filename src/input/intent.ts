// input/intent.ts —— 操作层唯一对外数据类型（触屏/键鼠 → 语义意图）
// 注意：core 不 import 本文件（core 用 WorldInput，联机层负责合并）
// 合并扩展：v2 的副武器触发 / E 交互 / 换枪（瞬时意图，服务器单发消费）
export type Intent =
  | { t: 'move'; dir: -1 | 0 | 1 }
  | { t: 'jump' }
  | { t: 'jetpack'; on: boolean }
  | { t: 'aim'; angle: number }
  | { t: 'fire'; on: boolean }
  | { t: 'reload' }
  | { t: 'interact' }
  | { t: 'secondary'; kind: string; targetX: number; targetY: number }
  | { t: 'switchWeapon'; index: number }
