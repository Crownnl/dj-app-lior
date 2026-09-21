import type { AudioEngineContext } from '../engine/AudioEngine'
import type { DeckController, DeckId, EQBand, Track } from '../types'

/**
 * SoundCloud playback backend.
 *
 * SoundCloud never exposes raw decodable audio to third-party pages, so this
 * controller drives the official embeddable Widget API (an <iframe> running
 * SoundCloud's own player) instead of the Web Audio graph. It never calls
 * ctx.connectSource — there is no audio signal on the page to connect.
 */

// --- Minimal shape of the SoundCloud Widget API (window.SC), loaded at
// runtime from a <script> tag — there is no npm package for this. ---
interface SCWidgetEvents {
  PLAY: string
  PAUSE: string
  FINISH: string
  ERROR: string
  READY: string
  PLAY_PROGRESS: string
}

interface SCWidgetProgressData {
  currentPosition: number
  relativePosition?: number
  loadedProgress?: number
}

interface SCWidget {
  bind(eventName: string, cb: (data?: SCWidgetProgressData) => void): void
  unbind(eventName: string): void
  play(): void
  pause(): void
  seekTo(milliseconds: number): void
  setVolume(volume: number): void
  getDuration(cb: (ms: number) => void): void
  getPosition(cb: (ms: number) => void): void
}

interface SCNamespace {
  Widget: {
    (iframe: HTMLIFrameElement): SCWidget
    Events: SCWidgetEvents
  }
}

declare global {
  interface Window {
    SC?: SCNamespace
  }
}

const WIDGET_SCRIPT_URL = 'https://w.soundcloud.com/player/api.js'

// Module-level singleton: the widget script is only ever injected once for
// the whole app, no matter how many decks/controllers get created.
let widgetApiPromise: Promise<SCNamespace> | null = null

function loadWidgetApi(): Promise<SCNamespace> {
  if (window.SC) return Promise.resolve(window.SC)
  if (widgetApiPromise) return widgetApiPromise

  widgetApiPromise = new Promise<SCNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SCRIPT_URL}"]`)
    const onLoad = () => {
      if (window.SC) resolve(window.SC)
      else reject(new Error('SoundCloud widget script geladen maar SC niet beschikbaar'))
    }
    const onError = () => reject(new Error('Kon SoundCloud widget script niet laden'))

    if (existing) {
      existing.addEventListener('load', onLoad, { once: true })
      existing.addEventListener('error', onError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = WIDGET_SCRIPT_URL
    script.async = true
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    document.head.appendChild(script)
  })

  return widgetApiPromise
}

