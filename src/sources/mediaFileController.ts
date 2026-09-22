import type { AudioEngineContext } from '../engine/AudioEngine'
import type { DeckController, DeckId, EQBand, Track } from '../types'

/**
 * DeckController backend for 'file' and 'dropbox' sources: both resolve to a
 * plain playable URL (blob: or a direct download link), decoded through a
 * real <audio> element + MediaElementAudioSourceNode so it can flow through
 * the engine's EQ/gain chain. This is the only source that gets full mixing
 * (EQ, filters, waveform, BPM) because it's the only one where the app can
 * legally get at the raw audio signal.
 */
export function createMediaFileController(deckId: DeckId, engineCtx: AudioEngineContext): DeckController {
  const audio = new Audio()
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'

  let sourceNode: MediaElementAudioSourceNode | null = null
  let cancelPendingLoad: (() => void) | null = null

  const timeListeners = new Set<(t: number) => void>()
  const endedListeners = new Set<() => void>()
  const loadedListeners = new Set<(d: number) => void>()

  const handleTimeUpdate = () => timeListeners.forEach((cb) => cb(audio.currentTime))
  const handleEnded = () => endedListeners.forEach((cb) => cb())
  const handleLoadedMeta = () => loadedListeners.forEach((cb) => cb(audio.duration || 0))

  audio.addEventListener('timeupdate', handleTimeUpdate)
  audio.addEventListener('ended', handleEnded)
  audio.addEventListener('loadedmetadata', handleLoadedMeta)

  return {
    deckId,
    supportsEQ: true,
    supportsAnalysis: true,

    async load(track: Track) {
      if (!track.playUrl) throw new Error('Track has no playable URL')
      audio.src = track.playUrl
      audio.load()
      if (!sourceNode) {
        sourceNode = engineCtx.audioContext.createMediaElementSource(audio)
        engineCtx.connectSource(deckId, sourceNode)
      }
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          cleanup()
          resolve()
        }
        const onError = () => {
          cleanup()
          reject(new Error('Could not load audio file'))
        }
        function cleanup() {
          audio.removeEventListener('canplay', onCanPlay)
          audio.removeEventListener('error', onError)
          cancelPendingLoad = null
        }
        // If destroy() runs while this load is still pending (the deck got
        // reloaded with a different track before this one finished), reject
        // immediately instead of leaving this promise — and the <audio>
        // element/listeners it holds onto — pending forever.
        cancelPendingLoad = () => {
          cleanup()
          reject(new Error('Load cancelled: deck was reloaded with a different track'))
        }
        audio.addEventListener('canplay', onCanPlay, { once: true })
        audio.addEventListener('error', onError, { once: true })
      })
    },

    play() {
      void audio.play().catch(() => {})
    },
    pause() {
      audio.pause()
    },
    seek(seconds: number) {
      if (Number.isFinite(seconds)) audio.currentTime = Math.max(0, seconds)
    },
    setVolume() {
      // No-op: graph-routed decks get their loudness from AudioEngine's own
      // channel/crossfader gain nodes, not from the controller.
    },
    setPlaybackRate(rate: number) {
      audio.playbackRate = rate
    },
    setPreservesPitch(enabled: boolean) {
      // Master Tempo / keylock: standardized as `preservesPitch`, still vendor
      // prefixed on some engines, so set every spelling that exists.
      const el = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }
      el.preservesPitch = enabled
      el.mozPreservesPitch = enabled
      el.webkitPreservesPitch = enabled
    },
    getCurrentTime() {
      return audio.currentTime
    },
    getDuration() {
      return audio.duration || 0
    },
    setEQ(_band: EQBand, _value: number) {
      // No-op: EQ is applied by AudioEngine's biquad filter chain directly.
    },
    setGainTrim() {
      // No-op: gain trim is applied by AudioEngine's input gain node directly.
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
      cancelPendingLoad?.()
      audio.pause()
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('loadedmetadata', handleLoadedMeta)
      audio.removeAttribute('src')
      sourceNode?.disconnect()
    },
  }
}
