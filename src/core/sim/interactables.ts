// core/sim/interactables.ts —— 地图互动设施子系统 (stepMapInteractables)：
//   占领点、复活点按 E 选中、迫击炮、瞭望塔、量子传送门、特武/人偶补给箱、弹药包经济与替身人偶回溯
import { getPhysicsParams } from './physics.ts'
import type { Rng } from '../rng.ts'
import { WEAPONS } from '../weapons.ts'
import type { GameConfig } from '../weapons.ts'
import { wrapX, wrapDeltaX, wrapDeltaY, wrapDist } from '../wrap.ts'
import { AMMO_SPOTS } from './landmarks.ts'
import type {
  PlayerState, CapturePoint, AmmoPack, SupplyCrate, Mortar, Watchtower, WarpPortal, WorldEvent, TeamId,
} from '../types.ts'

export interface InteractablesContext {
  players: PlayerState[]
  playerBroadBuckets: PlayerState[][]
  capturePoints: CapturePoint[]
  ammoPacks: AmmoPack[]
  supplyCrates: SupplyCrate[]
  mortars: Mortar[]
  watchtowers: Watchtower[]
  warpPortals: WarpPortal[]
  events: WorldEvent[]
  config: GameConfig
  rng: Rng
  nextAmmoId: () => number
  getAmmoTimer: () => number
  setAmmoTimer: (t: number) => void
}

/** 判定旗帜据点是否已被占领且可供该队伍玩家选作复活点（未占领时绝不可选） */
export function isCapturePointSelectable(cp: CapturePoint | undefined | null, team: TeamId): boolean {
  if (!cp) return false
  if (cp.ownerTeam === null || cp.progress < 100) return false
  return cp.ownerTeam === team || team === 'ffa'
}

/** 检测玩家当前靠近的可按 E 互动的目标信息（供 HUD 与移动端动态 E 键显隐使用） */
export function getNearbyInteractablePrompt(
  ctx: Pick<InteractablesContext, 'capturePoints' | 'mortars' | 'watchtowers' | 'warpPortals' | 'supplyCrates' | 'config'>,
  p: PlayerState,
  pendingSpawnId?: string | null,
): { canInteract: boolean; shortLabel: string; bannerText: string } | null {
  if (!p.deployed || !p.alive || p.respawnTimer > 0) return null

  const mountedMortar = ctx.mortars.find(m => m.operatorId === p.id)
  if (mountedMortar) {
    return {
      canInteract: true,
      shortLabel: '🎯 [E] 离开炮台',
      bannerText: '🎯 迫击炮操控中：拖动瞄准调节落点，开火发射 | 按 [E] 或点击此处离开',
    }
  }
  if (p.mountedTowerId) {
    return {
      canInteract: true,
      shortLabel: '🗼 [E] 下瞭望塔',
      bannerText: '🗼 瞭望塔上（视野 200%）：按 [E] 或点击此处下塔',
    }
  }

  for (const crate of ctx.supplyCrates) {
    if (crate.active && wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 95) {
      return {
        canInteract: true,
        shortLabel: `📦 [E] 拾取${crate.weaponName.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '')}`,
        bannerText: `📦 靠近特武箱：按 [E] 或直接触碰拾取【${crate.weaponName}】`,
      }
    }
  }

  const maxCpDist = Math.max(150, ctx.config.captureRadius + 35)
  let nearestCp: CapturePoint | null = null
  let nearestCpDist = Infinity
  for (const cp of ctx.capturePoints) {
    if (cp.y <= 400) continue
    if (Math.abs(wrapDeltaY(p.pos.y, cp.y)) > 115) continue
    const d = wrapDist(p.pos.x, p.pos.y, cp.x, cp.y)
    if (d < maxCpDist && d < nearestCpDist) {
      nearestCpDist = d
      nearestCp = cp
    }
  }
  if (nearestCp) {
    if (isCapturePointSelectable(nearestCp, p.team)) {
      const isSel = p.selectedSpawnId === nearestCp.id || pendingSpawnId === nearestCp.id
      return {
        canInteract: !isSel,
        shortLabel: isSel ? `✅ 已选 ${nearestCp.code}点` : `🚩 [E] 选${nearestCp.code}复活`,
        bannerText: isSel
          ? `✅ 已选中【${nearestCp.name}】作为复活点（阵亡后将在此处复活）`
          : `🚩 按 [E] 或点击按钮选中【${nearestCp.name}】作为复活点`,
      }
    }
    const curTeam = nearestCp.progress > 0 ? (nearestCp.ownerTeam ?? nearestCp.capturingTeam) : null
    const isNeutralizing = curTeam !== null && curTeam !== p.team
    return {
      canInteract: false,
      shortLabel: `🚩 占领${nearestCp.code} ${Math.round(nearestCp.progress)}%`,
      bannerText: isNeutralizing
        ? `🚩 正在夺取【${nearestCp.name}】(敌方进度 ${Math.round(nearestCp.progress)}% → 0% 后转为己方占领)`
        : `🚩 正在占领【${nearestCp.name}】(${Math.round(nearestCp.progress)}% → 100%) · 占领后可按 [E] 选为复活点`,
    }
  }

  for (const m of ctx.mortars) {
    if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
      return {
        canInteract: true,
        shortLabel: '🔥 [E] 操控迫击炮',
        bannerText: `🔥 按 [E] 或点击按钮操控【${m.name}】`,
      }
    }
  }

  for (const tw of ctx.watchtowers) {
    if (tw.operatorId === null && wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
      return {
        canInteract: true,
        shortLabel: '🗼 [E] 登瞭望塔',
        bannerText: `🗼 按 [E] 或点击按钮登上【${tw.name}】（享 200% 视野）`,
      }
    }
  }

  for (const wp of ctx.warpPortals) {
    if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90) {
      return {
        canInteract: true,
        shortLabel: '🌀 [E] 量子传送',
        bannerText: `🌀 按 [E] 或点击按钮启动【${wp.name}】量子传送`,
      }
    }
  }

  return null
}

