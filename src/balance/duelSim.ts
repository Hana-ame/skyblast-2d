// scripts/duel-sim.ts —— 1v1 对射平衡模拟（权威 World + AI 输入，多距离/多种子/全武器矩阵）
// 用法：node scripts/duel-sim.ts [--seeds=40] [--json]
import { World } from '../core/sim/world.ts'
import { WEAPONS } from '../core/weapons.ts'
import { defaultWorldInput } from '../core/types.ts'
import type { WorldInput, PlayerState } from '../core/types.ts'

const DT = 1 / 60
export const MAIN_WEAPONS = [0, 1, 2, 3, 7, 8]   // 霰弹/突击/狙/火箭筒/手枪/冲锋枪
export const DISTANCES = [180, 380, 700]
const MAX_SECONDS = 6

function makeArena(): World {
  const w = new World(424242)
  // 空中长平台（隔离地形，保证各距离净空；避免石头/掩体影响弹道）
  w.terrain.addSolidBlock(0, 1000, 2400, 20, '#1e293b', '#334155', 'platform', 'duel-floor')
  return w
}

interface AICtl {
  p: PlayerState
  target: PlayerState
  seed: number
  strafeDir: 1 | -1
  nextSwitch: number
  t: number
  aimJitter: number
  homeX: number
  rngState: number
}

function newCtl(p: PlayerState, target: PlayerState, seed: number): AICtl {
  return { p, target, seed, strafeDir: rnd(seed * 31 + 7) < 0.5 ? -1 : 1, nextSwitch: 0.3 + ((seed * 37) % 50) / 100, t: 0, aimJitter: 0, homeX: p.pos.x, rngState: (seed * 2654435761) >>> 0 }
}

function rnd(s: number): number {
  // 简单确定性 LCG
  s = (s * 1664525 + 1013904223) | 0
  return ((s >>> 0) / 4294967296)
}

function nextRnd(c: AICtl): number {
  c.rngState = (c.rngState * 1664525 + 1013904223) >>> 0
  return c.rngState / 4294967296
}

function aiInput(c: AICtl): WorldInput {
  const w = defaultWorldInput()
  const wep = WEAPONS[c.p.weaponIndex]
  let tx = c.target.pos.x
  let ty = c.target.pos.y - 20
  // 弹道预判（慢速弹/火箭）：按目标当前速度提前量瞄准；光束/即时弹无需提前
  if (!wep?.beam && wep) {
    const dist = Math.hypot(tx - c.p.pos.x, ty - (c.p.pos.y - 20))
    const travel = dist / Math.max(1, wep.speed)
    tx += c.target.vel.x * travel
    ty += c.target.vel.y * travel
  }
  const dx = tx - c.p.pos.x
  const dy = ty - (c.p.pos.y - 20)
  w.aim = Math.atan2(dy, dx)
  // 抖动（瞄准误差）
  c.aimJitter = (nextRnd(c) - 0.5) * 0.02
  w.aim += c.aimJitter
  // 走位：周期换向，限制在起始点 ±140px 内
  if (c.t >= c.nextSwitch) {
    c.strafeDir = (c.strafeDir === 1 ? -1 : 1)
    c.nextSwitch = c.t + 0.35 + nextRnd(c) * 0.8
  }
  if (Math.abs(c.p.pos.x - c.homeX) > 140) c.strafeDir = (c.p.pos.x > c.homeX ? -1 : 1) as 1 | -1
  w.move = c.strafeDir
  w.fire = true
  c.t += DT
  return w
}

interface Row { a: number; b: number; dist: number; winner: 'a' | 'b' | 'draw'; ttk: number; aHp: number; bHp: number }

function duel(aIdx: number, bIdx: number, dist: number, seed: number): Row {
  const w = makeArena()
  const a = w.addPlayer('A', 'red')
  const b = w.addPlayer('B', 'blue')
  a.weaponIndex = aIdx
  b.weaponIndex = bIdx
  a.pos = { x: 600, y: 984 }
  b.pos = { x: 600 + dist, y: 984 }
  a.vel = { x: 0, y: 0 }
  b.vel = { x: 0, y: 0 }
  const ca = newCtl(a, b, seed * 2 + 1)
  const cb = newCtl(b, a, seed * 2 + 2)
  let t = 0
  for (let i = 0; i < MAX_SECONDS * 60; i++) {
    const inputs = new Map<number, WorldInput>([[a.id, aiInput(ca)], [b.id, aiInput(cb)]])
    w.step(DT, inputs)
    w.drainEvents()
    t += DT
    const dead = a.hp <= 0 || b.hp <= 0
    if (dead) {
      return { a: aIdx, b: bIdx, dist, winner: a.hp <= 0 && b.hp > 0 ? 'b' : b.hp <= 0 && a.hp > 0 ? 'a' : 'draw', ttk: t, aHp: Math.max(0, a.hp), bHp: Math.max(0, b.hp) }
    }
  }
  return { a: aIdx, b: bIdx, dist, winner: 'draw', ttk: MAX_SECONDS, aHp: a.hp, bHp: b.hp }
}


export interface DuelSimOptions { seeds?: number; weapons?: number[]; distances?: number[] }
export interface DuelSimResult {
  rows: Row[]
  table: { id: number; name: string; games: number; winRate: number; drawRate: number; avgTTK: number | null; byDist: Record<number, number> }[]
  side: { aWins: number; bWins: number; draws: number; total: number }
}

