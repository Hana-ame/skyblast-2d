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
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 160   // 模拟 tick 后移动 60px
  buildPositionOverlay('p', ents, 0)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 100, 'alpha=0 应返回上一 tick 位置')
  buildPositionOverlay('p', ents, 1)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 160, 'alpha=1 应返回当前 tick 位置')
  buildPositionOverlay('p', ents, 0.5)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 130, 'alpha=0.5 应为中点')
})

test('插值：连续捕获玩家与弹丸不会互相清空（曾经的 bug）', () => {
  clearInterp()
  const players = [mk(1, 10, 10)]
  const projectiles = [mk(100, 500, 500)]
  // 分两次捕获，模拟 loop 里的调用顺序
  capturePrevPositions('p', players)
  capturePrevPositions('p', projectiles)
  prunePrevPositions()

  players[0].pos.x = 20
  projectiles[0].pos.x = 600
  beginOverlayFrame()
  buildPositionOverlay('p', players, 0.5)
  buildPositionOverlay('p', projectiles, 0.5)

  // 两类都应各有插值覆盖；若 capture 内部做了 clear()，先捕获的那类会丢失
  assert.ok(hasRenderPos('p', 1), '玩家必须有插值基准')
  assert.ok(hasRenderPos('p', 100), '弹丸必须有插值基准')
  assert.equal(getRenderPos('p', 1, 0, 0).x, 15)
  assert.equal(getRenderPos('p', 100, 0, 0).x, 550)
})

test('插值：传送（位移 >400px）不插值，避免穿墙滑行', () => {
  clearInterp()
  const ents = [mk(1, 100, 100)]
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 5000   // 瞬移
  buildPositionOverlay('p', ents, 0.5)
  assert.equal(hasRenderPos('p', 1), false, '大幅位移不应产生插值覆盖')
  // 回退到真实位置
  assert.equal(getRenderPos('p', 1, ents[0].pos.x, ents[0].pos.y).x, 5000)
})

test('插值：消失的实体通过 prune 清理，不无限增长', () => {
  clearInterp()
  for (let i = 0; i < 50; i++) capturePrevPositions('p', [mk(i, i, i)])
  prunePrevPositions()
  // 下一帧只剩 1 个实体
  capturePrevPositions('p', [mk(999, 0, 0)])
  prunePrevPositions()
  const ents = [mk(999, 10, 10)]
  buildPositionOverlay('p', ents, 0.5)
  assert.ok(hasRenderPos('p', 999), '新实体应有基准')
  assert.equal(hasRenderPos('p', 0), false, '已消失的实体不应再有基准')
})

test('插值：alpha 超出 0..1 会被夹紧', () => {
  clearInterp()
  const ents = [mk(1, 0, 0)]
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 100
  buildPositionOverlay('p', ents, -5)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 0, '负 alpha 夹到 0')
  buildPositionOverlay('p', ents, 5)
  assert.equal(getRenderPos('p', 1, 0, 0).x, 100, '大于 1 的 alpha 夹到 1')
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
      capturePrevPositions('p', list)
      prunePrevPositions()
    }
    while (acc >= FIXED) {
      ent.pos.x += speed * FIXED     // 模拟 world.step 推进
      acc -= FIXED
    }
    const alpha = Math.max(0, Math.min(1, acc / FIXED))
    beginOverlayFrame()
    buildPositionOverlay('p', list, alpha)
    rendered.push(getRenderPos('p', 7, ent.pos.x, ent.pos.y).x)
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

