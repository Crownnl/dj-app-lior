// Spotify DeckController backend, built on the Spotify Web Playback SDK.
// Spotify never exposes raw decodable audio to the page (DRM/ToS, not an
// oversight), so this controller never touches AudioEngine's Web Audio graph
// — it manages its own volume and reports supportsEQ = supportsAnalysis = false.
import type { AudioEngineContext } from '../engine/AudioEngine'
import type { DeckController, DeckId, EQBand, Track } from '../types'
import { getValidSpotifyAccessToken, isSpotifyAuthorized } from './spotifyAuth'

// Minimal ambient shape of the Web Playback SDK we actually use. Deliberately
// hand-written (no @types/spotify-web-playback-sdk installed).
declare global {
  namespace Spotify {
    interface PlayerInit {
      name: string
      getOAuthToken: (cb: (token: string) => void) => void
      volume?: number
    }

    interface PlaybackState {
      position: number
      duration: number
      paused: boolean
    }

    interface PlayerReadyEvent {
      device_id: string
    }

    class Player {
      constructor(options: PlayerInit)
      connect(): Promise<boolean>
      disconnect(): void
      pause(): Promise<void>
      resume(): Promise<void>
      seek(positionMs: number): Promise<void>
      setVolume(volume: number): Promise<void>
      getCurrentState(): Promise<PlaybackState | null>
      addListener(event: 'ready' | 'not_ready', cb: (event: PlayerReadyEvent) => void): void
      addListener(event: 'player_state_changed', cb: (state: PlaybackState | null) => void): void
      removeListener(event: string): void
    }
  }

  interface Window {
    Spotify?: typeof Spotify
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js'

let sdkLoadPromise: Promise<typeof Spotify> | null = null

/** Loads the Spotify Web Playback SDK script once (module-level singleton). */
export function ensureSpotifySdkLoaded(): Promise<typeof Spotify> {
  if (window.Spotify) return Promise.resolve(window.Spotify)
  if (sdkLoadPromise) return sdkLoadPromise

  sdkLoadPromise = new Promise<typeof Spotify>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) resolve(window.Spotify)
      else reject(new Error('Spotify Web Playback SDK loaded but is not available on window.'))
    }
    const script = document.createElement('script')
    script.src = SPOTIFY_SDK_URL
    script.async = true
    script.onerror = () => reject(new Error('Could not load the Spotify Web Playback SDK.'))
    document.head.appendChild(script)
  })

  return sdkLoadPromise
}

interface SpotifyTrackApiResponse {
  name: string
  artists?: Array<{ name: string }>
  album?: { images?: Array<{ url: string }> }
  duration_ms: number
}

function extractSpotifyTrackId(urlOrUri: string): string | null {
  const trimmed = urlOrUri.trim()

  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]+)$/)
  if (uriMatch) return uriMatch[1]

  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    const trackIndex = parts.indexOf('track')
    if (trackIndex !== -1 && parts[trackIndex + 1]) {
      return parts[trackIndex + 1]
    }
  } catch {
    // Not a URL — fall through to null below.
  }

  return null
}

/**
 * Fetches Spotify track metadata (title, artist, artwork, duration) for a
 * public track page URL or a spotify:track:... URI, and builds a Track.
 */
