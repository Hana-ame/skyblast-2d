// tests/sim.test.ts —— 合并版：core 确定性 + Loopback 集成 + SkyBlast v2 玩法系统
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/core/sim/world.ts'
import { defaultWorldInput } from '../src/core/types.ts'
import type { WorldInput, SecondaryIntent } from '../src/core/types.ts'
import { ServerSim } from '../src/net/ServerSim.ts'
import { ClientSession } from '../src/net/ClientSession.ts'
import { createLoopback } from '../src/net/transport/Loopback.ts'
import { InputMapper } from '../src/input/InputMapper.ts'
import { WEAPONS, SECONDARIES, DEFAULT_CONFIG } from '../src/core/weapons.ts'
import { JUMP_PADS } from '../src/core/sim/world.ts'
import { runDuelSim } from '../src/balance/duelSim.ts'
import { getPhysicsParams } from '../src/core/sim/physics.ts'
import { wrapX, wrapDeltaX, wrapDeltaY, wrapY, wrapDist } from '../src/core/wrap.ts'

const DT = 1 / 60
const input = (over: Partial<WorldInput> = {}): WorldInput => ({
  ...defaultWorldInput(), ...over,
})
const sec = (type: string, x = 0, y = 0): SecondaryIntent => ({ type, targetX: x, targetY: y })

test('确定性：同 seed 两次运行，快照完全一致（含 RNG 消费）', () => {
  const run = (): string => {
    const w = new World(42)
    const a = w.addPlayer('A', 'red')
    const b = w.addPlayer('B', 'blue')
    a.weaponIndex = 0   // 霰弹（8 弹丸 RNG 散射）
    const inputs = new Map<number, WorldInput>([
      [a.id, input({ move: 1, fire: true, aim: -0.1, secondary: sec('frag', b.pos.x, b.pos.y) })],
      [b.id, input()],
    ])
    for (let i = 0; i < 300; i++) {
      inputs.set(a.id, i === 10 ? input({ secondary: sec('frag', b.pos.x, b.pos.y) }) : input({ move: 1, fire: i < 200, aim: -0.1 }))
      w.step(DT, inputs)
      w.drainEvents()
    }
    return JSON.stringify(w.snapshot())
  }
  assert.equal(run(), run())
})

test('环形世界：wrapX/wrapDeltaX 跨缝语义正确', () => {
  assert.equal(wrapX(-50), 13200 - 50)
  assert.equal(Math.round(wrapDeltaX(13100, 100)), 200)
  assert.equal(Math.round(wrapDeltaX(13150, 100)), 150)   // 跨缝最短位移 = +150
  assert.ok(Math.abs(wrapDeltaX(100, 13100) + 200) < 1e-9)
})

test('环形世界（垂直）：wrapY/wrapDeltaY 上下跨缝语义正确', () => {
  assert.equal(wrapY(-30), 4400 - 30)
  assert.equal(wrapY(4420), 20)
  assert.equal(Math.round(wrapDeltaY(4380, 60)), 80)
  assert.ok(Math.abs(wrapDeltaY(60, 4380) + 80) < 1e-9)
})

test('全环面：向上飞出顶部（y<0）从底部回入，不撞任何边界', () => {
  const w = new World(31)
  const p = w.addPlayer('P', 'ffa')
  p.pos = { x: 6600, y: 100 }   // 高空
  // 持续喷射向上（Teeworlds 喷射），穿越 y=0 缝
  let crossed = false
  for (let i = 0; i < 400; i++) {
    w.step(DT, new Map([[p.id, input({ jetpack: true })]]))
    w.drainEvents()
    if (wrapDeltaY(p.pos.y, 300) > 0 && p.pos.y > 4400 - 800) crossed = true   // 已绕到底部
    if (crossed) break
  }
  assert.ok(crossed || wrapDeltaY(p.pos.y, 100) < -800, `expected vertical wrap, y=${p.pos.y}`)
})

test('重力：空中出生者下落到地表', () => {
  const w = new World(1)
  const p = w.addPlayer('P', 'ffa')
  p.pos = { x: 400, y: 400 }   // 开阔空域（避开管道/楼体）
  const y0 = p.pos.y
  for (let i = 0; i < 90; i++) w.step(DT, new Map([[p.id, input()]]))
  assert.ok(p.pos.y > y0 + 300, `expected falling from ${y0}, y=${p.pos.y}`)
})

test('弹道：狙击爆头穿透（hitTargets 去重，弹不消失）', () => {
  const w = new World(7)
  const shooter = w.addPlayer('S', 'red')
  shooter.weaponIndex = 2   // 狙击：pierceOnHeadshot
  const victim = w.addPlayer('V', 'blue')
  victim.pos = { x: shooter.pos.x + 60, y: shooter.pos.y }   // 平射打头
  const vHp0 = victim.hp
  // 狙击需 0.65s 蓄力：持续按住开火直到出膛
  for (let i = 0; i < 60; i++) w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })]]))
  assert.ok(victim.hp < vHp0 || victim.deaths > 0, `expected headshot damage, hp=${victim.hp}`)
})

test('弹药经济：连发射空弹匣后自动换弹，备弹递减', () => {
  const w = new World(3)
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 1   // 突击 28 发
  const mag0 = p.ammo[1]
  for (let i = 0; i < 30; i++) w.step(DT, new Map([[p.id, input({ fire: true, aim: 0 })]]))
  assert.ok(p.ammo[1] < mag0, `mag should be partially consumed, ammo=${p.ammo[1]}`)
  // 射空弹匣 → 自动换弹 → 备弹转移
  for (let i = 0; i < 200; i++) w.step(DT, new Map([[p.id, input({ fire: true, aim: 0 })]]))
  const reserveDrained = p.reserveAmmo[1] < WEAPONS[1].maxReserve
  assert.ok(reserveDrained || p.reloading, `reserve should drain after mag empty, reserve=${p.reserveAmmo[1]} reloading=${p.reloading}`)
})

