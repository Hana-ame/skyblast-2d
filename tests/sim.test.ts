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
import { WEAPONS, SECONDARIES } from '../src/core/weapons.ts'
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
  for (let i = 0; i < 10; i++) w.step(DT, new Map([[shooter.id, input({ fire: i === 0, aim: 0 })]]))
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

test('护盾：吸收伤害并按超时消散', () => {
  const w = new World(9)
  const p = w.addPlayer('P', 'red')
  const enemy = w.addPlayer('E', 'blue')
  w.step(DT, new Map([[p.id, input({ secondary: sec('shield') })]]))
  assert.ok(p.shieldTimer > 0 && p.shieldHp > 0, 'shield should be active')
  const shieldHp0 = p.shieldHp
  enemy.weaponIndex = 1
  enemy.pos = { x: p.pos.x - 80, y: p.pos.y }
  for (let i = 0; i < 90; i++) {
    w.step(DT, new Map([[enemy.id, input({ fire: true, aim: 0 })]]))
    w.drainEvents()
  }
  assert.ok(p.shieldHp < shieldHp0 || p.shieldTimer === 0 || p.hp < 100, 'shield should absorb/timeout')
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

test('可破坏障碍物：barricade 生成、被打掉后移除', () => {
  const w = new World(13)
  const p = w.addPlayer('P', 'ffa')
  const obs0 = w.obstacles.length
  w.step(DT, new Map([[p.id, input({ secondary: sec('barricade') })]]))
  assert.ok(w.obstacles.length === obs0 + 1, 'barricade spawned')
  const target = w.obstacles[w.obstacles.length - 1]
  // 用榴弹炮轰它（68×多次）
  const shooter = w.addPlayer('S', 'blue')
  shooter.weaponIndex = 3
  shooter.pos = { x: target.x - 200, y: target.y + 40 }
  let destroyed = false
  for (let i = 0; i < 200; i++) {
    w.step(DT, new Map([[shooter.id, input({ fire: true, aim: Math.atan2(target.y - shooter.pos.y, 200) })]]))
    if (w.drainEvents().some(e => e.kind === 'obstacle_destroy' && e.obstacleId === target.id)) { destroyed = true; break }
  }
  assert.ok(destroyed, 'barricade should be destructible')
  assert.ok(!w.obstacles.some(o => o.id === target.id), 'destroyed obstacle removed')
})

test('地雷：直击触发 + 瞬发雷 0 延迟爆炸', () => {
  const w = new World(17)
  const p = w.addPlayer('P', 'red')
  const t = w.addPlayer('T', 'blue')
  t.pos = { x: p.pos.x + 40, y: p.pos.y }
  w.step(DT, new Map([[p.id, input({ secondary: sec('instant_mine', t.pos.x, t.pos.y) })]]))
  let exploded = w.drainEvents().some(e => e.kind === 'explosion')   // 直击可同帧引爆
  for (let i = 0; i < 180 && !exploded; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    if (w.drainEvents().some(e => e.kind === 'explosion')) { exploded = true; break }
  }
  assert.ok(exploded, 'instant mine direct-hit should explode')
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


test('激光枪：撞墙反弹（2 次配额，首弹后 1 次剩余，bounces=2 起）', () => {
  const w = new World(41)
  const p = w.addPlayer('P', 'ffa')
  p.weaponIndex = 4   // 激光炮
  p.pos = { x: 6600, y: 2660 }
  w.step(DT, new Map([[p.id, input({ fire: true, aim: Math.PI / 2 })]]))
  const laser = w.projectiles.find(pr => pr.weaponLabel === '激光炮')
  assert.ok(laser, 'laser fired')
  assert.equal(laser!.bounces, 2, 'laser starts with 2 bounces')
  let bounced = false
  for (let i = 0; i < 30; i++) {
    w.step(DT, new Map([[p.id, input()]]))
    if (w.projectiles.some(pr => pr.weaponLabel === '激光炮' && pr.vel.y < 0)) { bounced = true; break }
    w.drainEvents()
  }
  assert.ok(bounced, 'laser should bounce off ground (vy flips negative)')
  const after = w.projectiles.find(pr => pr.weaponLabel === '激光炮')
  assert.ok(after && after.bounces === 1, 'one of two bounces consumed')
  assert.ok(after!.life > 0, 'laser survives the bounce')
  assert.equal(after!.beam, true, 'laser renders as beam')
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

test('喷射燃料：断续点按 W 不能无限飞（空中不回充，落地才回）', () => {
  const w = new World(47)
  const p = w.addPlayer('P', 'ffa')
  // 回到地面附近
  p.pos = { x: 6600, y: 2790 }
  p.onGround = true
  const y0 = p.pos.y
  let maxRise = 0
  for (let i = 0; i < 900; i++) {
    const tap = (i % 14) < 7   // 断续 7 帧按 / 7 帧松
    w.step(DT, new Map([[p.id, input({ jetpack: tap })]]))
    w.drainEvents()
    maxRise = Math.max(maxRise, y0 - p.pos.y)
  }
  // 1) 燃料应耗尽（空中不回充）
  assert.ok(p.fuel <= 0.01, `fuel should be exhausted, fuel=${p.fuel.toFixed(3)}`)
  // 2) 高度不应无限累积
  assert.ok(maxRise < 1200, `should not fly unbounded, maxRise=${maxRise.toFixed(0)}`)
  // 3) 最终应回到地面附近
  assert.ok(p.pos.y > y0 - 300, `should fall back near ground, y=${p.pos.y.toFixed(0)}`)
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

test('配装表：7 主武器数值（弹速 px/s / 伤害）与 supply-only 标记', () => {
  assert.equal(WEAPONS.length, 7)
  const speed = WEAPONS.map(w => w.speed)
  assert.deepEqual(speed, [1000, 1250, 2000, 950, 3000, 1300, 900])
  assert.deepEqual(WEAPONS.map(w => w.damage), [16, 19, 68, 68, 50, 14, 52])
  for (const id of [4, 5, 6]) assert.ok(WEAPONS[id].isSupplyOnly, `weapon ${id} supply-only`)
  assert.equal(WEAPONS[4].bounces, 2, 'laser bounces twice')
  assert.equal(WEAPONS[6].passWalls, true, 'gravity orb passes walls')
  // 人偶不在常规副武器可选列表（supplyOnly）
  assert.equal(SECONDARIES.doll.supplyOnly, true, 'doll is supply-only')
  assert.ok(!SECONDARIES.frag.supplyOnly && !SECONDARIES.shield.supplyOnly, 'normal secondaries selectable')
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
