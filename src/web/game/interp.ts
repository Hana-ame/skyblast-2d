// web/game/interp.ts —— 渲染插值（固定步长逻辑 + 高刷新率显示器的必要补偿）
//
// 问题背景：逻辑固定 60Hz 步进，但显示器常是 120/144/165/240Hz。
// 144Hz 下约 58% 的帧不会推进 tick，若直接用 world 里的实体坐标渲染，
// 这些帧里角色/弹丸/相机全部静止，其余帧又一次性跳一整步（例如 4.3px）——
// 画面表现为"隔一两帧顿一下"，而帧率与 CPU 统计完全正常。
//
// 解法：保留上一 tick 的实体位置，渲染时用 acc/FIXED 作为 0..1 的插值系数，
// 在「上一 tick 位置」与「当前 tick 位置」之间取中间值，使高刷屏每帧都有
// 平滑连续的位置变化。这不改变逻辑与手感，只是让显示更顺。

export interface InterpPos { x: number; y: number }

/** 单帧渲染用的位置覆盖表：id -> 插值后位置（世界坐标） */
const posOverlay = new Map<number, InterpPos>()
/** 上一 tick 记录的位置快照：id -> {x,y} */
const prevPos = new Map<number, InterpPos>()

export interface InterpEntity {
  id: number
  pos: { x: number; y: number }
  /** 是否参与插值（弹丸/玩家等移动实体） */
  alive?: boolean
}

/**
 * 在 tick 推进之前调用：把当前实体位置记为「上一 tick 位置」。
 *
 * 注意：这里**不能** clear 整张表 —— 玩家与弹丸是分两次调用的
 * （capturePrevPositions(players) / capturePrevPositions(projectiles)），
 * 若每次 clear 会把先写入的那一类抹掉，导致该类实体永远没有插值基准。
 * 改为按 id 覆盖 + 定期清理已不存在的 id（见 prunePrevPositions）。
 */
export function capturePrevPositions(entities: ArrayLike<InterpEntity>): void {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]
    if (!e) continue
    // 复用对象避免每次分配
    let slot = prevPos.get(e.id)
    if (!slot) { slot = { x: 0, y: 0 }; prevPos.set(e.id, slot) }
    slot.x = e.pos.x
    slot.y = e.pos.y
    liveIds.add(e.id)
  }
}

/** 本轮捕获涉及到的 id（用于清理消失的实体，避免 prevPos 无限增长） */
const liveIds = new Set<number>()

/** 每帧所有类别都捕获完后调用：移除本帧未出现的 id */
export function prunePrevPositions(): void {
  if (prevPos.size <= liveIds.size) { liveIds.clear(); return }
  for (const id of Array.from(prevPos.keys())) {
    if (!liveIds.has(id)) prevPos.delete(id)
  }
  liveIds.clear()
}

/**
 * 在渲染之前调用：按 alpha (0..1) 在上一 tick 与当前 tick 位置之间插值，
 * 结果写入 posOverlay，渲染层通过 getRenderPos 读取。
 */
export function buildPositionOverlay(entities: ArrayLike<InterpEntity>, alpha: number): void {
  // 注意：这里**不能** clear —— 玩家与弹丸分两次调用，clear 会抹掉先计算的那一类。
  // 每帧开始时由 beginOverlayFrame() 统一清空。
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]
    if (!e) continue
    const prev = prevPos.get(e.id)
    if (!prev) continue
    // 传送/重生等大幅位移不做插值（否则会出现穿墙滑行）
    const dx = e.pos.x - prev.x
    const dy = e.pos.y - prev.y
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) continue
    let slot = posOverlay.get(e.id)
    if (!slot) { slot = { x: 0, y: 0 }; posOverlay.set(e.id, slot) }
    slot.x = prev.x + dx * a
    slot.y = prev.y + dy * a
  }
}

/** 每帧渲染前（调用 buildPositionOverlay 之前）清空一次 overlay */
export function beginOverlayFrame(): void {
  posOverlay.clear()
}

/** 渲染时读取插值后的位置；没有覆盖则回退到实体真实位置 */
export function getRenderPos(id: number, fallbackX: number, fallbackY: number): InterpPos {
  const o = posOverlay.get(id)
  if (!o) return { x: fallbackX, y: fallbackY }
  return o
}

/** 是否有该 id 的插值覆盖 */
export function hasRenderPos(id: number): boolean {
  return posOverlay.has(id)
}

/** 清空（换局/重置时用） */
export function clearInterp(): void {
  posOverlay.clear()
  prevPos.clear()
}