/** 替身人偶回溯（死亡触发 或 10s 到期触发） */
export function recallDollState(
  events: WorldEvent[],
  p: PlayerState,
  mortars?: Mortar[],
  watchtowers?: Watchtower[],
): void {
  if (!p.doll) return
  const d = p.doll
  p.doll = null
  if (mortars) {
    for (const m of mortars) if (m.operatorId === p.id) m.operatorId = null
  }
  if (watchtowers) {
    for (const tw of watchtowers) if (tw.operatorId === p.id || tw.id === p.mountedTowerId) tw.operatorId = null
  }
  p.mountedTowerId = null
  p.watchtowerTimer = 0
  p.pos = { x: wrapX(d.pos.x), y: d.pos.y }
  p.vel = { x: 0, y: 0 }
  p.hp = Math.max(1, d.hp)
  p.shieldHp = d.shieldHp
  p.fuel = d.fuel
  p.weaponIndex = d.weaponIndex
  if (WEAPONS[d.weaponIndex] && !WEAPONS[d.weaponIndex].isSupplyOnly) p.lastPrimaryIndex = d.weaponIndex
  p.ammo = [...d.ammo]
  p.reserveAmmo = [...d.reserveAmmo]
  p.respawnTimer = 0
  p.alive = true
  events.push({ kind: 'doll_recall', x: p.pos.x, y: p.pos.y, playerId: p.id })
}

