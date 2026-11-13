// web/fullscreen.ts —— 全屏 API + 自动横屏锁定 + 竖屏自动旋转适配 + PWA 手机安装管理
let pseudoFullscreen = false
let autoLandscapeRotated = false

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt
}

export function clearDeferredInstallPrompt(): void {
  deferredInstallPrompt = null
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as unknown as { standalone?: boolean }
  const matchStandalone = window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)')?.matches
  return Boolean(nav.standalone || matchStandalone)
}

export function isMobileOrTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
  const touch = ('ontouchstart' in window) || ((navigator?.maxTouchPoints ?? 0) > 0)
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  const mobileUa = /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua)
  return Boolean(coarse || mobileUa || (touch && Math.min(window.innerWidth || 1024, window.innerHeight || 768) <= 1024))
}

export function isAutoLandscapeRotated(): boolean {
  return autoLandscapeRotated
}

/** 尝试调用系统级 Screen Orientation API 锁定横屏（Android Chrome / WebView / 已安装 PWA 原生生效） */
export function tryLockScreenLandscape(): void {
  if (typeof screen === 'undefined') return
  try {
    const scr = screen as unknown as {
      orientation?: { lock?: (o: string) => Promise<void> }
      lockOrientation?: (o: string) => boolean
      mozLockOrientation?: (o: string) => boolean
      msLockOrientation?: (o: string) => boolean
    }
    if (scr.orientation && typeof scr.orientation.lock === 'function') {
      scr.orientation.lock('landscape').catch(() => {
        scr.orientation?.lock?.('landscape-primary')?.catch(() => {})
      })
    } else {
      scr.lockOrientation?.('landscape')
      scr.mozLockOrientation?.('landscape')
      scr.msLockOrientation?.('landscape')
    }
  } catch { /* ignore */ }
}

/**
 * 同步移动端横屏状态：
 * - 若设备支持原生横屏锁定且已处于横屏（innerWidth >= innerHeight），移除 CSS 旋转；
 * - 若在手机端但物理视口仍为竖屏（如 iOS Safari 或系统锁定了方向，innerWidth < innerHeight），
 *   自动为 body 启用 `.auto-landscape-rotated` 90° 横屏旋转，保证任何手机打开即全屏横屏！
 */
export function syncLandscapeOrientation(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return false
  const iw = window.innerWidth || document.documentElement?.clientWidth || 1024
  const ih = window.innerHeight || document.documentElement?.clientHeight || 640
  const shouldRotate = isMobileOrTouchDevice() && iw < ih
  autoLandscapeRotated = shouldRotate
  if (document.body.classList) {
    document.body.classList.toggle('auto-landscape-rotated', shouldRotate)
  }
  return shouldRotate
}

/**
 * 将浏览器原始事件坐标 (clientX, clientY) 转换为元素内部局部横屏坐标及中心偏移
 * 兼容常规横屏与 `.auto-landscape-rotated` (CSS 90° 顺时针旋转)
 */
export function getElementLandscapeMetrics(
  el: HTMLElement | HTMLCanvasElement,
  clientX: number,
  clientY: number,
): {
  relX: number
  relY: number
  width: number
  height: number
  dxFromCenter: number
  dyFromCenter: number
} {
  const rect = el.getBoundingClientRect()
  if (autoLandscapeRotated) {
    // CSS rotate(90deg) 下：屏幕纵向 (rect.height) 对应游戏水平宽度，屏幕横向 (rect.width) 对应游戏垂直高度
    const width = Math.max(1, rect.height)
    const height = Math.max(1, rect.width)
    const relX = clientY - rect.top
    const relY = rect.right - clientX
    const rawDx = clientX - (rect.left + rect.width / 2)
    const rawDy = clientY - (rect.top + rect.height / 2)
    return {
      relX,
      relY,
      width,
      height,
      dxFromCenter: rawDy,
      dyFromCenter: -rawDx,
    }
  }
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  return {
    relX: clientX - rect.left,
    relY: clientY - rect.top,
    width,
    height,
    dxFromCenter: clientX - (rect.left + rect.width / 2),
    dyFromCenter: clientY - (rect.top + rect.height / 2),
  }
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return pseudoFullscreen
  const d = document as unknown as {
    fullscreenElement?: Element | null
    webkitFullscreenElement?: Element | null
  }
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement) || pseudoFullscreen
}

