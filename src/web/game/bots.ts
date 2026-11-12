// web/game/bots.ts —— 固定路线巡逻 AI 与均衡队伍分配系统
// 特性：
//   1. 严格出生点出生：
//      - 所有 AI 与玩家一样，100% 严格通过 World.addPlayer / World.deploy 在真实出生点出生（双队模式在各自基地或已占领的旗帜据点 A/B/C/D/E 出生，FFA 模式在全图随机安全点出生）。
//   2. 均衡队伍分配：
//      - 双队模式（2teams）下严格按「敌方、友方」交替分配机器人，确保红蓝双方始终人数均衡；切换模式或切换队伍时自动同步重部署。
//   3. 固定路线巡逻（Fixed-Route Patrol）：
//      - AI 移动完全遵循预设的三条固定巡逻路线（主地面路线 `main_deck`、高空拱桥路线 `sky_arch`、地下通道路线 `underground`），在路标点之间往返循环巡逻，绝不因为隔墙追踪敌人坐标而卡死在墙角或地板下；
//      - 巡逻过程中实时检测直接视线（hasLOS）：有直接视线时瞄准敌人开火，无直接视线时枪口朝向当前巡逻行进方向继续按固定路线推进。
import { botNames, bots, world, localPlayer, mode, featureFlags } from '../app/context.ts'
import { updateTeamCountUI, updateSpawnPointButtonsUI } from '../app/hud.ts'
import { WEAPONS, isSecondaryUnlocked, getHighestUnlockedSecondary } from '../../core/weapons.ts'
import { MAIN_DECK_TOP } from '../../core/map.ts'
import { getPhysicsParams } from '../../core/sim/physics.ts'
import { findObstacleAt } from '../../core/sim/spatial.ts'
import { isCapturePointSelectable } from '../../core/sim/interactables.ts'
import { defaultWorldInput } from '../../core/types.ts'
import type { WorldInput, PlayerState, TeamId } from '../../core/types.ts'

/** 常规可用主武器池（突击步枪、霰弹枪、冲锋枪、狙击步枪、手枪、火箭筒） */
const BOT_PRIMARY_POOL = [1, 0, 8, 2, 7, 3, 1, 8]

export type PatrolRouteId = 'main_deck' | 'sky_arch' | 'underground'

export interface PatrolWaypoint {
  x: number
  y: number
  label: string
  /** 爬升至该路标点时使用的竖井或起跳点 X 坐标（可选） */
  ascendX?: number
  /** 到达判定半径（默认 X: 54, Y: 44） */
  tolX?: number
  tolY?: number
}

/** 空中 27 座正方形拱桥的逐级站立中心路标点（从左翼 L0 到正中 C 再到右翼 R0） */
export const SKY_ARCH_NODES: PatrolWaypoint[] = [
  { x: 1210,  y: 2940 - 16, label: '空岛L0' },
  { x: 1630,  y: 2660 - 16, label: '空岛L1' },
  { x: 2050,  y: 2380 - 16, label: '空岛L2' },
  { x: 2470,  y: 2480 - 16, label: '空岛L3' },
  { x: 2890,  y: 2180 - 16, label: '空岛L4' },
  { x: 3310,  y: 1900 - 16, label: '空岛L5' },
  { x: 3730,  y: 2000 - 16, label: '据点B·西拱半路' },
  { x: 4150,  y: 1700 - 16, label: '空岛L7' },
  { x: 4570,  y: 1420 - 16, label: '空岛L8' },
  { x: 4990,  y: 1520 - 16, label: '空岛L9' },
  { x: 5410,  y: 1240 - 16, label: '空岛L10' },
  { x: 5830,  y: 1340 - 16, label: '空岛L11' },
  { x: 6250,  y: 1080 - 16, label: '空岛L12' },
  { x: 6600,  y: 980 - 16,  label: '据点C·正中拱顶' },
  { x: 6950,  y: 1080 - 16, label: '空岛R12' },
  { x: 7370,  y: 1340 - 16, label: '空岛R11' },
  { x: 7790,  y: 1240 - 16, label: '空岛R10' },
  { x: 8210,  y: 1520 - 16, label: '空岛R9' },
  { x: 8630,  y: 1420 - 16, label: '空岛R8' },
  { x: 9050,  y: 1700 - 16, label: '空岛R7' },
  { x: 9470,  y: 2000 - 16, label: '据点D·东拱半路' },
  { x: 9890,  y: 1900 - 16, label: '空岛R5' },
  { x: 10310, y: 2180 - 16, label: '空岛R4' },
  { x: 10730, y: 2480 - 16, label: '空岛R3' },
  { x: 11150, y: 2380 - 16, label: '空岛R2' },
  { x: 11570, y: 2660 - 16, label: '空岛R1' },
  { x: 11990, y: 2940 - 16, label: '空岛R0' },
]

