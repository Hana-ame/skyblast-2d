// web/app/audio.ts —— 零外部依赖 WebAudio 过程式战术音效合成器（带节流与节点自动释放，防止长时间运行累积）
import { featureFlags } from './context.ts'

let audioCtx: AudioContext | null = null
let lastShootMs = 0

function getAudioCtx(): AudioContext | null {
  if (!featureFlags.proceduralAudio) return null
  if (typeof window === 'undefined') return null
  const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!Ctor) return null
  if (!audioCtx) {
    try {
      audioCtx = new Ctor()
    } catch {
      return null
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

function playTone(
  ctx: AudioContext,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  vol: number,
  delay = 0,
): void {
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(Math.max(20, Math.min(8000, f0)), t0)
  if (f1 !== f0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, Math.min(8000, f1)), t0 + Math.max(0.01, dur * 0.9))
  }
  gain.gain.setValueAtTime(vol, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.onended = () => {
    try {
      osc.disconnect()
      gain.disconnect()
    } catch { /* ignore */ }
  }
  osc.start(t0)
  osc.stop(t0 + dur + 0.005)
}

export type ProceduralSoundKind =
  | 'shoot'
  | 'laser'
  | 'headshot'
  | 'kill'
  | 'explosion'
  | 'shield_break'
  | 'supply'

export function playProceduralSound(kind: ProceduralSoundKind, pitchHint = 1): void {
  if (!featureFlags.proceduralAudio) return
  const ctx = getAudioCtx()
  if (!ctx) return

  try {
    if (kind === 'shoot') {
      const ms = typeof performance !== 'undefined' ? performance.now() : 0
      if (ms - lastShootMs < 35) return
      lastShootMs = ms
      playTone(ctx, 'triangle', 260 * pitchHint, 68, 0.07, 0.055)
      return
    }
    if (kind === 'laser') {
      playTone(ctx, 'sawtooth', 880, 220, 0.13, 0.05)
      return
    }
    if (kind === 'headshot') {
      playTone(ctx, 'sine', 1180, 1560, 0.14, 0.075)
      return
    }
    if (kind === 'kill') {
      playTone(ctx, 'triangle', 587.33, 587.33, 0.12, 0.065, 0)
      playTone(ctx, 'triangle', 880, 880, 0.12, 0.065, 0.055)
      return
    }
    if (kind === 'shield_break') {
      playTone(ctx, 'sawtooth', 740, 140, 0.17, 0.06)
      return
    }
    if (kind === 'supply') {
      playTone(ctx, 'sine', 440, 880, 0.17, 0.06)
      return
    }
    if (kind === 'explosion') {
      playTone(ctx, 'sawtooth', 120, 28, 0.24, 0.085)
    }
  } catch {
    // 忽略浏览器音频上下文限制异常
  }
}