test('插值：不同实体类别的相同 id 不互相覆盖（id 空间冲突 bug）', () => {
  // 实测发现：玩家 id 1..8，弹丸 id 也从 1 开始，且弹丸销毁后 id 会被复用。
  // 若插值只用数字 id 做 key，玩家 id=1 与弹丸 id=1 会互相覆盖位置，
  // 导致弹丸画到玩家身上、或玩家被拉到弹丸位置 —— 画面直接错乱。
  clearInterp()
  const player = { id: 1, pos: { x: 100, y: 100 } }
  const proj = { id: 1, pos: { x: 900, y: 900 } }   // 同 id，不同类别
  const players = [player]
  const projectiles = [proj]

  capturePrevPositions('p', players)
  capturePrevPositions('pr', projectiles)
  prunePrevPositions()

  player.pos.x = 110; player.pos.y = 110
  proj.pos.x = 950; proj.pos.y = 950

  beginOverlayFrame()
  buildPositionOverlay('p', players, 0.5)
  buildPositionOverlay('pr', projectiles, 0.5)

  // 两类各自的插值必须独立正确
  assert.equal(getRenderPos('p', 1, 0, 0).x, 105, '玩家插值应为 105，不能被弹丸污染')
  assert.equal(getRenderPos('pr', 1, 0, 0).x, 925, '弹丸插值应为 925，不能被玩家污染')

  // 交叉读取不应该拿到对方的覆盖（同 id 但不同 kind）
  assert.equal(hasRenderPos('g', 1), false, '未捕获的类别不应有覆盖')
})

test('插值：弹丸 id 复用时不会沿用旧位置（类别前缀 + 覆盖语义）', () => {
  clearInterp()
  // 第一颗弹丸 id=5
  const p1 = { id: 5, pos: { x: 0, y: 0 } }
  capturePrevPositions('pr', [p1])
  prunePrevPositions()
  p1.pos.x = 60
  beginOverlayFrame()
  buildPositionOverlay('pr', [p1], 0.5)
  assert.equal(getRenderPos('pr', 5, 0, 0).x, 30)

  // 弹丸销毁、id=5 被复用为一颗完全不同的弹丸（在远处生成）
  const p2 = { id: 5, pos: { x: 5000, y: 5000 } }
  capturePrevPositions('pr', [p2])
  prunePrevPositions()
  beginOverlayFrame()
  buildPositionOverlay('pr', [p2], 0.5)
  // 新弹丸的 prev 就是它自己的出生位置，插值结果应在 5000 附近而不是 30
  const got = getRenderPos('pr', 5, 0, 0).x
  assert.ok(got > 4000, `id 复用的新弹丸不应继承旧位置，实际 ${got}`)
})

import { createBinaryCodecSession, encodeServerMsgBinary, decodeServerMsgBinary } from '../src/net/protocol/BinaryCodec.ts'
import { World } from '../src/core/sim/world.ts'

test('插值：环形世界跨接缝（13190 -> 10 / 4390 -> 10）平滑插值不丢帧', () => {
  clearInterp()
  const ents = [mk(1, 13190, 4390)]
  capturePrevPositions('p', ents)
  prunePrevPositions()
  ents[0].pos.x = 10
  ents[0].pos.y = 10
  beginOverlayFrame()
  buildPositionOverlay('p', ents, 0.5)
  assert.equal(hasRenderPos('p', 1), true, '跨接缝 20px 移动必须正常插值而非误判为瞬移')
  const pos = getRenderPos('p', 1, ents[0].pos.x, ents[0].pos.y)
  assert.ok(pos.x === 0 || pos.x === 13200, `X 跨缝中点应为 0，实际 ${pos.x}`)
  assert.ok(pos.y === 0 || pos.y === 4400, `Y 跨缝中点应为 0，实际 ${pos.y}`)
})

test('BinaryCodecSession：多客户端 AOI 独立编码会话互不污染设施与姓名增量状态', () => {
  const w = new World(42)
  const p = w.addPlayer('AcePilot', 'red')
  w.step(1 / 60, new Map()) // tick = 1 (非 60 整倍帧，检验增量姓名与设施编码)
  const snap = w.snapshot()
  const sessionA = createBinaryCodecSession()
  const sessionB = createBinaryCodecSession()

  // 先对客户端 A 编码一次（消耗客户端 A 的首次全量设施与姓名下发）
  const bytesA1 = encodeServerMsgBinary({ snap, events: [] }, { deltaFacilities: true, session: sessionA })
  assert.ok(bytesA1.byteLength > 0)

  // 再对从未收到过快照的客户端 B 编码同一帧，客户端 B 必须仍能完整解码出玩家姓名与设施列表
  const bytesB1 = encodeServerMsgBinary({ snap, events: [] }, { deltaFacilities: true, session: sessionB })
  const decSessionB = createBinaryCodecSession()
  const decodedB = decodeServerMsgBinary(bytesB1, decSessionB)
  assert.ok(decodedB && decodedB.snap, '客户端 B 应成功解码快照')
  const dp = decodedB!.snap.players.find(x => x.id === p.id)
  assert.ok(dp, '客户端 B 应解码出玩家')
  assert.equal(dp!.name, 'AcePilot', '客户端 B 首次收到快照必须包含完整玩家名而非被客户端 A 增量抑制')
  assert.equal(decodedB!.snap.capturePoints.length, snap.capturePoints.length, '客户端 B 首次收到快照必须包含全部占领点')
  assert.equal(decodedB!.snap.obstacles.length, snap.obstacles.length, '客户端 B 首次收到快照必须包含全部障碍物')
})