/** 三条预设固定巡逻路线：主地面路线、高空拱桥路线、地下通道路线 */
export const PATROL_ROUTES: Record<PatrolRouteId, PatrolWaypoint[]> = {
  main_deck: [
    { x: 960,   y: MAIN_DECK_TOP - 16, label: '主地面·西端起点' },
    { x: 1580,  y: MAIN_DECK_TOP - 16, label: '主地面·西一坑前' },
    { x: 2280,  y: MAIN_DECK_TOP - 16, label: '主地面·西外段' },
    { x: 2780,  y: MAIN_DECK_TOP - 16, label: '主地面·西二坑前' },
    { x: 3680,  y: MAIN_DECK_TOP - 16, label: '主地面·西中段' },
    { x: 4280,  y: MAIN_DECK_TOP - 16, label: '主地面·西三坑前' },
    { x: 4950,  y: MAIN_DECK_TOP - 16, label: '主地面·中心西弹药点' },
    { x: 5880,  y: MAIN_DECK_TOP - 16, label: '主地面·中央西井口前' },
    { x: 6320,  y: MAIN_DECK_TOP - 16, label: '主地面·中央西隔断台' },
    { x: 6880,  y: MAIN_DECK_TOP - 16, label: '主地面·中央东隔断台' },
    { x: 7320,  y: MAIN_DECK_TOP - 16, label: '主地面·中央东井口前' },
    { x: 8250,  y: MAIN_DECK_TOP - 16, label: '主地面·中心东弹药点' },
    { x: 8920,  y: MAIN_DECK_TOP - 16, label: '主地面·东三坑后' },
    { x: 9520,  y: MAIN_DECK_TOP - 16, label: '主地面·东中段' },
    { x: 10420, y: MAIN_DECK_TOP - 16, label: '主地面·东二坑后' },
    { x: 10920, y: MAIN_DECK_TOP - 16, label: '主地面·东外段' },
    { x: 11620, y: MAIN_DECK_TOP - 16, label: '主地面·东一坑后' },
    { x: 12240, y: MAIN_DECK_TOP - 16, label: '主地面·东端终点' },
  ],
  sky_arch: [
    { x: 980,   y: MAIN_DECK_TOP - 16, label: '拱桥·西侧地面入口' },
    ...SKY_ARCH_NODES,
    { x: 12220, y: MAIN_DECK_TOP - 16, label: '拱桥·东侧地面入口' },
  ],
  underground: [
    { x: 3090,  y: 4160 - 16, label: '地下·西底层弹药点' },
    { x: 3590,  y: 4160 - 16, label: '地下·西竖井底' },
    { x: 4300,  y: 3880 - 16, label: '地下·西中层通道', ascendX: 3590 },
    { x: 5470,  y: 3880 - 16, label: '据点A·地下中西', ascendX: 6090 },
    { x: 6090,  y: 4160 - 16, label: '地下·中央西竖井底' },
    { x: 6600,  y: 4160 - 16, label: '地下·中央最底部引力枪' },
    { x: 7110,  y: 4160 - 16, label: '地下·中央东竖井底' },
    { x: 7730,  y: 3880 - 16, label: '据点E·地下中东', ascendX: 7110 },
    { x: 8900,  y: 3880 - 16, label: '地下·东中层通道', ascendX: 9610 },
    { x: 9610,  y: 4160 - 16, label: '地下·东竖井底' },
    { x: 10110, y: 4160 - 16, label: '地下·东底层弹药点' },
  ],
}

const ROUTE_CYCLE: PatrolRouteId[] = ['main_deck', 'sky_arch', 'underground', 'main_deck']

export interface BotMemory {
  slotIdx: number
  routeId: PatrolRouteId
  waypointIdx: number
  patrolDir: 1 | -1
  lastX: number
  lastY: number
  stuckTicks: number
  unstuckTimer: number
  unstuckDir: -1 | 1
  rechargingFuel: boolean
  sniperReleaseTick: boolean
  initialized: boolean
  manualRouteLocked?: boolean
}

const botMemoryMap = new Map<number, BotMemory>()

/** 根据槽位分配默认固定巡逻路线 */
function defaultRouteForSlot(slotIdx: number): PatrolRouteId {
  return ROUTE_CYCLE[slotIdx % ROUTE_CYCLE.length]
}