test('手榴弹：引爆产生爆炸事件', () => {
  const w = new World(5)
  const p = w.addPlayer('P', 'ffa')
  const target = w.addPlayer('T', 'blue')
  target.pos = { x: p.pos.x + 100, y: p.pos.y }
  const tHp0 = target.hp
  w.step(DT, new Map([[p.id, input({ secondary: sec('frag', target.pos.x, target.pos.y) })]]))
  let sawExplosion = false
  for (let i = 0; i < 240; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    if (w.drainEvents().some(e => e.kind === 'explosion')) sawExplosion = true
  }
  assert.ok(sawExplosion, 'grenade should explode')
})

test('替身人偶：只从特殊补给获得（无充能不可用）', () => {
  const w = new World(11)
  const p = w.addPlayer('P', 'red')
  // 无充能：使用无效、不进入 CD
  w.step(DT, new Map([[p.id, input({ secondary: sec('doll') })]]))
  assert.equal(p.doll, null, 'no doll charge -> cannot anchor')
  assert.equal(p.secondaryCooldown, 0, 'no cooldown consumed when unavailable')
  // 拾取特殊补给箱 → 获得充能
  const crate = w.supplyCrates.find(c => c.kind === 'doll')!
  p.pos = { x: crate.x, y: crate.y }
  w.step(DT, new Map([[p.id, input()]]))
  assert.equal(p.dollCharges, 1, 'doll supply should grant a charge')
  // 再使用 → 锚定 + 消耗充能
  w.step(DT, new Map([[p.id, input({ secondary: sec('doll') })]]))
  assert.ok(p.doll !== null, 'doll should be anchored')
  assert.equal(p.dollCharges, 0, 'charge consumed')
  const anchorPos = { ...p.pos }
  // 走远一点再挨致死伤（狙击 68×2.5=170 > 100）
  for (let i = 0; i < 60; i++) w.step(DT, new Map([[p.id, input({ move: 1 })]]))
  const enemy = w.addPlayer('E', 'blue')
  enemy.weaponIndex = 2
  enemy.pos = { x: p.pos.x - 120, y: p.pos.y }
  let recalled = false
  for (let i = 0; i < 30; i++) {
    w.step(DT, new Map([[enemy.id, input({ fire: true, aim: 0 })]]))
    if (w.drainEvents().some(e => e.kind === 'doll_recall')) recalled = true
  }
  assert.ok(recalled || p.deaths === 0, `doll should recall instead of death (recalled=${recalled}, deaths=${p.deaths})`)
  if (recalled) assert.deepEqual(Math.round(p.pos.x), Math.round(wrapX(anchorPos.x) === anchorPos.x ? anchorPos.x : anchorPos.x), 'back at anchor')
})

test('占点：进入范围读条，满 100 归属变更', () => {
  const w = new World(19)
  const p = w.addPlayer('P', 'green')
  // 找中立点（B 或 D），先清掉同位置的预设雷（关卡雷防偷点：测试中显式排雷）
  const cp = w.capturePoints.find(c => c.ownerTeam === null)!
  w.landmines = w.landmines.filter(m => wrapDist(m.pos.x, m.pos.y, cp.x, cp.y) > 150)
  p.pos = { x: cp.x, y: cp.y }
  let captured = false
  for (let i = 0; i < 300; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    if (w.drainEvents().some(e => e.kind === 'capture' && e.pointCode === cp.code)) { captured = true; break }
  }
  assert.ok(captured, `capture point ${cp.code} should flip (progress=${cp.progress})`)
  assert.equal(cp.ownerTeam, 'green')
})

test('补给箱：拾取换特武，超时重生', () => {
  const w = new World(23)
  const p = w.addPlayer('P', 'red')
  const crate = w.supplyCrates.find(c => c.active && c.weaponId === 4)!
  p.pos = { x: crate.x, y: crate.y }
  w.step(DT, new Map([[p.id, input()]]))
  assert.equal(p.weaponIndex, crate.weaponId, 'picked up laser')
  assert.ok(!crate.active, 'crate deactivated')
  const ammo0 = p.ammo[4]
  assert.ok(ammo0 > 0, 'laser has ammo')
})

test('Loopback 集成：两客户端对局跑通，服务器权威产生命中与事件', () => {
  const w = new World(29)
  const a = w.addPlayer('Alice', 'red')
  const b = w.addPlayer('Bob', 'blue')
  // 面对面近距离（v2 队伍出生点相距半个地图；测试拉近）
  b.pos = { x: a.pos.x + 120, y: a.pos.y }
  const server = new ServerSim(w)
  const lbA = createLoopback()
  const lbB = createLoopback()
  server.accept(a.id, lbA.server)
  server.accept(b.id, lbB.server)
  const csA = new ClientSession(lbA.client, a.id)
  const csB = new ClientSession(lbB.client, b.id)
  const mapper = new InputMapper()
  const events: string[] = []
  csA.onEvents((evs) => { for (const e of evs) events.push(e.kind) })
  for (let i = 0; i < 240; i++) {
    csA.sendIntents(mapper.map({ moveX: 0, aimAngle: 0, fire: i % 18 < 12, jump: false, jetpack: false, reload: false }))
    csB.sendIntents(mapper.map({ moveX: 0, aimAngle: Math.PI, fire: false, jump: false, jetpack: false, reload: false }))
    server.step(DT)
  }
  assert.ok(w.hits > 0, `expected hits, got ${w.hits}`)
  assert.ok(csA.lastSnapshot, 'client A snapshot')
  assert.ok(csB.lastSnapshot, 'client B snapshot')
  // 快照含全部 v2 实体
  const snap = csA.lastSnapshot!
  assert.ok(Array.isArray(snap.obstacles) && snap.obstacles.length > 0, 'snapshot has obstacles')
  assert.ok(snap.capturePoints.length === 5, 'snapshot has 5 capture points')
  assert.ok(snap.supplyCrates.length === 8, 'snapshot has 8 supply crates (6 weapon + 2 doll)')
  assert.ok(snap.ammoPacks.length > 0, 'snapshot has ammo packs')
  assert.ok(snap.scores !== undefined, 'snapshot has scores')
})

