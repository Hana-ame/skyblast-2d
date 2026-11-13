// web/input/device.ts —— 输入设备检测 / 触屏手柄层显隐 / 键鼠与手柄互斥防冲突
import { touchState } from '../app/context.ts'

const TOUCH_PREF_KEY = 'sb2-touch-enabled'

export function updateInputModeBadge(isTouchMode: boolean, _isAuto: boolean): void {
  const badge = document.getElementById('inputDeviceDetectBadge')
  if (badge) {
    if (isTouchMode) {
      badge.textContent = '🎮 手柄：开'
      badge.className = 'px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-sky-500/25 text-sky-200 border border-sky-400/50 hover:bg-sky-500/35 transition'
    } else {
      badge.textContent = '💻 键鼠（手柄已关）'
      badge.className = 'px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition'
    }
  }

  const toggleBtn = document.getElementById('toggleTouchBtn')
  if (toggleBtn) {
    toggleBtn.textContent = isTouchMode ? '🎮 手柄：开' : '🎮 手柄：关'
  }

  const kbmBtn = document.getElementById('lobbyCtrlKbmBtn')
  const padBtn = document.getElementById('lobbyCtrlGamepadBtn')
  if (kbmBtn) {
    kbmBtn.className = !isTouchMode
      ? 'px-2.5 py-1.5 rounded-lg border-2 border-emerald-400 bg-emerald-500/20 text-emerald-200 font-extrabold text-xs transition'
      : 'px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500 font-semibold text-xs transition'
  }
  if (padBtn) {
    padBtn.className = isTouchMode
      ? 'px-2.5 py-1.5 rounded-lg border-2 border-sky-400 bg-sky-500/20 text-sky-200 font-extrabold text-xs transition'
      : 'px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500 font-semibold text-xs transition'
  }
}

export function setTouchLayerVisible(visible: boolean, isAuto = false): void {
  touchState.enabled = visible
  if (!visible) {
    touchState.moveActive = false
    touchState.moveId = -1
    touchState.moveX = 0
    touchState.moveY = 0
    touchState.aimActive = false
    touchState.aimId = -1
    touchState.aimX = 0
    touchState.aimY = 0
    touchState.wasGroundedBeforeAscend = false
    touchState.aimUsed = false
  }
  if (!isAuto) {
    try {
      localStorage.setItem(TOUCH_PREF_KEY, visible ? '1' : '0')
    } catch { /* ignore */ }
  }
  const layer = document.getElementById('touchControlsLayer')
  if (layer) layer.classList.toggle('hidden', !visible)
  updateInputModeBadge(visible, isAuto)
}

export function autoDetectDeviceInput(): void {
  try {
    const saved = localStorage.getItem(TOUCH_PREF_KEY)
    if (saved === '0') {
      setTouchLayerVisible(false, true)
      return
    }
    if (saved === '1') {
      setTouchLayerVisible(true, true)
      return
    }
  } catch { /* ignore */ }
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  const touchPoints = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  setTouchLayerVisible(Boolean(coarse || (touchPoints && window.innerWidth <= 1024)), true)
}