/** 找到指定巡逻路线中距离 (x, y) 最近的路标索引 */
function findNearestWaypointIndex(route: PatrolWaypoint[], x: number, y: number): number {
  let bestIdx = 0
  let bestScore = Infinity
  for (let i = 0; i < route.length; i++) {
    const wp = route[i]
    const score = Math.abs(wp.x - x) + Math.abs(wp.y - y) * 1.8
    if (score < bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestIdx
}

/** 判定机器人脚下是否有实心地面支撑（兼容落地微距沉降帧） */
function isSupportedByFloor(bot: PlayerState): boolean {
  if (bot.onGround) return true
  if (Math.abs(bot.vel.y) > 55) return false
  const bx = bot.pos.x
  const by = bot.pos.y
  return (
    world.terrain.isSolidAt(bx, by + 20) ||
    world.terrain.isSolidAt(bx - 8, by + 20) ||
    world.terrain.isSolidAt(bx + 8, by + 20)
  )
}

/** 获取机器人当前武器的最大喷气燃料上限 */
function getBotMaxFuel(bot: PlayerState): number {
  const wep = WEAPONS[bot.weaponIndex] ?? WEAPONS[1]
  return getPhysicsParams().jetpackFuel * (wep.fuelMult ?? 1)
}

/** 在出生或重部署后，根据实际出生位置与槽位绑定固定巡逻路线及起始路标点 */
function alignPatrolRouteOnSpawn(bot: PlayerState, mem: BotMemory): void {
  const bx = bot.pos.x
  const by = bot.pos.y
  const defaultDir: 1 | -1 =
    bot.team === 'red' ? 1 :
    bot.team === 'blue' ? -1 :
    bx <= 6600 ? 1 : -1

  if (!mem.manualRouteLocked) {
    // 最短路径进攻敌方原始出生点：默认走主地面直达走廊 (main_deck)
    mem.routeId = 'main_deck'
  } else if (by < MAIN_DECK_TOP - 220) {
    mem.routeId = 'sky_arch'
  } else if (by > MAIN_DECK_TOP + 120) {
    mem.routeId = 'underground'
  } else {
    mem.routeId = defaultRouteForSlot(mem.slotIdx)
  }

  const route = PATROL_ROUTES[mem.routeId]
  mem.waypointIdx = findNearestWaypointIndex(route, bx, by)
  mem.patrolDir = defaultDir
  if (mem.waypointIdx === 0) mem.patrolDir = 1
  else if (mem.waypointIdx === route.length - 1) mem.patrolDir = -1
  mem.stuckTicks = 0
  mem.unstuckTimer = 0
  mem.initialized = true
}

function getBotMemory(bot: PlayerState, slotIdx = 0): BotMemory {
  let mem = botMemoryMap.get(bot.id)
  if (!mem) {
    const routeId = defaultRouteForSlot(slotIdx)
    const defaultDir: 1 | -1 = bot.team === 'blue' ? -1 : 1
    mem = {
      slotIdx,
      routeId,
      waypointIdx: 0,
      patrolDir: defaultDir,
      lastX: bot.pos.x,
      lastY: bot.pos.y,
      stuckTicks: 0,
      unstuckTimer: 0,
      unstuckDir: defaultDir,
      rechargingFuel: false,
      sniperReleaseTick: false,
      initialized: false,
    }
    alignPatrolRouteOnSpawn(bot, mem)
    botMemoryMap.set(bot.id, mem)
  }
  return mem
}

/** 导出给调试与测试读取的机器人固定巡逻状态 */
export function getBotPatrolStatus(bot: PlayerState): {
  routeId: PatrolRouteId
  waypointIdx: number
  patrolDir: 1 | -1
  waypoint: PatrolWaypoint
} {
  const mem = getBotMemory(bot)
  const route = PATROL_ROUTES[mem.routeId]
  const wp = route[Math.max(0, Math.min(route.length - 1, mem.waypointIdx))]
  return {
    routeId: mem.routeId,
    waypointIdx: mem.waypointIdx,
    patrolDir: mem.patrolDir,
    waypoint: wp,
  }
}

/** 手动指定某个机器人的固定巡逻路线（便于测试或定制） */
export function setBotPatrolRoute(bot: PlayerState, routeId: PatrolRouteId, startIdx?: number, dir?: 1 | -1): void {
  const mem = getBotMemory(bot)
  mem.manualRouteLocked = true
  mem.routeId = routeId
  const route = PATROL_ROUTES[routeId]
  mem.waypointIdx = startIdx !== undefined
    ? Math.max(0, Math.min(route.length - 1, startIdx))
    : findNearestWaypointIndex(route, bot.pos.x, bot.pos.y)
  if (dir !== undefined) {
    mem.patrolDir = dir
  } else if (mem.waypointIdx === 0) {
    mem.patrolDir = 1
  } else if (mem.waypointIdx === route.length - 1) {
    mem.patrolDir = -1
  }
  mem.lastX = bot.pos.x
  mem.lastY = bot.pos.y
  mem.stuckTicks = 0
  mem.unstuckTimer = 0
  mem.initialized = true
}

/** 计算第 idx 个机器人在当前模式与玩家队伍下的目标队伍 */
export function computeBotTeam(idx: number): TeamId {
  if (mode.current === 'ffa') return 'ffa'
  const playerTeam: TeamId = localPlayer.team === 'blue' ? 'blue' : 'red'
  const enemyTeam: TeamId = playerTeam === 'red' ? 'blue' : 'red'
  return idx % 2 === 0 ? enemyTeam : playerTeam
}

export function syncBotsCount(target: number): void {
  world.config.randomSpawn = mode.current === 'ffa'

  while (bots.length > target) {
    const b = bots.pop()!
    botMemoryMap.delete(b.id)
    world.players = world.players.filter(p => p.id !== b.id)
  }
  while (bots.length < target) {
    const idx = bots.length
    const team = computeBotTeam(idx)
    const b = world.addPlayer(botNames[idx % botNames.length], team)
    const wepId = BOT_PRIMARY_POOL[idx % BOT_PRIMARY_POOL.length]
    b.weaponIndex = wepId
    b.lastPrimaryIndex = wepId
    b.secondary = 'frag'
    getBotMemory(b, idx)
    bots.push(b)
  }
  bots.forEach((b, idx) => {
    const mem = getBotMemory(b, idx)
    mem.slotIdx = idx
    const nextTeam = computeBotTeam(idx)
    if (b.team !== nextTeam) {
      b.team = nextTeam
      b.selectedSpawnId = 'base'
      world.deploy(b)
      alignPatrolRouteOnSpawn(b, mem)
    }
  })
  updateTeamCountUI()
  updateSpawnPointButtonsUI()
}

function directDist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

/** 检测两点之间是否有直接视线（不被不可破坏地形或可破坏掩体阻挡，且不跨左右封闭边界墙） */
export function hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)
  if (dist < 16) return true
  if (Math.abs(dx) > 6000) return false
  const steps = Math.max(2, Math.ceil(dist / 16))
  const inv = 1 / steps
  for (let i = 1; i < steps; i++) {
    const t = i * inv
    const px = x1 + dx * t
    const py = y1 + dy * t
    if (world.terrain.isSolidAt(px, py)) return false
    if (findObstacleAt(world.obstacles, world.obstacleBroadBuckets, px, py) !== null) return false
  }
  return true
}