test('World：obstacleBroadBuckets 脏标记在掩体增删与受损销毁时即时同步更新', () => {
  const w = new World(99)
  // Obstacle 要求 id 为 string 且必须带 color/borderColor/label。
  // 注意：上游 zip 多次回退成 `{ id: 7777, ... }`（数字 id、缺三字段）导致 tsc 失败，
  // 合并后需重新补全，勿再退回该写法。
  const ob = {
    id: '7777', x: 2000, y: 1200, w: 80, h: 80, hp: 240, maxHp: 240,
    color: '#334155', borderColor: '#38bdf8', label: 'test-obstacle',
  }
  w.obstacles.push(ob)
  w.step(1 / 60, new Map())
  assert.equal(w.bodyOverlapsAt(2040, 1240), true, '新增掩体后空间桶应自动感知并阻挡身体')
  w.damageObstacle(ob, 999)
  assert.equal(w.bodyOverlapsAt(2040, 1240), false, '摧毁后空间桶应立即移除该掩体')
})

import { StateSync } from '../src/net/StateSync.ts'
import { ServerSim } from '../src/net/ServerSim.ts'
import { ClientSession } from '../src/net/ClientSession.ts'
import { InputMapper } from '../src/input/InputMapper.ts'
import { predictLocalPlayerStep } from '../src/core/sim/playerPhysics.ts'
import { defaultWorldInput } from '../src/core/types.ts'

test('StateSync：动态插值周期（20Hz/30Hz 步幅下 interval 自动匹配 tick 差）且未完成插值时收到新快照平滑衔接不回跳', () => {
  const w = new World(701)
  w.config.randomSpawn = false
  const remote = w.addPlayer('RemoteRunner', 'blue')
  remote.pos = { x: 1000, y: 2740 }
  const sync = new StateSync(w.terrain, 999)

  // snap1 @ tick=10, x=1000
  w.tick = 10
  sync.push(w.snapshot(), 999)

  // snap2 @ tick=13 (3 ticks 步幅 = 20Hz), x=1030
  w.tick = 13
  remote.pos.x = 1030
  sync.push(w.snapshot(), 999)

  assert.ok(Math.abs(sync.getSnapshotInterval() - 3 / 60) < 1e-6, '3-tick 步幅应自动推导出 3/60s 插值周期')

  // 推进 1 个物理帧 (1/60s)：如果是旧版写死 1/60s，此时就已经跳到 1030 并在后续 2 帧停滞；
  // 修复后应平滑处在 1/3 进度 (x ≈ 1010)
  sync.advance(1 / 60)
  const p1 = sync.interpolated()!.players.find(p => p.id === remote.id)!
  assert.ok(Math.abs(p1.pos.x - 1010) < 0.5, `第 1 帧应平滑插值至 1010，实测 ${p1.pos.x.toFixed(2)}`)

  // 在 t=1/3 尚未走完时提前收到 snap3 @ tick=16, x=1060：
  // 新的起点 prev 必须无缝衔接当前视觉位置 1010，而不是跳变到 1030！
  w.tick = 16
  remote.pos.x = 1060
  sync.push(w.snapshot(), 999)
  const pAfterPush = sync.interpolated()!.players.find(p => p.id === remote.id)!
  assert.ok(Math.abs(pAfterPush.pos.x - 1010) < 0.5, `提前收到新快照时视觉位置必须保持连续 (1010)，不能瞬间跳到 1030，实测 ${pAfterPush.pos.x.toFixed(2)}`)
})