export async function fetchSpotifyTrackMetadata(urlOrUri: string): Promise<Track> {
  const id = extractSpotifyTrackId(urlOrUri)
  if (!id) {
    throw new Error('Could not find a valid Spotify track in this link.')
  }

  const token = await getValidSpotifyAccessToken()
  if (!token) {
    throw new Error('Connect to Spotify first before adding a track.')
  }

  const response = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Could not fetch Spotify track (status ${response.status})`)
  }
  const json = (await response.json()) as SpotifyTrackApiResponse

  return {
    id: crypto.randomUUID(),
    title: json.name,
    artist: (json.artists ?? []).map((a) => a.name).join(', '),
    artworkUrl: json.album?.images?.[0]?.url,
    durationMs: json.duration_ms,
    source: 'spotify',
    spotifyUri: `spotify:track:${id}`,
    addedAt: Date.now(),
  }
}

/** How close to the end (in ms) counts as "near end" for our end-of-track heuristic. */
const NEAR_END_THRESHOLD_MS = 1200
const TIME_UPDATE_POLL_MS = 200

/**
 * DeckController backend for 'spotify' tracks, driven by the Web Playback
 * SDK. Playback happens entirely inside Spotify's own player (a hidden
 * "Connect" device); the app only sends transport commands and derives a
 * synchronous, cheap getCurrentTime() from periodically cached SDK state.
 */
export function createSpotifyController(deckId: DeckId, _ctx: AudioEngineContext): DeckController {
  let player: Spotify.Player | null = null
  let deviceId: string | null = null

  let cachedPositionMs = 0
  let cachedDurationMs = 0
  let cachedIsPaused = true
  let cachedAtClientTime = Date.now()
  let durationKnown = false
  let wasNearEnd = false

  let pollIntervalHandle: ReturnType<typeof setInterval> | null = null
  let isDestroyed = false

  const timeListeners = new Set<(t: number) => void>()
  const endedListeners = new Set<() => void>()
  const loadedListeners = new Set<(d: number) => void>()

  function computeCurrentSeconds(): number {
    const elapsedMs = cachedIsPaused ? 0 : Date.now() - cachedAtClientTime
    const rawMs = cachedPositionMs + elapsedMs
    const upperBoundMs = cachedDurationMs > 0 ? cachedDurationMs : rawMs
    const clampedMs = Math.min(Math.max(rawMs, 0), upperBoundMs)
    return clampedMs / 1000
  }

  function stopPolling() {
    if (pollIntervalHandle !== null) {
      clearInterval(pollIntervalHandle)
      pollIntervalHandle = null
    }
  }

  function startPolling() {
    stopPolling()
    pollIntervalHandle = setInterval(() => {
      if (cachedIsPaused) return
      const t = computeCurrentSeconds()
      timeListeners.forEach((cb) => cb(t))
    }, TIME_UPDATE_POLL_MS)
  }

  function handleStateChanged(state: Spotify.PlaybackState | null) {
    if (!state) return

    const previousWasNearEnd = wasNearEnd

    cachedPositionMs = state.position
    cachedDurationMs = state.duration
    cachedIsPaused = state.paused
    cachedAtClientTime = Date.now()

    if (!durationKnown && cachedDurationMs > 0) {
      durationKnown = true
      loadedListeners.forEach((cb) => cb(cachedDurationMs / 1000))
    }

    // Spotify's SDK has no discrete "ended" event — a track finishing shows
    // up as a paused state whose position snapped back near 0 right after we
    // were sitting near the end of the track. This is a best-effort heuristic.
    const isNowNearZero = state.paused && state.position <= NEAR_END_THRESHOLD_MS
    if (previousWasNearEnd && isNowNearZero) {
      endedListeners.forEach((cb) => cb())
    }
    wasNearEnd = cachedDurationMs > 0 && cachedDurationMs - state.position <= NEAR_END_THRESHOLD_MS

    if (cachedIsPaused) stopPolling()
    else startPolling()

    timeListeners.forEach((cb) => cb(computeCurrentSeconds()))
  }

  async function startPlaybackOnDevice(forDeviceId: string, spotifyUri: string): Promise<void> {
    const token = await getValidSpotifyAccessToken()
    if (!token) {
      throw new Error('Not connected to Spotify.')
    }
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(forDeviceId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [spotifyUri] }),
      },
    )
    if (!response.ok && response.status !== 204) {
      throw new Error(`Could not start Spotify playback (status ${response.status})`)
    }
  }

  return {
    deckId,
    supportsEQ: false,
    supportsAnalysis: false,

    async load(track: Track) {
      if (!track.spotifyUri) {
        throw new Error('This track has no Spotify URI.')
      }
      if (!isSpotifyAuthorized()) {
        throw new Error('Connect to Spotify first before loading a track.')
      }

      // load() has several await points; if destroy() runs while one is
      // pending (the deck got reloaded with a different track before this
      // one finished), bail out instead of continuing to set up playback
      // for a track this controller no longer represents.
      const cancelledError = () => new Error('Load cancelled: deck was reloaded with a different track')

      const SpotifyNs = await ensureSpotifySdkLoaded()
      if (isDestroyed) throw cancelledError()

      if (!player) {
        const newPlayer = new SpotifyNs.Player({
          name: `DJ Deck ${deckId + 1}`,
          getOAuthToken: (cb) => {
            getValidSpotifyAccessToken()
              .then((token) => cb(token ?? ''))
              .catch(() => cb(''))
          },
          volume: 0.8,
        })
        newPlayer.addListener('player_state_changed', handleStateChanged)

        const readyPromise = new Promise<string>((resolve) => {
          newPlayer.addListener('ready', ({ device_id }) => resolve(device_id))
        })

        const connected = await newPlayer.connect()
        if (!connected) {
          throw new Error('Could not connect to the Spotify player.')
        }

        player = newPlayer
        deviceId = await readyPromise
        if (isDestroyed) throw cancelledError()
      }

      if (!deviceId) {
        throw new Error('Spotify player does not have a device ID yet.')
      }

      durationKnown = false
      wasNearEnd = false
      cachedPositionMs = 0
      cachedDurationMs = 0
      cachedIsPaused = true
      cachedAtClientTime = Date.now()

      await startPlaybackOnDevice(deviceId, track.spotifyUri)
      if (isDestroyed) throw cancelledError()
      // Freshly-loaded decks start paused, consistent with file/dropbox decks.
      await player.pause()
      if (isDestroyed) throw cancelledError()
      cachedIsPaused = true
      cachedAtClientTime = Date.now()
    },

    play() {
      void player?.resume()
    },
    pause() {
      void player?.pause()
    },
    seek(seconds: number) {
      const ms = Math.max(0, seconds * 1000)
      void player?.seek(ms)
      cachedPositionMs = ms
      cachedAtClientTime = Date.now()
      timeListeners.forEach((cb) => cb(computeCurrentSeconds()))
    },
    setVolume(v: number) {
      void player?.setVolume(Math.min(1, Math.max(0, v)))
    },
    setPlaybackRate() {
      // No-op: Spotify's Web Playback SDK has no tempo/pitch control (a real
      // platform limitation, not an oversight).
    },
    setPreservesPitch() {
      // No-op: there's no pitch/tempo control to keylock in the first place.
    },
    getCurrentTime() {
      return computeCurrentSeconds()
    },
    getDuration() {
      return cachedDurationMs / 1000
    },
    setEQ(_band: EQBand, _value: number) {
      // No-op: Spotify audio never reaches the page's Web Audio graph.
    },
    setGainTrim(_v: number) {
      // No-op: same reason as setEQ.
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
      isDestroyed = true
      stopPolling()
      timeListeners.clear()
      endedListeners.clear()
      loadedListeners.clear()
      player?.disconnect()
      player = null
      deviceId = null
    },
  }
}