/** 玩家按 E 交互：迫击炮 / 瞭望塔 / 量子传送门 / 特武补给箱 / 占领后的旗帜复活点选中 */
export function handlePlayerInteract(ctx: InteractablesContext, p: PlayerState): void {
  if (p.respawnTimer > 0 || !p.alive) return
  const cur = ctx.mortars.find(m => m.operatorId === p.id)
  if (cur) {
    cur.operatorId = null
    p.vel.y = -270
    return
  }
  for (const m of ctx.mortars) {
    if (m.operatorId === null && wrapDist(p.pos.x, p.pos.y, m.x, m.y) < 115) {
      m.operatorId = p.id
      p.pos = { x: m.x, y: m.y - 16 }
      p.vel = { x: 0, y: 0 }
      return
    }
  }
  if (p.mountedTowerId) {
    const tw = ctx.watchtowers.find(t => t.id === p.mountedTowerId)
    if (tw) tw.operatorId = null
    p.mountedTowerId = null
    p.watchtowerTimer = 0
    p.vel = { x: 0, y: -160 }
    ctx.events.push({ kind: 'warp', x: p.pos.x, y: p.pos.y, playerId: p.id, weaponName: '离开瞭望塔' })
    return
  }
  for (const tw of ctx.watchtowers) {
    if (tw.operatorId === null && wrapDist(p.pos.x, p.pos.y, tw.x, tw.y) < 130) {
      tw.operatorId = p.id
      p.mountedTowerId = tw.id
      p.pos = { x: tw.x, y: tw.y - 150 + 12 }
      p.vel = { x: 0, y: 0 }
      p.onGround = false
      ctx.events.push({ kind: 'warp', x: tw.x, y: tw.y, playerId: p.id, weaponName: `登上${tw.name}（视野 200%）` })
      return
    }
  }
  for (const wp of ctx.warpPortals) {
    if (wrapDist(p.pos.x, p.pos.y, wp.x, wp.y) < 90 && p.warpCooldown <= 0) {
      const dest = ctx.warpPortals.find(w => w.id === wp.targetId)
      if (!dest) continue
      p.pos = { x: dest.x, y: dest.y - 60 }
      p.vel = { x: 0, y: 0 }
      p.warpCooldown = 2.5
      ctx.events.push({ kind: 'warp', x: dest.x, y: dest.y, playerId: p.id, weaponName: wp.name })
      return
    }
  }
  for (const crate of ctx.supplyCrates) {
    if (!crate.active) continue
    if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 95) {
      crate.active = false
      crate.respawnTimer = ctx.config.supplyRespawnTime
      if (crate.kind === 'doll') {
        p.dollCharges = Math.min(ctx.config.dollMaxCharges, p.dollCharges + 1)
      } else {
        p.weaponIndex = crate.weaponId
        p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (WEAPONS[crate.weaponId].fuelMult ?? 1))
        p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize
        p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve
      }
      ctx.events.push({
        kind: 'supply_pickup',
        playerId: p.id,
        playerName: p.name,
        weaponId: crate.kind === 'doll' ? -1 : crate.weaponId,
        weaponName: crate.weaponName,
        x: crate.x,
        y: crate.y,
      })
      return
    }
  }
  const maxSelectDist = Math.max(150, ctx.config.captureRadius + 35)
  let targetCp: CapturePoint | null = null
  let bestDist = Infinity
  for (const cp of ctx.capturePoints) {
    if (cp.y <= 400) continue
    if (!isCapturePointSelectable(cp, p.team)) continue
    if (Math.abs(wrapDeltaY(p.pos.y, cp.y)) > 115) continue
    const d = wrapDist(p.pos.x, p.pos.y, cp.x, cp.y)
    if (d < maxSelectDist && d < bestDist) {
      bestDist = d
      targetCp = cp
    }
  }
  if (targetCp) {
    p.selectedSpawnId = targetCp.id
    ctx.events.push({
      kind: 'warp',
      x: targetCp.x,
      y: targetCp.y,
      playerId: p.id,
      pointCode: targetCp.code,
      weaponName: `已选中【${targetCp.name}】作为复活点`,
    })
  }
}

export function spawnSingleAmmoPack(ctx: InteractablesContext): void {
  if (ctx.ammoPacks.length >= ctx.config.ammoPackMaxActive) return
  const available: number[] = []
  for (let i = 0; i < AMMO_SPOTS.length; i++) {
    if (!ctx.ammoPacks.some(a => a.x === AMMO_SPOTS[i].x)) available.push(i)
  }
  if (available.length === 0) return
  const spot = AMMO_SPOTS[ctx.rng.pick(available)]
  ctx.ammoPacks.push({ id: ctx.nextAmmoId(), x: spot.x, y: spot.y, area: spot.area })
}

