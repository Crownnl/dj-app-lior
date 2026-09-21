import { Capacitor } from '@capacitor/core'

/**
 * Best-effort native bootstrap for the Capacitor-wrapped app. No-ops
 * completely in a plain browser (Capacitor.isNativePlatform() is false
 * there), so this is always safe to call from web too.
 */
export async function initNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setOverlaysWebView({ overlay: true })
  } catch {
    /* status bar plugin not available on this platform/build — fine to skip */
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    /* splash screen plugin not available — fine to skip */
  }
}