export function runDuelSim(opts: DuelSimOptions = {}): DuelSimResult {
  const seeds = opts.seeds ?? 20
  const wepIds = opts.weapons ?? MAIN_WEAPONS
  const dists = opts.distances ?? DISTANCES

  const rows: Row[] = []
  for (const ai of wepIds) {
    for (const bi of wepIds) {
    // 镜像对局只需跑一遍（i>j 时反向统计仍有效，但为了种子对称两组都跑）
      for (const d of dists) {
        for (let s = 1; s <= seeds; s++) rows.push(duel(ai, bi, d, s + ai * 1000 + bi * 100 + d))
    }
  }
}

// 统计：每把武器总胜率 / 各距离胜率 / 平均 TTK / 镜像胜率校验
  const stats: Record<number, { games: number; wins: number; draws: number; ttkSum: number; kills: number; byDist: Record<number, { games: number; wins: number }> }> = {}
  for (const r of rows) {
    const sides: [number, 'a' | 'b'][] = [[r.a, 'a'], [r.b, 'b']]
    for (const [idx, side] of sides) {
      const st = (stats[idx] ??= { games: 0, wins: 0, draws: 0, ttkSum: 0, kills: 0, byDist: {} })
      st.games++
      const bd = (st.byDist[r.dist] ??= { games: 0, wins: 0 })
      bd.games++
      if (r.winner === 'draw') st.draws++
      else if (r.winner === side) {
        st.wins++
        st.kills++
        st.ttkSum += r.ttk
        bd.wins++
      }
    }
  }

  const table = Object.entries(stats).map(([id, st]) => ({
    id: Number(id),
    name: WEAPONS[Number(id)].shortName,
    games: st.games,
    winRate: +(st.wins / st.games * 100).toFixed(1),
    drawRate: +(st.draws / st.games * 100).toFixed(1),
    avgTTK: st.kills ? +(st.ttkSum / st.kills).toFixed(2) : null,
    byDist: Object.fromEntries(Object.entries(st.byDist).map(([d, v]) => [d, +(v.wins / v.games * 100).toFixed(1)])),
  }))
  table.sort((x, y) => y.winRate - x.winRate)

  const side = {
    aWins: rows.filter(r => r.winner === 'a').length,
    bWins: rows.filter(r => r.winner === 'b').length,
    draws: rows.filter(r => r.winner === 'draw').length,
    total: rows.length,
  }
  return { rows, table, side }
}

export interface SecondaryBalanceRow {
  secId: string
  name: string
  unlockStreak: number
  winRate: number
  survivalRate: number
  avgAliveSec: number
}

/**
 * 评估连死阶梯各副手（无副手 vs 障碍物/100HP不溢出护盾/teleport/替身人偶）对劣势方（手枪/冲锋枪/步枪 对阵 全主武器）的追赶增益
 */
export function runSecondaryBalanceSim(seeds = 15): SecondaryBalanceRow[] {
  const tiers: { id: string; secId: string; label: string; streak: number }[] = [
    { id: 'none', secId: 'none', label: '无副手(基线)', streak: 0 },
    { id: 'obstacle', secId: 'obstacle', label: '🧱 障碍物', streak: 1 },
    { id: 'shield', secId: 'shield', label: '🛡️ 护盾(100HP不溢出)', streak: 2 },
    { id: 'teleport', secId: 'teleport', label: '🌀 Teleport(读条)', streak: 3 },
    { id: 'doll', secId: 'doll', label: '🎎 替身人偶', streak: 4 },
  ]
  const underdogWeps = [7, 8, 1] // 手枪 / 冲锋枪 / 突击步枪
  const enemyWeps = MAIN_WEAPONS
  const dists = [220, 380, 620]
  const out: SecondaryBalanceRow[] = []

  for (const tier of tiers) {
    let games = 0
    let wins = 0
    let survived = 0
    let aliveSum = 0

    for (const uw of underdogWeps) {
      for (const ew of enemyWeps) {
        for (const dist of dists) {
          for (let s = 1; s <= seeds; s++) {
            games++
            const w = makeArena()
            const a = w.addPlayer('Underdog', 'red')
            const b = w.addPlayer('Dominant', 'blue')
            a.weaponIndex = uw
            b.weaponIndex = ew
            a.pos = { x: 700, y: 984 }
            b.pos = { x: 700 + dist, y: 984 }
            a.vel = { x: 0, y: 0 }
            b.vel = { x: 0, y: 0 }
            a.deathStreak = tier.streak
            if (tier.secId !== 'none') {
              a.secondary = tier.secId
              if (tier.secId === 'doll') a.dollCharges = 1
            }

            const ca = newCtl(a, b, s * 13 + uw * 7 + dist)
            const cb = newCtl(b, a, s * 17 + ew * 11 + dist)
            let usedSec = false
            let t = 0
            for (let tick = 0; tick < MAX_SECONDS * 60; tick++) {
              const inA = aiInput(ca)
              const inB = aiInput(cb)
              if (!usedSec && tick === 1 && tier.secId !== 'none') {
                usedSec = true
                if (tier.secId === 'teleport') {
                  inA.secondary = { type: 'teleport', targetX: b.pos.x + 140, targetY: b.pos.y - 160 }
                } else {
                  inA.secondary = { type: tier.secId, targetX: b.pos.x, targetY: b.pos.y }
                }
              }
              if (tier.secId === 'obstacle' && tick > 1 && tick < 180) {
                inA.move = 0
                inB.move = -1
              }
              w.step(DT, new Map([[a.id, inA], [b.id, inB]]))
              w.drainEvents()
              t += DT
              if (!a.alive || !b.alive) break
            }
            aliveSum += t
            if (a.alive && !b.alive) wins++
            if (a.alive) survived++
          }
        }
      }
    }
    out.push({
      secId: tier.id,
      name: tier.label,
      unlockStreak: tier.streak,
      winRate: +(wins / games * 100).toFixed(1),
      survivalRate: +(survived / games * 100).toFixed(1),
      avgAliveSec: +(aliveSum / games).toFixed(2),
    })
  }
  return out
}