test('ServerSim 输入队列：网络抖动导致多包同 tick 到达时按队列逐帧消费，消除客户端回滚橡皮筋抖动', () => {
  const w = new World(702, { name: 'burst-queue', solids: [] })
  w.config.randomSpawn = false
  w.terrain.grid.fill(0)
  const p = w.addPlayer('ClientA', 'red')
  p.pos = { x: 2000, y: 2000 }
  const server = new ServerSim(w)

  const burstQueue: (() => void)[] = []
  let onServerCb: ((m: any) => void) | null = null
  let onClientCb: ((m: any) => void) | null = null

  const clientTransport = {
    send(m: any) { burstQueue.push(() => onClientCb?.(m)) },
    onServer(cb: (m: any) => void) { onServerCb = cb },
  }
  const serverTransport = {
    send(m: any) { onServerCb?.(m) },
    onClient(cb: (m: any) => void) { onClientCb = cb },
  }

  server.accept(p.id, serverTransport)
  const sync = new StateSync(w.terrain, p.id)
  const session = new ClientSession(clientTransport, p.id, sync)
  const mapper = new InputMapper()

  // 初始同步
  server.step(1 / 60)

  // 客户端连续发送 3 帧右移，但由于网络抖动，这 3 个包在同一个时刻扎堆到达服务器
  for (let i = 0; i < 3; i++) {
    session.sendIntents(mapper.map({ moveX: 1, aimAngle: 0, fire: false, jump: false, jetpack: false, reload: false }), 1 / 60)
  }
  while (burstQueue.length > 0) burstQueue.shift()!()

  // 服务器仅推进第 1 个 tick：应当只消费 seq=1（lastAckSeq=1），保留 seq=2,3 在队列中，
  // 从而让客户端重放 seq=2,3 后与客户端预测位置完全一致（0 抖动）！
  server.step(1 / 60)
  assert.equal(session.lastAckSeq, 1, '服务器第 1 个 tick 仅确认消费 seq=1，不吞掉同批到达的 seq=2,3')
  assert.equal(session.pendingInputs.length, 2, '客户端保留 seq=2,3 待重放')
  assert.equal(sync.reconcileOffset.x, 0, '回滚重放与预测完全吻合，产生 0 纠错偏移')

  // 服务器继续推进第 2、第 3 个 tick，依次消费 seq=2 和 seq=3
  server.step(1 / 60)
  assert.equal(session.lastAckSeq, 2)
  server.step(1 / 60)
  assert.equal(session.lastAckSeq, 3)
  assert.equal(session.pendingInputs.length, 0)
  assert.equal(sync.reconcileOffset.x, 0)
})

test('predictLocalPlayerStep 物理对齐：狙击蓄力后坐力、引力弹牵引、切枪移速与玩家碰撞与权威 World 一致', () => {
  const w = new World(703, { name: 'predict-parity', solids: [] })
  w.config.randomSpawn = false
  w.terrain.grid.fill(0)
  const p = w.addPlayer('SniperP', 'red')
  p.weaponIndex = 2 // 狙击枪（0.5s 蓄力 + 后坐力）
  p.ammo[2] = 5
  p.pos = { x: 3000, y: 2000 }
  p.vel = { x: 0, y: 0 }

  // 克隆一份给客户端预测独立运行
  const predP = JSON.parse(JSON.stringify(p))

  for (let i = 0; i < 35; i++) {
    const inp = { ...defaultWorldInput(), fire: i === 0, aim: 0 }
    w.step(1 / 60, new Map([[p.id, { ...inp }]]))
    w.drainEvents()
    predictLocalPlayerStep(predP, { ...inp }, 1 / 60, w.terrain, w.obstacles, w.mortars, w.watchtowers)
  }

  // 30 帧蓄力满后狙击枪自动击发并产生后坐力位移，客户端预测位置应与服务端权威位置严格一致
  assert.ok(Math.abs(predP.pos.x - p.pos.x) < 0.01 && Math.abs(predP.pos.y - p.pos.y) < 0.01,
    `蓄力狙击击发后客户端预测坐标 (${predP.pos.x.toFixed(2)},${predP.pos.y.toFixed(2)}) 必须与服务端 (${p.pos.x.toFixed(2)},${p.pos.y.toFixed(2)}) 完全一致`)
})