/** 一键进入全屏并锁定横屏（含原生 Fullscreen + Screen Orientation Lock + 伪全屏与自动旋转兜底） */
export function enterFullscreenAndLandscape(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as unknown as {
    requestFullscreen?: (opts?: { navigationUI?: string }) => Promise<void>
    webkitRequestFullscreen?: () => void
  }
  pseudoFullscreen = true
  document.body?.classList?.add('pseudo-fullscreen')
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.()
    if (p && typeof (p as Promise<void>).catch === 'function') {
      ;(p as Promise<void>)
        .then(() => {
          tryLockScreenLandscape()
          syncLandscapeOrientation()
        })
        .catch(() => {
          tryLockScreenLandscape()
          syncLandscapeOrientation()
        })
    } else {
      tryLockScreenLandscape()
    }
  } catch {
    tryLockScreenLandscape()
  }
  syncLandscapeOrientation()
  try {
    window.scrollTo?.(0, 1)
  } catch { /* ignore */ }
  return true
}

export function toggleFullscreen(): boolean {
  const d = document as unknown as {
    exitFullscreen?: () => Promise<void>
    webkitExitFullscreen?: () => void
  }
  if (isFullscreen()) {
    pseudoFullscreen = false
    document.body?.classList?.remove('pseudo-fullscreen')
    try {
      const p = d.exitFullscreen?.() ?? d.webkitExitFullscreen?.()
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {})
    } catch { /* ignore */ }
    syncLandscapeOrientation()
    return false
  } else {
    return enterFullscreenAndLandscape()
  }
}

/** 初始化 PWA Service Worker、安装拦截与移动端自动全屏横屏守卫 */
export function setupMobilePwaAndAutoLandscape(onViewportUpdate?: () => void): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  // 1. 注册 Service Worker（支持 HTTPS / localhost 下的手机安装）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {})
    })
  }

  // 2. 捕获 beforeinstallprompt 事件以支持一键触发原生安装弹窗
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    deferredInstallPrompt = e as BeforeInstallPromptEvent
    const btn = document.getElementById('pwaInstallBtn')
    if (btn) btn.classList.remove('hidden')
    const lobbyBtn = document.getElementById('lobbyInstallAppBtn')
    if (lobbyBtn) lobbyBtn.classList.remove('hidden')
  })

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    enterFullscreenAndLandscape()
    onViewportUpdate?.()
  })

  // 3. 初始检测与窗口旋转同步
  syncLandscapeOrientation()
  if (isMobileOrTouchDevice() || isStandaloneApp()) {
    document.body?.classList?.add('pseudo-fullscreen')
    tryLockScreenLandscape()
  }

  const handleOrientOrResize = (): void => {
    syncLandscapeOrientation()
    onViewportUpdate?.()
  }
  window.addEventListener('resize', handleOrientOrResize)
  window.addEventListener('orientationchange', handleOrientOrResize)
  document.addEventListener('fullscreenchange', handleOrientOrResize)

  // 4. 移动端首次触摸/点击时自动请求原生全屏与横屏锁定（满足浏览器用户手势要求）
  const onFirstMobileGesture = (ev: Event): void => {
    if (!isMobileOrTouchDevice()) return
    const target = ev.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    if (!isFullscreen()) {
      enterFullscreenAndLandscape()
      onViewportUpdate?.()
    } else {
      tryLockScreenLandscape()
      syncLandscapeOrientation()
    }
  }
  window.addEventListener('touchstart', onFirstMobileGesture, { passive: true })
  window.addEventListener('click', onFirstMobileGesture, { passive: true })
}

export interface Viewport {
  /** 屏幕(px) → 逻辑世界坐标 */
  toWorld: (clientX: number, clientY: number) => { x: number; y: number }
  /** 每帧渲染前应调用的 transform 设置（含 DPR 缩放） */
  applyTransform: () => void
}

/**
 * 把 canvas 铺满窗口；内部分辨率 = logical × devicePixelRatio；
 * 返回坐标换算与每帧 transform 设置。监听 resize/orientationchange。
 */
export function fitCanvas(canvas: HTMLCanvasElement, logicalW: number, logicalH: number): Viewport {
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1

  const resize = (): void => {
    syncLandscapeOrientation()
    canvas.width = Math.max(1, Math.round(logicalW * dpr))
    canvas.height = Math.max(1, Math.round(logicalH * dpr))
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('orientationchange', resize)

  document.body.style.touchAction = 'none'
  document.body.style.overflow = 'hidden'

  return {
    toWorld: (clientX, clientY) => {
      const m = getElementLandscapeMetrics(canvas, clientX, clientY)
      return {
        x: (m.relX / m.width) * logicalW,
        y: (m.relY / m.height) * logicalH,
      }
    },
    applyTransform: () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    },
  }
}