function isMuzzleBlockedNear(bot: PlayerState, aim: number, nearDist = 72): boolean {
  const ox = bot.pos.x
  const oy = bot.pos.y - 12
  const ca = Math.cos(aim)
  const sa = Math.sin(aim)
  for (let d = 18; d <= nearDist; d += 18) {
    const px = ox + ca * d
    const py = oy + sa * d
    if (world.terrain.isSolidAt(px, py)) return true
    if (findObstacleAt(world.obstacles, world.obstacleBroadBuckets, px, py) !== null) return true
  }
  return false
}

/** 目标选择：优先选择巡逻视野内有直接视线（LOS）的最近敌人 */
export function pickBotTarget(bot: PlayerState): PlayerState | null {
  const candidates = [localPlayer, ...bots].filter(e =>
    e !== bot && e.deployed && e.alive && e.respawnTimer <= 0 && (bot.team === 'ffa' || e.team !== bot.team),
  )
  if (candidates.length === 0) return null

  const bx = bot.pos.x
  const by = bot.pos.y - 12
  let bestTarget: PlayerState | null = null
  let bestScore = Infinity

  for (const e of candidates) {
    const ex = e.pos.x
    const ey = e.pos.y - 12
    const d = directDist(bx, by, ex, ey)
    const los = d < 1800 && hasLineOfSight(bx, by, ex, ey)
    const sameLayer = Math.abs(e.pos.y - bot.pos.y) < 280
    const score = d - (los ? 3200 : 0) - (sameLayer ? 400 : 0)
    if (score < bestScore) {
      bestScore = score
      bestTarget = e
    }
  }
  return bestTarget
}

/** 获取 AI 的唯一进攻目标：敌方原始基地出生点（严格排除所有旗帜据点 Flag） */
export function getEnemyOriginalBaseSpawn(bot: PlayerState): { x: number; y: number; team: TeamId } {
  if (bot.team === 'red') return { x: 12940, y: MAIN_DECK_TOP - 16, team: 'blue' }
  if (bot.team === 'blue') return { x: 260, y: MAIN_DECK_TOP - 16, team: 'red' }
  return bot.pos.x <= 6600
    ? { x: 12940, y: MAIN_DECK_TOP - 16, team: 'blue' }
    : { x: 260, y: MAIN_DECK_TOP - 16, team: 'red' }
}

/** 扫描并返回机器人在面对敌方威胁时最近的可躲避掩体背弹侧坐标（支持可破坏掩体与地形矮墙） */
export function findNearestCoverPosition(
  bot: PlayerState,
  enemy: PlayerState,
): { x: number; y: number; kind: 'obstacle' | 'terrain'; coverX: number } | null {
  const bx = bot.pos.x
  const by = bot.pos.y
  const ex = enemy.pos.x
  let best: { x: number; y: number; kind: 'obstacle' | 'terrain'; coverX: number } | null = null
  let bestDist = 380

  // 1) 扫描附近可破坏掩体 (world.obstacles)
  for (const ob of world.obstacles) {
    if (ob.hp <= 0) continue
    if (Math.abs((ob.y + ob.h) - (by + 16)) > 95) continue
    const cx = ob.x + ob.w / 2
    const d = Math.abs(cx - bx)
    if (d > bestDist) continue
    // 背向敌人的一侧作为掩体后方站位
    const shelterX = ex >= cx ? ob.x - 22 : ob.x + ob.w + 22
    if (!world.bodyOverlapsAt(shelterX, by) && world.terrain.isSolidAt(shelterX, by + 20)) {
      bestDist = d
      best = { x: shelterX, y: by, kind: 'obstacle', coverX: cx }
    }
  }

  // 2) 扫描附近实心矮墙/掩体柱 (world.terrain.rects)
  for (const r of world.terrain.rects) {
    if (r.kind.startsWith('deco_') || r.kind.endsWith('_bg')) continue
    if (r.h < 34 || r.h > 260 || r.w > 320) continue
    if (Math.abs((r.y + r.h) - (by + 16)) > 95) continue
    const cx = r.x + r.w / 2
    const d = Math.abs(cx - bx)
    if (d > bestDist) continue
    const shelterX = ex >= cx ? r.x - 22 : r.x + r.w + 22
    if (!world.bodyOverlapsAt(shelterX, by) && world.terrain.isSolidAt(shelterX, by + 20)) {
      bestDist = d
      best = { x: shelterX, y: by, kind: 'terrain', coverX: cx }
    }
  }
  return best
}