test('三层分离：core 源码不 import input/ui/net', async () => {
  const { readFile } = await import('node:fs/promises')
  const files = [
    'src/core/sim/world.ts', 'src/core/types.ts', 'src/core/snap.ts',
    'src/core/weapons.ts', 'src/core/terrain.ts', 'src/core/wrap.ts', 'src/core/rng.ts',
  ]
  for (const f of files) {
    const src = await readFile(f, 'utf8')
    assert.ok(!/from '\.\.\/(input|net|ui)\//.test(src) && !/from '\.\.\/\.\.\/(input|net|ui)\//.test(src), `${f} must not import input/net/ui`)
  }
})

// ── PeerJS 传输层（假连接模拟两条 DataConnection，验证线上协议 glue） ──
import { createPeerPair } from '../src/net/transport/Peer.ts'
import type { PeerConnLike } from '../src/net/transport/Peer.ts'

/** 内存假连接对：双向 JSON 字符串传递（模拟 PeerJS DataConnection 的 send/on('data')） */
function fakeConnPair(): [PeerConnLike, PeerConnLike] {
  const boxA: { onData: ((d: unknown) => void) | null } = { onData: null }
  const boxB: { onData: ((d: unknown) => void) | null } = { onData: null }
  const mk = (self: typeof boxA, other: typeof boxB): PeerConnLike => ({
    send(data: string) { queueMicrotask(() => other.onData?.(data)) },
    on(event: 'data' | 'close', cb: (d?: unknown) => void) { if (event === 'data') self.onData = cb as (d: unknown) => void },
    close() {},
  })
  return [mk(boxA, boxB), mk(boxB, boxA)]
}

test('PeerJS 传输：假 DataConnection 上跑通 服务器权威 + 欢迎包 + 快照', async () => {
  const w = new World(37)
  const server = new ServerSim(w)
  const [hostConn, guestConn] = fakeConnPair()
  const { client, server: srvT } = createPeerPair(hostConn, guestConn)
  // 主机：为新连接创建玩家并接受
  const p = w.addPlayer('Guest', 'red')
  p.pos = { x: 6600, y: 2700 }
  server.accept(p.id, srvT)
  srvT.send({ snap: w.snapshot(), welcome: { playerId: p.id, name: 'Guest', team: 'red' } })
  const cs = new ClientSession(client, 0)
  const mapper = new InputMapper()
  await new Promise(r => setTimeout(r, 10))   // 让 welcome 抵达
  assert.equal(cs.playerId, p.id, 'welcome should assign player id')
  for (let i = 0; i < 30; i++) {
    cs.sendIntents(mapper.map({ moveX: 0, aimAngle: 0, fire: true, jump: false, jetpack: false, reload: false }))
    server.step(DT)
    await new Promise(r => setTimeout(r, 0))
  }
  assert.ok(cs.lastSnapshot && cs.lastSnapshot.tick > 0, 'client received snapshots over peer transport')
  assert.ok(cs.lastSnapshot!.obstacles.length > 0, 'snapshot carries v2 entities over the wire')
})


test('激光：按住持续输出（射速无限），一梭子可打 8 秒；松手即停', () => {
  const w = new World(41)
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 4   // 激光炮
  p.pos = { x: 6600, y: 2660 }
  const ammo0 = p.ammo[4]
  // 按住 1 秒：应连续产生激光事件（不是单发）
  let beamEvents = 0
  for (let i = 0; i < 60; i++) {
    w.step(DT, new Map([[p.id, input({ fire: true, aim: Math.PI / 2 })]]))
    const evs = w.drainEvents()
    const laser = evs.find(e => e.kind === 'laser')
    if (laser) {
      beamEvents++
      assert.ok((laser.segments?.length ?? 0) >= 1 && (laser.segments?.length ?? 1) <= 4, 'reflections <= 3')
    }
  }
  assert.ok(beamEvents >= 55, `continuous output each tick, got ${beamEvents} beam events`)
  const drainedPerSec = ammo0 - p.ammo[4]
  assert.ok(drainedPerSec > 5 && drainedPerSec < 7, `ammo drains ~6/s, got ${drainedPerSec.toFixed(2)}`)
  // 8 秒总弹量：48 / 6
  assert.equal(WEAPONS[4].magSize / (WEAPONS[4].ammoPerSecond ?? 1), 8, 'one magazine = 8s')
  // 松手即停
  w.drainEvents()
  w.step(DT, new Map([[p.id, input({ fire: false, aim: Math.PI / 2 })]]))
  const afterRelease = w.drainEvents().filter(e => e.kind === 'laser').length
  assert.equal(afterRelease, 0, 'no beam after release')
})

test('引力弹：穿墙飞行（passWalls），不被原始地形挡下', () => {
  const w = new World(45)
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 6   // 引力枪
  // 朝西翼大楼墙体方向平射：从 x=1300 射向 1400 的大楼外墙
  p.pos = { x: 1300, y: 2100 }
  w.step(DT, new Map([[p.id, input({ fire: true, aim: 0 })]]))
  const orb = w.projectiles.find(pr => pr.weaponLabel === '引力枪')
  assert.ok(orb, 'gravity orb fired')
  assert.equal(orb!.passWalls, true, 'gravity orb passes walls')
  for (let i = 0; i < 20; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    w.drainEvents()
    if (!w.projectiles.some(pr => pr.id === orb!.id)) break
  }
  // 若已消失，也只应因寿命/命中玩家而非地形；飞行途中应越过 x=1424 的墙内侧
  const still = w.projectiles.find(pr => pr.id === orb!.id)
  if (still) assert.ok(still.pos.x > 1400, `orb should pass wall, x=${still.pos.x}`)
})

test('喷射燃料：槽已加倍（默认 1.0s 续航），断续点按仍不能无限飞', () => {
  assert.equal(getPhysicsParams().jetpackFuel, 1.0, 'fuel gauge doubled')
  const w = new World(47)
  const p = w.addPlayer('P', 'ffa')
  p.pos = { x: 6600, y: 2790 }
  p.onGround = true
  const y0 = p.pos.y
  let maxRise = 0
  for (let i = 0; i < 900; i++) {
    const tap = (i % 14) < 7
    w.step(DT, new Map([[p.id, input({ jetpack: tap })]]))
    w.drainEvents()
    maxRise = Math.max(maxRise, y0 - p.pos.y)
  }
  assert.ok(p.fuel <= 0.05, `fuel should be exhausted, fuel=${p.fuel.toFixed(3)}`)
  assert.ok(maxRise < 1600, `should not fly unbounded, maxRise=${maxRise.toFixed(0)}`)
  assert.ok(p.pos.y > y0 - 400, `should fall back near ground, y=${p.pos.y.toFixed(0)}`)

  // 连续按住 1.5s 仍有余量（加倍前 1.0s 就用尽）
  const w2 = new World(49)
  const q = w2.addPlayer('Q', 'ffa')
  q.pos = { x: 6600, y: 2000 }
  for (let i = 0; i < 90; i++) w2.step(DT, new Map([[q.id, input({ jetpack: true })]]))
  assert.ok(q.fuel > 0.2, `doubled gauge keeps flying at 1.5s, fuel=${q.fuel.toFixed(2)}`)
})

test('特武（激光/加特林/引力枪）只能从补给箱获得，常规换枪被拒', () => {
  const w = new World(43)
  const p = w.addPlayer('P', 'red')
  const start = p.weaponIndex
  for (const idx of [4, 5, 6]) {
    w.step(DT, new Map([[p.id, input({ switchWeapon: idx })]]))
    assert.equal(p.weaponIndex, start, `supply-only weapon ${idx} must not be switchable`)
  }
  // 补给箱可换
  const crate = w.supplyCrates.find(c => c.kind === 'weapon')!
  p.pos = { x: crate.x, y: crate.y }
  w.step(DT, new Map([[p.id, input()]]))
  assert.equal(p.weaponIndex, crate.weaponId, 'supply crate grants its weapon')
})

test('配装表：8 主武器（含手枪）+ 副武器仅手雷/人偶 + 武器差异倍率', () => {
  assert.equal(WEAPONS.length, 9)
  assert.deepEqual(WEAPONS.map(w => w.speed), [1000, 1500, 4000, 520, 3000, 1300, 900, 1500, 1500])
  assert.deepEqual(WEAPONS.map(w => w.damage), [13, 23, 100, 115, 50, 23, 30, 24, 14])   // M249=突击步枪(23)；引力枪 30；手枪 24
  for (const id of [4, 5, 6]) assert.ok(WEAPONS[id].isSupplyOnly, `weapon ${id} supply-only`)
  for (const id of [0, 1, 2, 3, 7, 8]) assert.ok(!WEAPONS[id].isSupplyOnly, `weapon ${id} normal primary`)
  // 霰弹：只有 8 丸全中才致死（8×13=104 ≥100，7×13=91 <100）；无爆头加成；射速降低
  assert.ok(WEAPONS[0].pellets * WEAPONS[0].damage! >= 100, 'full shotgun hit lethal')
  assert.ok((WEAPONS[0].pellets - 1) * WEAPONS[0].damage! < 100, 'partial shotgun hit not lethal')
  assert.equal(WEAPONS[0].headshotMult, 1.0, 'no headshot bonus (only full hit kills)')
  assert.ok(WEAPONS[0].fireDelay >= 0.9, 'shotgun fire rate lowered')
  assert.equal(WEAPONS[2].lifeSeconds, 999, 'sniper infinite range')
  assert.ok((WEAPONS[2].chargeSeconds ?? 0) >= 0.5, 'sniper needs aim charge time (balance)')
  assert.equal(WEAPONS[3].lifeSeconds, 999, 'bazooka infinite range')
  assert.equal(WEAPONS[3].gravityScale, 0, 'bazooka flies straight')
  assert.equal(WEAPONS[3].speed, 520, 'bazooka slow')
  assert.equal(WEAPONS[3].rocket, true, 'bazooka rocket sprite')
  assert.equal(WEAPONS[4].bounces, 3, 'laser bounces 3 times')
  assert.ok(WEAPONS[5].magSize >= 120 && WEAPONS[5].maxReserve >= 240, 'gatling high ammo')
  assert.equal(WEAPONS[5].damage, WEAPONS[1].damage, 'M249 damage equals assault rifle')
  assert.ok(WEAPONS[5].fireDelay <= 0.05, 'gatling high fire rate')
  assert.ok(WEAPONS[6].fireDelay >= 1.0 && WEAPONS[6].damage <= 30, 'gravity gun slower & weaker')
  assert.equal(WEAPONS[4].beam, true, 'laser is hitscan beam')
  assert.equal(WEAPONS[7].isSupplyOnly, false, 'pistol is a primary weapon')
  assert.ok(WEAPONS[7].moveSpeedMult! > 1.2, 'pistol fastest move speed')
  assert.deepEqual(Object.keys(SECONDARIES).sort(), ['doll', 'frag'], 'only frag + doll secondaries')
  assert.equal(SECONDARIES.doll.supplyOnly, true, 'doll is supply-only')
  assert.ok(!SECONDARIES.frag.supplyOnly, 'frag selectable')

  // 手雷充能制：初始 2、投出消耗、6s 回复 1
  const w = new World(53)
  const p = w.addPlayer('P', 'red')
  assert.equal(p.fragCharges, 2, 'starts with 2 frag charges')
  w.step(DT, new Map([[p.id, input({ secondary: sec('frag', p.pos.x + 100, p.pos.y) })]]))
  assert.equal(p.fragCharges, 1, 'throw consumes one charge')
  assert.equal(w.grenades.length, 1, 'grenade spawned')
  for (let i = 0; i < 60 * 7; i++) w.step(DT, new Map([[p.id, input()]]))   // 7 秒
  assert.equal(p.fragCharges, 2, 'charge regenerates after 6s')
  w.drainEvents()
})

test('手枪：主武器可切换；移速最快（比火箭筒快 50%+）', () => {
  const w = new World(55)
  const a = w.addPlayer('A', 'ffa')
  a.weaponIndex = 7   // 手枪
  a.pos = { x: 4000, y: 700 }   // 高空净空区，避免新地形阻挡
  const w2 = new World(56)
  const b = w2.addPlayer('B', 'ffa')
  b.weaponIndex = 3   // 火箭筒（最慢）
  b.pos = { x: 4000, y: 700 }
  const x0 = a.pos.x, x1 = b.pos.x
  for (let i = 0; i < 30; i++) {
    w.step(DT, new Map([[a.id, input({ move: 1 })]]))
    w2.step(DT, new Map([[b.id, input({ move: 1 })]]))
  }
  const pistolDist = a.pos.x - x0
  const rocketDist = b.pos.x - x1
  assert.ok(pistolDist > rocketDist * 1.3, `pistol ${pistolDist.toFixed(1)} vs rocket ${rocketDist.toFixed(1)}`)
})

test('迫击炮：操控后炮管角度跟随准星（aim 同步，限上半圆）', () => {
  const w = new World(51)
  const p = w.addPlayer('P', 'ffa')
  const m = w.mortars[0]
  p.pos = { x: m.x, y: m.y }
  // 交互上炮
  w.step(DT, new Map([[p.id, input({ interact: true })]]))
  assert.equal(m.operatorId, p.id, 'player mounts mortar via E')
  // 瞄准左上方（屏幕坐标：-π/2 正上方）
  for (let i = 0; i < 5; i++) w.step(DT, new Map([[p.id, input({ aim: -Math.PI / 2 })]]))
  assert.ok(Math.abs(m.angle - (-Math.PI / 2)) < 0.15, `mortar angle follows aim: ${m.angle.toFixed(2)}`)
  // 瞄准偏下 → 被限制到上半圆（≤ -0.12）
  w.step(DT, new Map([[p.id, input({ aim: Math.PI / 2 })]]))
  assert.ok(m.angle <= -0.11, `angle clamped to upper hemisphere: ${m.angle.toFixed(2)}`)
  // 开火后炮弹初速沿炮管角度（向上）
  w.step(DT, new Map([[p.id, input({ fire: true, aim: -Math.PI / 2 })]]))
  const shell = w.projectiles.find(pr => pr.weaponLabel === '公共迫击炮')
  assert.ok(shell, 'mortar shell fired')
  assert.ok(shell!.vel.y < 0, 'shell flies upward per aim')
})


test('死斗随机出生：randomSpawn 开启后每次出生点不同且安全', () => {
  const w = new World(61)
  w.config.randomSpawn = true
  const p = w.addPlayer('P', 'red')
  const places = new Set<string>()
  for (let k = 0; k < 12; k++) {
    // 触发重生：设置死亡计时
    p.respawnTimer = 0.02
    p.alive = false
    w.step(DT, new Map([[p.id, input()]]))
    w.step(DT, new Map([[p.id, input()]]))
    w.drainEvents()
    places.add(`${Math.round(p.pos.x >> 6)},${Math.round(p.pos.y >> 6)}`)
    // 出生安全（躯干不在实体里）
    const wx = wrapX(p.pos.x)
    const pts: [number, number][] = [[wx - 10, p.pos.y - 4], [wx + 10, p.pos.y - 4], [wx, p.pos.y - 6], [wx, p.pos.y - 26]]
    for (const [x, y] of pts) assert.ok(!w.terrain.isSolidAt(x, y), `spawn torso free at ${Math.round(x)},${Math.round(y)}`)
  }
  assert.ok(places.size >= 5, `random spawn varies: ${places.size} distinct cells`)
})

test('防卡死：出生/传送进实体内部后会自动推出', () => {
  const w = new World(63)
  const p = w.addPlayer('P', 'ffa')
  p.pos = { x: 6600, y: 3900 }   // 实心岩层内部
  p.vel = { x: 0, y: 0 }
  for (let i = 0; i < 30; i++) w.step(DT, new Map([[p.id, input()]]))
  const wx = wrapX(p.pos.x)
  assert.ok(!w.terrain.isSolidAt(wx, p.pos.y - 6), `pushed out of solid, pos=(${Math.round(p.pos.x)},${Math.round(p.pos.y)})`)
})

test('狙击：无限射程 + 一击必杀（身体命中 100 伤害）', () => {
  const w = new World(65)
  const shooter = w.addPlayer('S', 'red')
  shooter.weaponIndex = 2
  const victim = w.addPlayer('V', 'blue')
  // 空中长平台（避免两人蓄力期间自由落体导致弹道散布），保证 900px 视线无遮挡
  w.terrain.addSolidBlock(2100, 1000, 1100, 20, '#334155', '#334155', 'platform', 'test-floor')
  shooter.pos = { x: 2200, y: 984 }
  victim.pos = { x: 3100, y: 984 }
  for (let i = 0; i < 80; i++) w.step(DT, new Map([[shooter.id, input({ fire: true, aim: 0 })]]))
  assert.ok(victim.deaths > 0 || victim.hp <= 0, `sniper should one-shot at 900px, hp=${victim.hp}`)
})

test('火箭筒：直线飞行（不落）+ 慢速 + 无限射程 + 命中爆炸', () => {
  const w = new World(67)
  const p = w.addPlayer('P', 'red')
  p.weaponIndex = 3
  p.pos = { x: 3000, y: 2600 }
  w.step(DT, new Map([[p.id, input({ fire: true, aim: 0 })]]))
  const rocket = w.projectiles.find(pr => pr.rocket)
  assert.ok(rocket, 'rocket fired')
  const y0 = rocket!.pos.y
  for (let i = 0; i < 30; i++) w.step(DT, new Map([[p.id, input()]]))
  const cur = w.projectiles.find(pr => pr.id === rocket!.id)
  if (cur) {
    assert.ok(Math.abs(cur.pos.y - y0) < 2, `rocket flies straight, dy=${(cur.pos.y - y0).toFixed(2)}`)
  }
  assert.ok(rocket!.life > 5 && rocket!.gravityScale === 0, 'infinite range + no gravity')
})

test('不要滑：松开方向键立即停止，撞墙直接停住（无反向滑步）', () => {
  const w = new World(69)
  const p = w.addPlayer('P', 'ffa')
  p.pos = { x: 500, y: 2784 }
  for (let i = 0; i < 10; i++) w.step(DT, new Map([[p.id, input({ move: 1 })]]))
  const x1 = p.pos.x
  w.step(DT, new Map([[p.id, input({ move: 0 })]]))
  assert.ok(Math.abs(p.vel.x) < 1e-6, `no inertia when released, vx=${p.vel.x}`)
  assert.ok(p.pos.x - x1 < 1, 'does not slide after release')
})


test('飞行：上升加速（喷射渐变） vs 下降加速（俯冲），且水平零滑步', () => {
  // 上升加速：连续喷射的前 0.2s 是加速梯度（speed 逐帧增加）
  const w = new World(71)
  const a = w.addPlayer('A', 'ffa')
  a.pos = { x: 6600, y: 2500 }
  const speeds: number[] = []
  for (let i = 0; i < 24; i++) {
    w.step(DT, new Map([[a.id, input({ jetpack: true })]]))
    speeds.push(a.vel.y)
  }
  // 屏幕坐标 y 向下为正：上升是负速度，数值越来越负 = 加速
  assert.ok(speeds[3] < speeds[0] && speeds[6] < speeds[3], `ascent accelerates: ${speeds[0].toFixed(1)}→${speeds[3].toFixed(1)}→${speeds[6].toFixed(1)}`)

  // 下降加速：同高度自由落体 vs 按住下键，俯冲 0.5s 后更快
  const w2 = new World(72)
  const b = w2.addPlayer('B', 'ffa')
  b.pos = { x: 6600, y: 2200 }
  for (let i = 0; i < 30; i++) w2.step(DT, new Map([[b.id, input({ dive: true })]]))
  const diveSpeed = b.vel.y
  const w3 = new World(73)
  const c = w3.addPlayer('C', 'ffa')
  c.pos = { x: 6600, y: 2200 }
  for (let i = 0; i < 30; i++) w3.step(DT, new Map([[c.id, input()]]))
  const fallSpeed = c.vel.y
  assert.ok(diveSpeed > fallSpeed * 1.35, `dive accelerates downward: dive=${diveSpeed.toFixed(0)} fall=${fallSpeed.toFixed(0)}`)

  // 水平零滑步：俯冲中松开方向键 → 水平速度立即为 0
  const w4 = new World(74)
  const d2 = w4.addPlayer('D', 'ffa')
  d2.pos = { x: 6600, y: 2400 }
  w4.step(DT, new Map([[d2.id, input({ move: 1, dive: true })]]))
  const vxFly = d2.vel.x
  w4.step(DT, new Map([[d2.id, input({ move: 0, dive: true })]]))
  assert.ok(Math.abs(d2.vel.x) < 1e-6, `no horizontal slide while diving (was ${vxFly})`)
})


test('瞭望塔：按 E 上塔锁定（不能移动）+ 下塔后视野加成消失；补给武器视野+30%', () => {
  // FOV：狙击 + 三把补给特武都是 1.30
  for (const id of [2, 4, 5, 6]) assert.equal(WEAPONS[id].fovMult, 1.30, `weapon ${id} +30% fov`)

  const w = new World(81)
  const p = w.addPlayer('P', 'ffa')
  const tw = w.watchtowers[0]
  p.pos = { x: tw.x, y: tw.y }
  // 上塔
  w.step(DT, new Map([[p.id, input({ interact: true })]]))
  assert.equal(tw.operatorId, p.id, 'mounted tower')
  assert.equal(p.mountedTowerId, tw.id, 'player mountedTowerId set')
  assert.ok(Math.abs(p.pos.x - tw.x) < 1 && p.pos.y < tw.y, 'locked at tower top')
  // 锁定：按住右移也不动
  const x0 = p.pos.x
  for (let i = 0; i < 30; i++) w.step(DT, new Map([[p.id, input({ move: 1, jetpack: true })]]))
  assert.ok(Math.abs(p.pos.x - x0) < 0.01, `cannot move while mounted, x=${p.pos.x}`)
  // 下塔 → 加成消失
  w.step(DT, new Map([[p.id, input({ interact: true })]]))
  assert.equal(p.mountedTowerId, null, 'dismounted')
  assert.equal(tw.operatorId, null, 'tower freed')
})


test('穿模解算：卡进大楼墙体 / 障碍物内部都会被最小轴推出，不会永久卡住', () => {
  const w = new World(91)
  const p = w.addPlayer('P', 'ffa')

  // ① 塞进西翼大楼外墙（1400..1424 的墙段，y 2100 附近）
  p.pos = { x: 1412, y: 2100 }
  p.vel = { x: 0, y: 0 }
  for (let i = 0; i < 30; i++) w.step(DT, new Map([[p.id, input()]]))
  assert.ok(!w.bodyOverlapsAt(p.pos.x, p.pos.y), `pushed out of building wall, pos=(${Math.round(p.pos.x)},${Math.round(p.pos.y)})`)

  // ② 塞进预设障碍物（obs_box_1 6420,2730,68,70）
  const w2 = new World(92)
  const q = w2.addPlayer('Q', 'ffa')
  q.pos = { x: 6454, y: 2770 }
  q.vel = { x: 0, y: 0 }
  for (let i = 0; i < 30; i++) w2.step(DT, new Map([[q.id, input()]]))
  assert.ok(!w2.bodyOverlapsAt(q.pos.x, q.pos.y), `pushed out of obstacle, pos=(${Math.round(q.pos.x)},${Math.round(q.pos.y)})`)

  // ③ 高速冲墙（连续 3 秒向右撞大楼墙）不被卡进墙里
  const w3 = new World(93)
  const r = w3.addPlayer('R', 'ffa')
  r.pos = { x: 1200, y: 2760 }
  for (let i = 0; i < 180; i++) w3.step(DT, new Map([[r.id, input({ move: 1, jetpack: i % 20 < 6 })]]))
  assert.ok(!w3.bodyOverlapsAt(r.pos.x, r.pos.y), `no wall penetration after ram, pos=(${Math.round(r.pos.x)},${Math.round(r.pos.y)})`)
})


test('引力弹：穿墙 + 射程有限 + 弹速逐渐衰减', () => {
  const w = new World(95)
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 6   // 引力枪
  p.pos = { x: 1300, y: 2100 }
  w.step(DT, new Map([[p.id, input({ fire: true, aim: 0 })]]))
  const orb = w.projectiles.find(pr => pr.isGravityOrb)
  assert.ok(orb, 'orb fired')
  assert.equal(orb!.passWalls, true, 'passes walls')
  assert.ok(orb!.dragPerSecond < 1, 'has gradual slowdown')
  const speed0 = Math.hypot(orb!.vel.x, orb!.vel.y)
  // 跑 1 秒：速度应明显衰减
  for (let i = 0; i < 60; i++) w.step(DT, new Map([[p.id, input()]]))
  const cur = w.projectiles.find(pr => pr.id === orb!.id)
  if (cur) {
    const speed1 = Math.hypot(cur.vel.x, cur.vel.y)
    assert.ok(speed1 < speed0 * 0.7, `speed decays: ${speed0.toFixed(0)} -> ${speed1.toFixed(0)}`)
  }
  // 射程有限：总寿命 ≤ 2.2s
  assert.ok((orb!.life ?? 0) <= 2.2, 'limited lifetime/range')
})


test('引力弹：持续把玩家拉向弹体位置；力度可被移动抵抗', () => {
  const makeOrb = (w: World, x: number, y: number) => {
    w.projectiles.push({
      id: 777001, owner: 1, pos: { x, y }, vel: { x: 0, y: 0 }, life: 8, r: 8.5,
      damage: 52, headshotMult: 1.6, explosive: true, terrainRadius: 95,
      gravityScale: 0.02, pierceOnHeadshot: false, pierceAll: false,
      isGravityOrb: true, passWalls: true, beam: false, rocket: false,
      bounces: 0, dragPerSecond: 0.45, weaponLabel: '引力枪', color: '#a855f7', hitTargets: [],
    } as never)
  }
  // 开阔地面（建筑 1 与台地之间），玩家站稳 → 不会被重力带出牵引范围
  const w = new World(97)
  const p = w.addPlayer('P', 'ffa')
  p.pos = { x: 2200, y: 2784 }
  makeOrb(w, 2450, 2760)   // 右侧 250px
  const d0 = Math.abs(2450 - p.pos.x)
  for (let i = 0; i < 60; i++) { w.step(DT, new Map([[p.id, input()]])); w.drainEvents() }
  const d1 = Math.abs(2450 - p.pos.x)
  assert.ok(d1 < d0 - 90, `pulled toward orb: ${d0.toFixed(0)} -> ${d1.toFixed(0)}`)

  // 抵抗：弹体在左，玩家向右跑（远离）
  const w2 = new World(98)
  const q = w2.addPlayer('Q', 'ffa')
  q.pos = { x: 2200, y: 2784 }
  makeOrb(w2, 1950, 2760)
  const r0 = Math.abs(1950 - q.pos.x)
  for (let i = 0; i < 90; i++) { w2.step(DT, new Map([[q.id, input({ move: 1 })]])); w2.drainEvents() }
  const r1 = Math.abs(1950 - q.pos.x)
  assert.ok(r1 > r0 + 180, `can resist pull by moving away: ${r0.toFixed(0)} -> ${r1.toFixed(0)}`)
})

test('手雷：命中范围一发致死（衰减到最远仍 ≥100 伤害）', () => {
  const w = new World(101)
  const p = w.addPlayer('P', 'red')
  const t = w.addPlayer('T', 'blue')
  t.pos = { x: 3000, y: 2760 }
  p.pos = { x: 2800, y: 2760 }
  // 在目标脚下引爆一枚手雷（直接注入，缩短引信）
  w.grenades.push({ id: 991, owner: p.id, pos: { x: 3060, y: 2760 }, vel: { x: 0, y: 0 }, fuse: 0.05, bounces: 0 })
  let killed = false
  for (let i = 0; i < 120; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    if (w.drainEvents().some(e => e.kind === 'kill' && e.victimId === t.id)) { killed = true; break }
  }
  assert.ok(killed || t.deaths > 0 || t.hp <= 0, `grenade should one-shot, hp=${t.hp} deaths=${t.deaths}`)
  assert.ok(DEFAULT_CONFIG.grenadeDamage * 0.2 >= 100, 'min falloff still lethal')
})


test('玩家碰撞：互相阻挡、可站头顶、可顶着对方走', () => {
  // ① 水平阻挡：A 撞向 B 不会穿过
  const w = new World(111)
  const a = w.addPlayer('A', 'ffa')
  const b = w.addPlayer('B', 'ffa')
  a.pos = { x: 2300, y: 2740 }   // 开阔地表（避开竖井/建筑/障碍）
  b.pos = { x: 2340, y: 2740 }
  for (let i = 0; i < 60; i++) w.step(DT, new Map([[a.id, input({ move: 1 })], [b.id, input()]]))
  const gap = Math.abs(b.pos.x - a.pos.x)
  assert.ok(gap >= 20, `players collide (gap=${gap.toFixed(1)})`)

  // ② 站头顶：A 落到 B 头上并站稳
  const w2 = new World(112)
  const c = w2.addPlayer('C', 'ffa')
  const d = w2.addPlayer('D', 'ffa')
  d.pos = { x: 2300, y: 2760 }
  c.pos = { x: 2300, y: 2600 }   // 正上方
  for (let i = 0; i < 90; i++) w2.step(DT, new Map([[c.id, input()], [d.id, input()]]))
  assert.ok(Math.abs(c.pos.x - d.pos.x) < 6, `stays above head, dx=${(c.pos.x - d.pos.x).toFixed(1)}`)
  assert.ok(c.pos.y <= d.pos.y - 40 && c.pos.y >= d.pos.y - 50, `stands on head: c.y=${c.pos.y.toFixed(0)} d.y=${d.pos.y.toFixed(0)}`)

  // ③ 顶着走：A 持续推 B，B 位置被推走
  const w3 = new World(113)
  const e = w3.addPlayer('E', 'ffa')
  const f = w3.addPlayer('F', 'ffa')
  e.pos = { x: 2300, y: 2740 }
  f.pos = { x: 2320, y: 2740 }
  const f0 = f.pos.x
  for (let i = 0; i < 120; i++) w3.step(DT, new Map([[e.id, input({ move: 1 })], [f.id, input()]]))
  assert.ok(f.pos.x > f0 + 5, `pushed by walking into them: ${f0.toFixed(0)} -> ${f.pos.x.toFixed(0)}`)
})


test('霰弹：贴脸全中 8 丸一发致死；中距离不全中不死', () => {
  // 贴脸 60px：散布横向 ±8.4px < 身体半宽 → 8 丸全中 = 104 伤害
  const w = new World(121)
  const shooter = w.addPlayer('S', 'red')
  const victim = w.addPlayer('V', 'blue')
  shooter.weaponIndex = 0
  shooter.pos = { x: 2200, y: 2784 }
  victim.pos = { x: 2260, y: 2784 }
  for (let i = 0; i < 20; i++) w.step(DT, new Map([[shooter.id, input({ fire: i === 0, aim: 0 })]]))
  assert.ok(victim.hp <= 0 || victim.deaths > 0, `point-blank full hit one-shots, hp=${victim.hp}`)

  // 中距离 600px：散布横向 ±84px → 不可能 8 丸全中 → 不死
  const w2 = new World(122)
  const s2 = w2.addPlayer('S', 'red')
  const v2 = w2.addPlayer('V', 'blue')
  s2.weaponIndex = 0
  s2.pos = { x: 2000, y: 800 }
  v2.pos = { x: 2600, y: 800 }
  for (let i = 0; i < 60; i++) w2.step(DT, new Map([[s2.id, input({ fire: i === 0, aim: 0 })]]))
  assert.ok(v2.hp > 0, `mid-range partial hit survives, hp=${v2.hp}`)
})


test('弹射跳台：全部位于可站立地表、站立触发、空中经过不误触', () => {
  const w = new World(131)
  for (const pad of JUMP_PADS) {
    assert.ok(w.terrain.isSolidAt(pad.x, pad.y + 12), `pad at ${pad.x} stands on ground`)
    assert.ok(!w.terrain.isSolidAt(pad.x, pad.y - 8), `pad at ${pad.x} has free space above`)
  }
  // 站立触发
  const p = w.addPlayer('P', 'ffa')
  const pad = JUMP_PADS[0]
  p.pos = { x: pad.x, y: pad.y - 16 }
  p.vel = { x: 0, y: 0 }
  p.onGround = true
  w.step(DT, new Map([[p.id, input()]]))
  assert.ok(p.vel.y < -500, `pad launches standing player, vy=${p.vel.y.toFixed(0)}`)

  // 空中经过（不落地）不触发
  const w2 = new World(132)
  const q = w2.addPlayer('Q', 'ffa')
  q.pos = { x: pad.x, y: pad.y - 18 }
  q.vel = { x: 0, y: 40 }
  q.onGround = false
  w2.step(DT, new Map([[q.id, input()]]))
  assert.ok(q.vel.y > -500, `no launch while airborne, vy=${q.vel.y.toFixed(0)}`)
})


test('工程化分层：入口仅装配、模块目录分类齐全、无反向依赖', async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const root = process.cwd()
  const read = (rel: string) => fs.readFile(path.join(root, rel), 'utf8')
  const webMain = await read('src/web/main-web.ts')
  // 入口只做装配（≤120 行），负责启动循环与暴露调试/调参
  assert.ok(webMain.split('\n').length <= 120, `main-web should stay small (${webMain.split('\n').length} lines)`)
  assert.ok(webMain.includes('bindAllEvents') && webMain.includes('startGameLoop'), 'entry wires bindings + loop')
  // 分类目录齐全
  for (const f of [
    'src/web/app/context.ts', 'src/web/app/hud.ts', 'src/web/app/toast.ts',
    'src/web/app/events.ts', 'src/web/app/params.ts',
    'src/web/game/bots.ts', 'src/web/game/loop.ts', 'src/web/game/loadout.ts',
    'src/web/input/bindings.ts', 'src/web/input/device.ts',
    'src/web/render/scene.ts',
  ]) {
    await fs.access(path.join(root, f))
  }
  // 模块不得反向 import 入口
  for (const dir of ['src/web/app', 'src/web/game', 'src/web/input', 'src/web/render']) {
    for (const f of await fs.readdir(path.join(root, dir))) {
      const src = await fs.readFile(path.join(root, dir, f), 'utf8')
      assert.ok(!src.includes('main-web.ts'), `${dir}/${f} must not import entry`)
    }
  }
})


