// web/game/interp.ts —— 渲染插值（固定步长逻辑 + 高刷新率显示器的必要补偿 + 环形世界跨缝连续插值）
//
// 问题背景：逻辑固定 60Hz 步进，但显示器常是 120/144/165/240Hz。
// 144Hz 下约 58% 的帧不会推进 tick，若直接用 world 里的实体坐标渲染，
// 这些帧里角色/弹丸/相机全部静止，其余帧又一次性跳一整步（例如 4.3px）——
// 画面表现为"隔一两帧顿一下"，而帧率与 CPU 统计完全正常。
//
// 解法：保留上一 tick 的实体位置，渲染时用 acc/FIXED 作为 0..1 的插值系数，
// 在「上一 tick 位置」与「当前 tick 位置」之间按环形最短位移（wrapDeltaX/wrapDeltaY）取中间值，
// 使高刷屏每帧都有平滑连续的位置变化，且跨过 x=0/13200 或 y=0/4400 接缝时不中断、不跳帧。
import { wrapX, wrapY, wrapDeltaX, wrapDeltaY } from '../../core/wrap.ts'

export interface InterpPos { x: number; y: number }

/** 单帧渲染用的位置覆盖表：key -> 插值后位置（世界坐标） */
const posOverlay = new Map<string, InterpPos>()
/** 上一 tick 记录的位置快照：key -> {x,y} */
const prevPos = new Map<string, InterpPos>()

/**
 * 实体类别。**必须**参与 key —— 各类实体的 id 空间互相独立且都从 1 开始
 * （玩家 id 1..8、弹丸 id 也从 1 开始，且弹丸销毁后 id 会被复用），
 * 只用数字 id 做 key 会让玩家与弹丸互相覆盖插值位置，画面直接错乱。
 */
export type InterpKind = 'p' | 'pr' | 'g' | 'm' | 'as'

export interface InterpEntity {
  id: number
  pos: { x: number; y: number }
  /** 是否参与插值（弹丸/玩家等移动实体） */
  alive?: boolean
}

function keyOf(kind: InterpKind, id: number): string {
  return kind + id
}

/**
 * 在 tick 推进之前调用：把当前实体位置记为「上一 tick 位置」。
 *
 * 注意：这里**不能** clear 整张表 —— 玩家与弹丸是分两次调用的
 * （capturePrevPositions(players) / capturePrevPositions(projectiles)），
 * 若每次 clear 会把先写入的那一类抹掉，导致该类实体永远没有插值基准。
 * 改为按 id 覆盖 + 定期清理已不存在的 id（见 prunePrevPositions）。
 */
export function capturePrevPositions(kind: InterpKind, entities: ArrayLike<InterpEntity>): void {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]
    if (!e) continue
    const key = keyOf(kind, e.id)
    // 复用对象避免每次分配
    let slot = prevPos.get(key)
    if (!slot) { slot = { x: 0, y: 0 }; prevPos.set(key, slot) }
    slot.x = e.pos.x
    slot.y = e.pos.y
    liveIds.add(key)
  }
}

/** 本轮捕获涉及到的 key（用于清理消失的实体，避免 prevPos 无限增长） */
const liveIds = new Set<string>()

/** 每帧所有类别都捕获完后调用：移除本帧未出现的 id */
export function prunePrevPositions(): void {
  if (prevPos.size <= liveIds.size) { liveIds.clear(); return }
  for (const id of prevPos.keys()) {
    if (!liveIds.has(id)) prevPos.delete(id)
  }
  liveIds.clear()
}

/**
 * 在渲染之前调用：按 alpha (0..1) 在上一 tick 与当前 tick 位置之间按环形最短位移插值，
 * 结果写入 posOverlay，渲染层通过 getRenderPos 读取。
 */
export function buildPositionOverlay(kind: InterpKind, entities: ArrayLike<InterpEntity>, alpha: number): void {
  // 注意：这里**不能** clear —— 玩家与弹丸分两次调用，clear 会抹掉先计算的那一类。
  // 每帧开始时由 beginOverlayFrame() 统一清空。
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]
    if (!e) continue
    const key = keyOf(kind, e.id)
    const prev = prevPos.get(key)
    if (!prev) continue
    // 环形最短位移（兼容跨 x=0/13200 或 y=0/4400 接缝以及坐标未归一化测试场景）
    const rawDx = e.pos.x - prev.x
    const rawDy = e.pos.y - prev.y
    const dx = Math.abs(rawDx) <= 400 ? rawDx : wrapDeltaX(prev.x, e.pos.x)
    const dy = Math.abs(rawDy) <= 400 ? rawDy : wrapDeltaY(prev.y, e.pos.y)
    // 传送/重生等大幅真实位移（>400px）不做插值（否则会出现穿墙滑行）
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) continue
    let slot = posOverlay.get(key)
    if (!slot) { slot = { x: 0, y: 0 }; posOverlay.set(key, slot) }
    const nx = prev.x + dx * a
    const ny = prev.y + dy * a
    slot.x = Math.abs(rawDx) <= 400 ? nx : wrapX(nx)
    slot.y = Math.abs(rawDy) <= 400 ? ny : wrapY(ny)
  }
}

/** 每帧渲染前（调用 buildPositionOverlay 之前）清空一次 overlay */
export function beginOverlayFrame(): void {
  posOverlay.clear()
}

/** 渲染时读取插值后的位置；没有覆盖则回退到实体真实位置 */
export function getRenderPos(kind: InterpKind, id: number, fallbackX: number, fallbackY: number): InterpPos {
  const o = posOverlay.get(keyOf(kind, id))
  if (!o) return { x: fallbackX, y: fallbackY }
  return o
}

/** 是否有该 id 的插值覆盖 */
export function hasRenderPos(kind: InterpKind, id: number): boolean {
  return posOverlay.has(keyOf(kind, id))
}

/** 清空（换局/重置时用） */
export function clearInterp(): void {
  posOverlay.clear()
  prevPos.clear()
}