/** AI 始终固定使用原始基地出生点 ('base')，绝不选择旗帜据点作为重生点 */
function updateBotSelectedSpawn(bot: PlayerState, mem: BotMemory): void {
  bot.selectedSpawnId = 'base'
  if (!mem.manualRouteLocked) {
    mem.routeId = 'main_deck'
    const goal = getEnemyOriginalBaseSpawn(bot)
    mem.patrolDir = goal.x >= bot.pos.x ? 1 : -1
  }
}

function hasOpenShaftAbove(bx: number, by: number): boolean {
  for (let dy = 42; dy <= 122; dy += 26) {
    if (world.terrain.isSolidAt(bx - 6, by - dy) || world.terrain.isSolidAt(bx + 6, by - dy)) {
      return false
    }
  }
  return true
}

/** 推进固定巡逻路标索引（在路线两端自动折返） */
function advancePatrolWaypoint(mem: BotMemory, route: PatrolWaypoint[]): void {
  let nextIdx = mem.waypointIdx + mem.patrolDir
  if (!mem.manualRouteLocked) {
    nextIdx = Math.max(0, Math.min(route.length - 1, nextIdx))
  } else if (nextIdx >= route.length) {
    mem.patrolDir = -1
    nextIdx = Math.max(0, route.length - 2)
  } else if (nextIdx < 0) {
    mem.patrolDir = 1
    nextIdx = Math.min(route.length - 1, 1)
  }
  mem.waypointIdx = nextIdx
  mem.stuckTicks = 0
}