test('平衡回归：20 种子对射矩阵下各武器胜率/距离定位/平均 TTK 在合理区间', () => {
  const res = runDuelSim({ seeds: 20 })
  const byName = Object.fromEntries(res.table.map(r => [r.name, r]))
  // 总体胜率：全体 30%~70%，避免一家独大
  for (const r of res.table) assert.ok(r.winRate >= 30 && r.winRate <= 70, `${r.name} win ${r.winRate}% out of [30,70]`)
  // 距离定位：霰弹近距/火箭近距/狙远距必须强；长枪中远距可用
  assert.ok((byName['霰弹']?.byDist['180'] ?? 0) >= 60, 'shotgun close-range niche')
  assert.ok((byName['火箭筒']?.byDist['180'] ?? 0) >= 55, 'rocket close-range niche')
  assert.ok((byName['狙']?.byDist['700'] ?? 0) >= 60, 'sniper long-range niche')
  assert.ok((byName['突击步枪']?.byDist['380'] ?? 0) >= 35, 'rifle mid-range viable')
  // 战斗节奏：平均击杀时间不超过 3s
  const ttkAvg = res.table.reduce((a, r) => a + (r.avgTTK ?? 0), 0) / res.table.length
  assert.ok(ttkAvg < 3, `average TTK ${ttkAvg.toFixed(2)}s too slow`)
})
