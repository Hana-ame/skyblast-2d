// web/app/events.ts —— 权威世界事件 → 表现层（killfeed/特效/震颤/光束/死亡信息）
import type { WorldEvent } from '../../core/types.ts'
import {
  screenFx, localPlayer, pendingLoadout, effects, beams, world,
} from './context.ts'
import { isSecondaryUnlocked } from '../../core/weapons.ts'
import { updateHudWeaponButtons } from './hud.ts'
import { TEAM_PALETTE } from '../sprites.ts'
import { addKillFeed, showToast } from './toast.ts'
import { playProceduralSound } from './audio.ts'

/** 本机最近一次死亡信息（死亡界面显示击杀者） */
export const death = { info: null as { killer: string; weapon: string } | null }

export function handleEvents(evs: WorldEvent[]): void {
  for (const e of evs) {
    if (e.kind === 'kill') {
      // 联机二进制协议为省流可能只带 id → 名字/队伍按 id 反查本地快照兜底
      const killer = e.killerId ?? e.attackerId
      const killerP = killer !== undefined ? world.players.find(p => p.id === killer) : undefined
      const victimP = e.victimId !== undefined ? world.players.find(p => p.id === e.victimId) : undefined
      const kName = e.killerName ?? killerP?.name ?? '战场环境'
      const kTeam = e.killerTeam ?? killerP?.team ?? 'ffa'
      const vName = e.victimName ?? victimP?.name ?? '?'
      const vTeam = e.victimTeam ?? victimP?.team ?? 'ffa'
      addKillFeed(kName, kTeam, vName, vTeam, e.weaponLabel ?? '', e.isHeadshot ?? e.headshot, e.isPierced)
      playProceduralSound((e.isHeadshot ?? e.headshot) ? 'headshot' : 'kill')
      if ((e.killerId === localPlayer.id || e.attackerId === localPlayer.id) && !isSecondaryUnlocked(pendingLoadout.secondaryType, localPlayer.deathStreak ?? 0, localPlayer.dollCharges ?? 0, localPlayer.weaponIndex)) {
        pendingLoadout.secondaryType = 'frag'
        localPlayer.secondary = 'frag'
        updateHudWeaponButtons()
      }
      if (e.victimId === localPlayer.id) death.info = { killer: kName, weapon: e.weaponLabel ?? '' }
      if (e.x !== undefined && e.y !== undefined) effects.killBurst(e.x, e.y, TEAM_PALETTE[vTeam]?.light ?? '#fda4af')
    } else if (e.kind === 'explosion') {
      screenFx.shake = Math.max(screenFx.shake, Math.min(14, (e.radius ?? 60) * 0.15))
      playProceduralSound('explosion')
      if (e.x !== undefined && e.y !== undefined) effects.explosion(e.x, e.y, e.radius ?? 60)
    } else if (e.kind === 'obstacle_destroy') {
      if (e.x !== undefined && e.y !== undefined) effects.debris(e.x, e.y, 50, 60, '#9a3412', '#f97316')
    } else if (e.kind === 'capture') {
      showToast(`🚩 据点 ${e.pointCode} 被 ${e.team} 占领！`)
    }
    else if (e.kind === 'supply_pickup') {
      // 显示是谁拾取的（联机时按 playerId 从本地快照反查，缺失则退化为"某玩家"）
      // 名字来源优先级：事件自带 playerName（服务端权威，联机最可靠）> 本地快照反查
      const picker = e.playerId !== undefined ? world.players.find(p => p.id === e.playerId) : undefined
      const who = e.playerName ?? picker?.name
      const isSelf = e.playerId !== undefined && e.playerId === localPlayer.id
      showToast(who
        ? `📦 ${isSelf ? '你' : who} 拾取了【${e.weaponName}】`
        : `📦 拾取【${e.weaponName}】`)
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#a5f3fc')
      if (isSelf) playProceduralSound('supply')
    } else if (e.kind === 'ammo_pickup') {
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#4ade80')
    } else if (e.kind === 'doll_recall') {
      if (e.playerId === undefined || e.playerId === localPlayer.id) {
        showToast('🎎 替身人偶生效：回到锚点位置与状态！')
      }
      if (e.x !== undefined && e.y !== undefined) effects.sparkle(e.x, e.y, '#f472b6')
    } else if (e.kind === 'shield_break') {
      if (e.playerId === undefined || e.playerId === localPlayer.id) {
        showToast('💥 护盾破碎！')
        playProceduralSound('shield_break')
      }
    }
    else if (e.kind === 'mortar_fire') {
      screenFx.shake = Math.max(screenFx.shake, 9)
      if (e.x !== undefined && e.y !== undefined) effects.muzzle(e.x, e.y - 20, '#fde047')
    } else if (e.kind === 'airstrike_drop') {
      if (e.x !== undefined && e.y !== undefined) {
        effects.explosion(e.x, e.y, 120)
        screenFx.shake = Math.max(screenFx.shake, 12)
      }
    } else if (e.kind === 'laser') {
      if (e.segments && e.segments.length > 0) {
        const dur = e.duration ?? 0.14
        beams.push({ segments: e.segments, color: e.color ?? '#22d3ee', life: dur, maxLife: dur })
        if (beams.length > 24) beams.shift()
      }
      screenFx.shake = Math.max(screenFx.shake, 1.5)
      playProceduralSound('laser')
    } else if (e.kind === 'warp') {
      if (e.playerId === undefined || e.playerId === localPlayer.id) showToast(`🌀 ${e.weaponName ?? '传送'}！`)
    }
  }
}