/** 固定路线巡逻导航器：严格沿 mem.routeId 的路标序列巡逻 */
function computePatrolNavigation(
  bot: PlayerState,
  mem: BotMemory,
): { move: -1 | 0 | 1; jump: boolean; jetpack: boolean; dive: boolean } {
  const bx = bot.pos.x
  const by = bot.pos.y
  let move: -1 | 0 | 1 = 0
  let jump = false
  let jetpack = false
  let dive = false

  // 检测是否刚重生/传送（大幅位移），若是则重新对齐最近巡逻路标点
  const stepDist = Math.hypot(bx - mem.lastX, by - mem.lastY)
  mem.lastX = bx
  mem.lastY = by
  if (!mem.initialized || stepDist > 420) {
    alignPatrolRouteOnSpawn(bot, mem)
  }

  const maxFuel = getBotMaxFuel(bot)
  const supported = isSupportedByFloor(bot)

  // ── 0. 地面燃料回充控制 ──
  if (supported) {
    if (bot.fuel < maxFuel * 0.28) mem.rechargingFuel = true
    else if (bot.fuel >= maxFuel * 0.88) mem.rechargingFuel = false
  } else if (bot.fuel <= 0.02) {
    mem.rechargingFuel = true
  }

  const route = PATROL_ROUTES[mem.routeId]
  mem.waypointIdx = Math.max(0, Math.min(route.length - 1, mem.waypointIdx))
  let wp = route[mem.waypointIdx]

  // ── 1. 到达当前巡逻路标点判定 → 立即推进至下一路标点 ──
  const tolX = wp.tolX ?? (mem.routeId === 'sky_arch' ? 80 : 54)
  const tolY = wp.tolY ?? (mem.routeId === 'sky_arch' ? 28 : 44)
  const requireGround = mem.routeId === 'sky_arch'
  if ((!requireGround || supported) && Math.abs(bx - wp.x) <= tolX && Math.abs(by - wp.y) <= tolY) {
    advancePatrolWaypoint(mem, route)
    wp = route[mem.waypointIdx]
  }

  // ── 2. 反卡死保底：若在同一路标点长时间受阻，微调跳脱或重对齐最近路标 ──
  if (stepDist < 1.1 && !mem.rechargingFuel) {
    mem.stuckTicks++
    if (mem.stuckTicks > 70) {
      mem.unstuckTimer = 20
      mem.unstuckDir = bx < 1000 ? 1 : bx > 12200 ? -1 : (-mem.patrolDir as -1 | 1)
      mem.waypointIdx = findNearestWaypointIndex(route, bx, by)
      advancePatrolWaypoint(mem, route)
      wp = route[mem.waypointIdx]
    }
  } else if (stepDist > 2.2) {
    mem.stuckTicks = Math.max(0, mem.stuckTicks - 2)
  }

  if (mem.unstuckTimer > 0) {
    mem.unstuckTimer--
    move = mem.unstuckDir
    if (bot.onGround) jump = true
    if (!mem.rechargingFuel && hasOpenShaftAbove(bx, by)) jetpack = true
    return { move, jump, jetpack, dive }
  }

  // ── 3. 基地出生台出发引导（左基地 bx < 900 / 右基地 bx > 12300） ──
  if (bx < 900 && by <= MAIN_DECK_TOP + 40) {
    if (mem.routeId === 'underground') {
      // 地下巡逻路线机器人：直接从左基地外侧竖井 (x=590) 下潜进入底层地下通道
      if (bx < 565) {
        move = 1
      } else if (bx > 625) {
        move = -1
      } else {
        move = 0
        dive = true
      }
      return { move, jump: false, jetpack: false, dive }
    }
    if (mem.rechargingFuel && supported && bx < 450) {
      return { move: 1, jump: false, jetpack: false, dive: false }
    }
    move = 1
    if (bx >= 200 && by > MAIN_DECK_TOP - 190) {
      if (bot.onGround) jump = true
      jetpack = true
    }
    return { move, jump, jetpack, dive }
  }

  if (bx > 12300 && by <= MAIN_DECK_TOP + 40) {
    if (mem.routeId === 'underground') {
      // 地下巡逻路线机器人：直接从右基地外侧竖井 (x=12610) 下潜进入底层地下通道
      if (bx > 12635) {
        move = -1
      } else if (bx < 12575) {
        move = 1
      } else {
        move = 0
        dive = true
      }
      return { move, jump: false, jetpack: false, dive }
    }
    if (mem.rechargingFuel && supported && bx > 12750) {
      return { move: -1, jump: false, jetpack: false, dive: false }
    }
    move = -1
    if (bx <= 13000 && by > MAIN_DECK_TOP - 190) {
      if (bot.onGround) jump = true
      jetpack = true
    }
    return { move, jump, jetpack, dive }
  }

  // ── 4. 分路线精确巡逻控制 ──
  // (A) 地下通道固定巡逻路线 (`underground`)
  if (mem.routeId === 'underground') {
    // 若意外在地表，前往最近的中央竖井口 (6090 / 6600 / 7110) 下潜入地
    if (by <= MAIN_DECK_TOP + 40) {
      const shafts = [6090, 6600, 7110]
      const targetShaft = shafts.reduce((a, b) => (Math.abs(b - bx) < Math.abs(a - bx) ? b : a), 6600)
      if (Math.abs(bx - targetShaft) > 36) {
        move = targetShaft > bx ? 1 : -1
        if (by > MAIN_DECK_TOP + 6 && bot.onGround) jump = true
      } else {
        move = 0
        dive = true
      }
      return { move, jump, jetpack, dive }
    }

    // 目标路标在更高层（如从底层 y=4144 升向二层据点 A/E y=3864）
    if (wp.y < by - 80) {
      const shaftX = wp.ascendX ?? (bx < 4800 ? 3590 : bx < 6600 ? 6090 : bx < 8400 ? 7110 : 9610)
      const distToShaft = Math.abs(bx - shaftX)
      // 若还在底层且未到达竖井口，先沿底层水平走到竖井中心
      if (by > wp.y + 40 && distToShaft > 36) {
        move = shaftX > bx ? 1 : -1
        return { move, jump: false, jetpack: false, dive: false }
      }
      // 在竖井底部起跳前先确保燃料充足
      if (supported && by > wp.y + 40 && bot.fuel < maxFuel * 0.65) {
        mem.rechargingFuel = true
        return { move: 0, jump: false, jetpack: false, dive: false }
      }
      if (bot.onGround) jump = true
      jetpack = true
      // 关键物理几何：只有当高度升过二层地板顶面（by <= wp.y - 6，脚底高于地板顶面）后，才横向迈上二层平台！
      if (by <= wp.y - 6) {
        const goalSpawn = !mem.manualRouteLocked ? getEnemyOriginalBaseSpawn(bot) : null
  const targetX = goalSpawn && ((mem.patrolDir > 0 && bx >= wp.x - 48) || (mem.patrolDir < 0 && bx <= wp.x + 48)) ? goalSpawn.x : wp.x
  move = Math.abs(targetX - bx) <= 18 ? 0 : (targetX >= bx ? 1 : -1)
      } else {
        move = distToShaft > 12 ? (shaftX > bx ? 1 : -1) : 0
      }
      return { move, jump, jetpack, dive }
    }

    // 若刚升到目标层高度（|by - wp.y| <= 80），但身体还在竖井开口上方，继续喷气托住并横移踏上实心地板
    if (wp.ascendX !== undefined && Math.abs(bx - wp.ascendX) < 105 && !supported) {
      move = wp.x >= bx ? 1 : -1
      if (by >= wp.y - 8) jetpack = true
      return { move, jump, jetpack, dive }
    }

    // 目标路标在更低层（如从二层 y=3864 下到底层 y=4144）
    if (wp.y > by + 80) {
      move = wp.x >= bx ? 1 : -1
      return { move, jump: false, jetpack: false, dive: true }
    }

    // 同层水平巡逻推进
    move = wp.x >= bx ? 1 : -1
    if (world.terrain.isSolidAt(bx + move * 28, by - 10)) {
      if (bot.onGround) jump = true
    }
    return { move, jump, jetpack, dive }
  }

  // (B) 高空拱桥固定巡逻路线 (`sky_arch`)
  if (mem.routeId === 'sky_arch') {
    // 若意外掉入地下，先从中央竖井升回地面
    if (by > MAIN_DECK_TOP + 80) {
      const exitShaft = bx < 6350 ? 6090 : bx > 6850 ? 7110 : 6600
      move = Math.abs(bx - exitShaft) > 28 ? (exitShaft > bx ? 1 : -1) : 0
      if (Math.abs(bx - exitShaft) < 60 && hasOpenShaftAbove(bx, by)) {
        if (bot.onGround) jump = true
        jetpack = true
      }
      return { move, jump, jetpack, dive }
    }

    // 若从高空空岛不慎坠落（站在地面/更低方块上且当前高度比目标路标低超过 340px），
    // 对齐至当前所在位置并朝巡逻方向指向下一块空岛
    if (supported && by - wp.y > 340) {
      const nearIdx = findNearestWaypointIndex(route, bx, by)
      mem.waypointIdx = Math.max(0, Math.min(route.length - 1, nearIdx + mem.patrolDir))
      wp = route[mem.waypointIdx]
    }

    const dx = wp.x - bx
    const dy = wp.y - by

    // 站在当前空岛或地面入口上准备跳往下一座空岛时：
    // 先在当前方块顶面原地回满燃料（上山需 >=0.92*maxFuel，下山跨 420px 间隙需 >=0.60*maxFuel），
    // 使用 isSupportedByFloor 防止落地微距沉降帧误判为空中而提前起跳！
    if (supported) {
      const neededRatio = dy < -10 ? 0.92 : Math.abs(dx) > 150 ? 0.60 : 0.25
      if (bot.fuel < maxFuel * neededRatio) {
        mem.rechargingFuel = true
        return { move: 0, jump: false, jetpack: false, dive: false }
      }
    }

    // 飞往下一座更高空岛（dy < -16）或正在空中攀爬向目标空岛：
    if (dy < -16 || (!supported && Math.abs(dx) > 65 && by > wp.y - 12)) {
      if (bot.onGround) jump = true
      if (hasOpenShaftAbove(bx, by)) jetpack = true
      if (by > wp.y - 8) {
        const absDx = Math.abs(dx)
        if (absDx < 138) {
          move = dx >= 0 ? -1 : 1
        } else if (absDx <= 168) {
          move = 0
        } else {
          move = dx >= 0 ? 1 : -1
        }
      } else {
        move = dx >= 0 ? 1 : -1
      }
      return { move, jump, jetpack, dive }
    }

    // 目标空岛低于或平齐当前高度（下山跳往下一座空岛）：
    move = dx >= 0 ? 1 : -1
    const steppingOffEdge = supported && !world.terrain.isSolidAt(bx + move * 36, by + 24)
    if (steppingOffEdge) {
      if (bot.onGround) jump = true
      jetpack = true
    } else if (!supported && by > wp.y - 14 && Math.abs(dx) > 55) {
      // 空中横向飞越两座空岛间隙（间距 420px）时保持喷气滑翔，确保稳稳落在下一座空岛顶面
      jetpack = true
    }
    return { move, jump, jetpack, dive }
  }

  // (C) 主地面固定巡逻路线 (`main_deck`)
  // 若意外掉入地下，先沿竖井飞回主地面
  if (by > MAIN_DECK_TOP + 80) {
    const exitShaft = bx < 6350 ? 6090 : bx > 6850 ? 7110 : 6600
    move = Math.abs(bx - exitShaft) > 28 ? (exitShaft > bx ? 1 : -1) : 0
    if (Math.abs(bx - exitShaft) < 60 && hasOpenShaftAbove(bx, by)) {
      if (bot.onGround) jump = true
      jetpack = true
    }
    return { move, jump, jetpack, dive }
  }

  move = wp.x >= bx ? 1 : -1

  // 地表 6 处凹陷坑跃出（3290 < by <= 3360）
  if (by > MAIN_DECK_TOP + 8 && by <= MAIN_DECK_TOP + 80) {
    if (bot.onGround) jump = true
    if (!mem.rechargingFuel) jetpack = true
    return { move, jump, jetpack, dive }
  }

  // 飞越中央三道竖井口（x=6000..6180, 6460..6740, 7020..7200）及脚下空隙
  const nearCenterShaftGap =
    (bx > 5930 && bx < 6220) ||
    (bx > 6400 && bx < 6790) ||
    (bx > 6970 && bx < 7250)
  const floorGapAhead = supported && !world.terrain.isSolidAt(bx + move * 42, by + 24)
  if (nearCenterShaftGap || floorGapAhead) {
    if (bot.onGround) jump = true
    if (!mem.rechargingFuel) jetpack = true
  }

  // 前方矮挡板或可破坏掩体翻越
  const wallAhead = world.terrain.isSolidAt(bx + move * 32, by - 10)
  const obsAhead = findObstacleAt(world.obstacles, world.obstacleBroadBuckets, bx + move * 34, by - 12) !== null
  if (wallAhead || obsAhead) {
    if (bot.onGround) jump = true
    if (!mem.rechargingFuel && hasOpenShaftAbove(bx, by)) jetpack = true
  }

  return { move, jump, jetpack, dive }
}