export function stepMapInteractables(ctx: InteractablesContext, dt: number): void {
  // 1. 占领点（零对象/数组分配标量统计，消除每帧 10 次 Object.entries 与 sort 分配）
  const capR = Math.max(150, ctx.config.captureRadius + 35)
  const capRSq = capR * capR
  for (let ci = 0; ci < ctx.capturePoints.length; ci++) {
    const cp = ctx.capturePoints[ci]
    if (cp.y <= 400) continue
    let cRed = 0, cBlue = 0, cGreen = 0, cFfa = 0
    for (let i = 0; i < ctx.players.length; i++) {
      const p = ctx.players[i]
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
      const dx = Math.abs(wrapDeltaX(p.pos.x, cp.x))
      if (dx >= capR) continue
      const dy = wrapDeltaY(cp.y, p.pos.y)
      if (dy > 28 || dy < -115) continue
      if (dx * dx + dy * dy < capRSq) {
        if (p.team === 'red') cRed++
        else if (p.team === 'blue') cBlue++
        else if (p.team === 'green') cGreen++
        else cFfa++
      }
    }
    let topTeam: TeamId | null = null
    let topCount = 0
    let secondCount = 0
    const considerTeam = (tm: TeamId, cnt: number): void => {
      if (cnt <= 0) return
      if (cnt > topCount) {
        secondCount = topCount
        topCount = cnt
        topTeam = tm
      } else if (cnt > secondCount) {
        secondCount = cnt
      }
    }
    considerTeam('red', cRed)
    considerTeam('blue', cBlue)
    considerTeam('green', cGreen)
    considerTeam('ffa', cFfa)

    if (topTeam !== null) {
      const t = topTeam as TeamId
      const netCount = topCount - secondCount
      if (netCount > 0) {
        const delta = ctx.config.captureRate * dt * netCount
        const curTeam = cp.progress > 0 ? (cp.ownerTeam ?? cp.capturingTeam) : null
        if (curTeam !== null && curTeam !== t) {
          cp.capturingTeam = curTeam
          if (cp.progress > delta) {
            cp.progress -= delta
          } else {
            const overflow = delta - cp.progress
            cp.ownerTeam = null
            if (overflow > 0) {
              cp.capturingTeam = t
              cp.progress = Math.min(100, overflow)
              if (cp.progress >= 100) {
                cp.progress = 100
                cp.ownerTeam = t
                ctx.events.push({ kind: 'capture', pointCode: cp.code, team: t, x: cp.x, y: cp.y })
              }
            } else {
              cp.capturingTeam = null
              cp.progress = 0
            }
          }
        } else if (cp.ownerTeam !== t || cp.progress < 100) {
          cp.capturingTeam = t
          cp.progress += delta
          if (cp.progress >= 100) {
            cp.progress = 100
            const newlyCaptured = cp.ownerTeam !== t
            cp.ownerTeam = t
            cp.capturingTeam = t
            if (newlyCaptured) {
              ctx.events.push({ kind: 'capture', pointCode: cp.code, team: t, x: cp.x, y: cp.y })
            }
          }
        }
      }
    }
  }

  // 2. 迫击炮冷却
  for (let i = 0; i < ctx.mortars.length; i++) {
    const m = ctx.mortars[i]
    if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt)
  }

  // 3. 补给箱
  for (let ci = 0; ci < ctx.supplyCrates.length; ci++) {
    const crate = ctx.supplyCrates[ci]
    if (!crate.active && crate.respawnTimer > 0) {
      crate.respawnTimer -= dt
      if (crate.respawnTimer <= 0) crate.active = true
    }
    if (!crate.active) continue
    for (let i = 0; i < ctx.players.length; i++) {
      const p = ctx.players[i]
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
      if (Math.abs(wrapDeltaX(p.pos.x, crate.x)) >= 56 || Math.abs(p.pos.y - crate.y) >= 56) continue
      if (wrapDist(p.pos.x, p.pos.y, crate.x, crate.y) < 56) {
        crate.active = false
        crate.respawnTimer = ctx.config.supplyRespawnTime
        if (crate.kind === 'doll') {
          p.dollCharges = Math.min(ctx.config.dollMaxCharges, p.dollCharges + 1)
        } else {
          p.weaponIndex = crate.weaponId
          p.fuel = Math.min(p.fuel, getPhysicsParams().jetpackFuel * (WEAPONS[crate.weaponId].fuelMult ?? 1))
          p.ammo[crate.weaponId] = WEAPONS[crate.weaponId].magSize
          p.reserveAmmo[crate.weaponId] = WEAPONS[crate.weaponId].maxReserve
        }
        ctx.events.push({
          kind: 'supply_pickup',
          playerId: p.id,
          playerName: p.name,
          weaponId: crate.kind === 'doll' ? -1 : crate.weaponId,
          weaponName: crate.weaponName,
          x: crate.x, y: crate.y,
        })
        break
      }
    }
  }

  // 4. 弹药刷新与拾取
  let timer = ctx.getAmmoTimer() + dt
  if (timer >= ctx.config.ammoPackInterval) {
    timer = 0
    spawnSingleAmmoPack(ctx)
  }
  ctx.setAmmoTimer(timer)

  for (let i = ctx.ammoPacks.length - 1; i >= 0; i--) {
    const pack = ctx.ammoPacks[i]
    for (let pi = 0; pi < ctx.players.length; pi++) {
      const p = ctx.players[pi]
      if (p.respawnTimer > 0 || !p.deployed || !p.alive) continue
      if (Math.abs(wrapDeltaX(p.pos.x, pack.x)) >= 52 || Math.abs(p.pos.y - pack.y) >= 52) continue
      if (wrapDist(p.pos.x, p.pos.y, pack.x, pack.y) < 52) {
        const wep = WEAPONS[p.weaponIndex]
        p.reserveAmmo[p.weaponIndex] = Math.min(wep.maxReserve * 2, (p.reserveAmmo[p.weaponIndex] || 0) + wep.maxReserve)
        ctx.ammoPacks.splice(i, 1)
        ctx.events.push({ kind: 'ammo_pickup', playerId: p.id, x: pack.x, y: pack.y })
        break
      }
    }
  }
}