/** Resolve a public SoundCloud track page URL into a playable Track via oEmbed (no API key required). */
export async function resolveSoundCloudUrl(url: string): Promise<Track> {
  const trimmed = url.trim()
  if (!/^https?:\/\/(www\.)?(m\.)?soundcloud\.com\//i.test(trimmed)) {
    throw new Error('Dit lijkt geen geldige SoundCloud-link. Plak een link zoals https://soundcloud.com/artiest/nummer')
  }

  let response: Response
  try {
    response = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(trimmed)}`)
  } catch {
    throw new Error('Kon geen verbinding maken met SoundCloud. Controleer je internetverbinding en probeer opnieuw.')
  }

  if (!response.ok) {
    throw new Error('SoundCloud kon deze track niet vinden. Controleer of de link klopt en publiek is.')
  }

  let data: { title?: string; author_name?: string; thumbnail_url?: string }
  try {
    data = await response.json()
  } catch {
    throw new Error('SoundCloud gaf een onverwacht antwoord terug. Probeer het later opnieuw.')
  }

  const rawTitle = data.title?.trim() || 'Onbekende track'
  const separatorIndex = rawTitle.indexOf(' - ')
  let title = rawTitle
  let artist = data.author_name?.trim()
  if (separatorIndex > 0) {
    artist = rawTitle.slice(0, separatorIndex).trim()
    title = rawTitle.slice(separatorIndex + 3).trim()
  }

  return {
    id: crypto.randomUUID(),
    title,
    artist,
    artworkUrl: data.thumbnail_url,
    source: 'soundcloud',
    soundcloudUrl: trimmed,
    addedAt: Date.now(),
  }
}

function createHiddenIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  // Invisible but NOT display:none — some browsers throttle or fully stop
  // playback in display:none iframes, which would silently kill the deck.
  iframe.style.position = 'fixed'
  iframe.style.width = '2px'
  iframe.style.height = '2px'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  iframe.style.bottom = '0'
  iframe.style.right = '0'
  iframe.style.border = '0'
  iframe.setAttribute('allow', 'autoplay')
  return iframe
}

/** DeckController backend for 'soundcloud' sources, driven by the SoundCloud Widget API (iframe embed). */
export function createSoundCloudController(deckId: DeckId, _ctx: AudioEngineContext): DeckController {
  let iframe: HTMLIFrameElement | null = null
  let widget: SCWidget | null = null
  let scEvents: SCWidgetEvents | null = null

  let cachedCurrentTime = 0
  let cachedDuration = 0

  const timeListeners = new Set<(t: number) => void>()
  const endedListeners = new Set<() => void>()
  const loadedListeners = new Set<(d: number) => void>()

  function teardownWidget() {
    if (widget && scEvents) {
      for (const eventName of [scEvents.READY, scEvents.ERROR, scEvents.FINISH, scEvents.PLAY_PROGRESS]) {
        try {
          widget.unbind(eventName)
        } catch {
          /* SC widget may already be torn down (iframe removed) */
        }
      }
    }
    widget = null
    scEvents = null
    if (iframe) {
      iframe.remove()
      iframe = null
    }
  }

  return {
    deckId,
    supportsEQ: false,
    supportsAnalysis: false,

    async load(track: Track) {
      if (!track.soundcloudUrl) throw new Error('Track heeft geen SoundCloud-URL')

      teardownWidget()
      cachedCurrentTime = 0
      cachedDuration = 0

      const SC = await loadWidgetApi()

      const newIframe = createHiddenIframe()
      newIframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.soundcloudUrl)}&auto_play=false&show_artwork=false&visual=false`
      document.body.appendChild(newIframe)
      iframe = newIframe

      const newWidget = SC.Widget(newIframe)
      widget = newWidget
      scEvents = SC.Widget.Events

      await new Promise<void>((resolve, reject) => {
        let settled = false

        newWidget.bind(SC.Widget.Events.ERROR, () => {
          if (settled) return
          settled = true
          reject(new Error('SoundCloud kon deze track niet afspelen'))
        })

        newWidget.bind(SC.Widget.Events.READY, () => {
          newWidget.getDuration((ms) => {
            cachedDuration = ms / 1000
            loadedListeners.forEach((cb) => cb(cachedDuration))
          })

          newWidget.bind(SC.Widget.Events.FINISH, () => {
            endedListeners.forEach((cb) => cb())
          })

          newWidget.bind(SC.Widget.Events.PLAY_PROGRESS, (data) => {
            if (!data) return
            cachedCurrentTime = data.currentPosition / 1000
            timeListeners.forEach((cb) => cb(cachedCurrentTime))
          })

          if (!settled) {
            settled = true
            resolve()
          }
        })
      })
    },

    play() {
      widget?.play()
    },
    pause() {
      widget?.pause()
    },
    seek(seconds: number) {
      const clamped = Math.max(0, seconds)
      cachedCurrentTime = clamped
      widget?.seekTo(clamped * 1000)
    },
    setVolume(v: number) {
      widget?.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100))
    },
    setPlaybackRate() {
      // No-op: the SoundCloud widget does not support playback rate / pitch
      // changes. This is a real platform limitation, not a bug.
    },
    getCurrentTime() {
      return cachedCurrentTime
    },
    getDuration() {
      return cachedDuration
    },
    setEQ(_band: EQBand, _value: number) {
      // No-op: supportsEQ is false, SoundCloud audio never reaches our graph.
    },
    setGainTrim() {
      // No-op: supportsEQ is false.
    },
    onTimeUpdate(cb) {
      timeListeners.add(cb)
      return () => timeListeners.delete(cb)
    },
    onEnded(cb) {
      endedListeners.add(cb)
      return () => endedListeners.delete(cb)
    },
    onLoaded(cb) {
      loadedListeners.add(cb)
      return () => loadedListeners.delete(cb)
    },
    destroy() {
      teardownWidget()
      timeListeners.clear()
      endedListeners.clear()
      loadedListeners.clear()
    },
  }
}