export function botInput(bot: PlayerState): WorldInput {
  const w = defaultWorldInput()
  if (!bot.deployed || !bot.alive || bot.respawnTimer > 0) return w

  const mem = getBotMemory(bot)
  updateBotSelectedSpawn(bot, mem)

  // 1. 严格按固定巡逻路线计算移动指令（绝不因隔墙追踪敌人而偏离巡逻路线）
  const nav = computePatrolNavigation(bot, mem)
  w.move = nav.move
  w.jump = nav.jump
  w.jetpack = nav.jetpack
  w.dive = nav.dive

  // 2. 巡逻途中扫描直接视线（LOS）内的敌人进行射击与技能释放
  const target = pickBotTarget(bot)
  const wep = WEAPONS[bot.weaponIndex] ?? WEAPONS[1]

  const curAmmo = bot.ammo[bot.weaponIndex] ?? 0
  const curReserve = bot.reserveAmmo[bot.weaponIndex] ?? 0
  if (curAmmo <= 0 && curReserve > 0 && !bot.reloading) {
    w.reload = true
  }

  const bx = bot.pos.x
  const by = bot.pos.y - 12
  const tx = target ? target.pos.x : bx + mem.patrolDir * 400
  const ty = target ? target.pos.y - 12 : by
  const rawDx = tx - bx
  const rawDy = ty - by
  const dist = target ? Math.hypot(rawDx, rawDy) : 9999
  const hasLOS = !!target && dist < 1650 && hasLineOfSight(bx, by, tx, ty)

  // ── 瞄准朝向：有直接视线时精准预判瞄准敌人；无视线时朝当前巡逻方向看 ──
  if (hasLOS && target) {
    const projSpeed = Math.max(600, wep.speed || 1200)
    const travelTime = Math.min(0.45, dist / projSpeed)
    const leadX = wep.beam ? tx : tx + target.vel.x * travelTime * 0.65
    const leadY = wep.beam ? ty : ty + target.vel.y * travelTime * 0.45 - (wep.gravityScale ? 0.5 * 1250 * wep.gravityScale * travelTime * travelTime * 18 : 0)
    const jitter = Math.sin(world.tick * 0.19 + bot.id * 2.3) * 0.018
    w.aim = Math.atan2(leadY - by, leadX - bx) + jitter
  } else {
    const lookDir = nav.move !== 0 ? nav.move : mem.patrolDir
    const pitch = nav.jetpack ? -0.42 : nav.dive ? 0.55 : -0.06
    w.aim = lookDir > 0 ? pitch : Math.PI - pitch
  }

  const muzzleBlocked = isMuzzleBlockedNear(bot, w.aim, wep.explosive ? 110 : 64)

  if (!hasLOS && curAmmo < wep.magSize * 0.4 && curReserve > 0 && !bot.reloading) {
    w.reload = true
  }

  // ── 严格视线开火控制 ──
  const maxEffectiveRange = wep.id === 0 ? 620 : wep.id === 6 ? 560 : wep.id === 8 ? 780 : 1350
  const minSafeRange = wep.explosive ? 130 : 0

  if (hasLOS && !muzzleBlocked && dist >= minSafeRange && dist <= maxEffectiveRange && curAmmo > 0) {
    if ((wep.chargeSeconds ?? 0) > 0) {
      if (bot.chargeTimer <= 0 && bot.fireCooldown <= 0) {
        w.fire = !mem.sniperReleaseTick
        mem.sniperReleaseTick = !mem.sniperReleaseTick
      } else {
        w.fire = true
      }
    } else if (wep.beam) {
      w.fire = true
    } else {
      w.fire = (world.tick + bot.id * 3) % 10 < 7
    }
  } else {
    w.fire = false
    mem.sniperReleaseTick = false
  }

  // ── 交战自动找掩体逻辑：当发现敌人且正在换弹、开火冷却、残血或附近有掩体时，自动移动至掩体背弹侧 ──
  if (!mem.manualRouteLocked && target && dist < 1250 && (hasLOS || Math.abs(rawDy) < 160)) {
    const cover = findNearestCoverPosition(bot, target)
    const needCoverHide = bot.reloading || bot.hp < 75 || bot.fireCooldown > 0.16 || curAmmo <= 0
    if (cover && (needCoverHide || Math.abs(cover.x - bx) < 220)) {
      const dxCover = cover.x - bx
      if (Math.abs(dxCover) > 14) {
        w.move = dxCover > 0 ? 1 : -1
      } else if (needCoverHide) {
        w.move = 0
        w.jump = false
        w.jetpack = false
      }
    }
  }

  // ── 副手技能智能释放（连死后不自动换副手；若因杀人失效则统一退回手榴弹） ──
  const streak = bot.deathStreak ?? 0
  if (!isSecondaryUnlocked(bot.secondary, streak, bot.dollCharges ?? 0, bot.weaponIndex)) {
    bot.secondary = 'frag'
  }
  if (bot.secondaryCooldown <= 0 && (world.tick + bot.id * 7) % 15 === 0) {
    const secId = bot.secondary
    if (isSecondaryUnlocked(secId, streak, bot.dollCharges, bot.weaponIndex)) {
      if (secId === 'shield' && hasLOS && dist < 680 && (bot.hp < 95 || dist < 420)) {
        w.secondary = { type: 'shield', targetX: bx, targetY: by }
      } else if (secId === 'frag' && bot.fragCharges > 0 && hasLOS && dist > 180 && dist < 620 && !muzzleBlocked) {
        w.secondary = { type: 'frag', targetX: tx, targetY: ty }
      } else if (secId === 'obstacle' && bot.onGround && hasLOS && dist > 200 && dist < 650 && Math.abs(rawDy) < 140) {
        w.secondary = { type: 'obstacle', targetX: bx + (rawDx >= 0 ? 80 : -80), targetY: bot.pos.y }
      } else if (secId === 'doll' && bot.doll === null && hasLOS && dist < 560) {
        w.secondary = { type: 'doll', targetX: bx, targetY: bot.pos.y }
      }
    }
  }

  return w
}
