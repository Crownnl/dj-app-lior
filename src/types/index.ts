// Shared contract types for the whole app. Every module (engine, sources, UI)
// is built against these — keep changes here backwards compatible.

export type SourceKind = 'file' | 'dropbox' | 'soundcloud' | 'spotify'

/** A track that can be loaded onto a deck, regardless of where it came from. */
export interface Track {
  id: string
  title: string
  artist?: string
  artworkUrl?: string
  source: SourceKind
  /** Playable URL for 'file' and 'dropbox' sources (blob: or https: direct link). */
  playUrl?: string
  /** Public SoundCloud track URL, required when source === 'soundcloud'. */
  soundcloudUrl?: string
  /** Spotify track URI (spotify:track:...), required when source === 'spotify'. */
  spotifyUri?: string
  durationMs?: number
  bpm?: number
  /** Per-bucket normalized (0..1) low/mid/high band energy, for the Rekordbox-style colored waveform. Only available for decodable sources (file/dropbox). */
  peaks?: WaveformBand[]
  addedAt: number
}

export interface WaveformBand {
  low: number
  mid: number
  high: number
}

export type CrossfaderAssign = 'A' | 'B' | 'THRU'

export type EQBand = 'low' | 'mid' | 'high'

export interface EQState {
  low: number // 0..2, 1 = flat
  mid: number
  high: number
}

export type DeckId = 0 | 1 | 2 | 3

export interface DeckState {
  id: DeckId
  track: Track | null
  isPlaying: boolean
  /** Current playhead position in seconds. */
  currentTime: number
  durationSec: number
  /** Channel fader, 0..1. */
  volume: number
  /** Fine gain trim, 0..2 (1 = unity). */
  gainTrim: number
  eq: EQState
  /** Playback rate multiplier driven by the pitch fader, e.g. 0.92..1.08. */
  pitch: number
  /** Pitch fader range in percent, e.g. 8 => +/-8%. */
  pitchRangePercent: 8 | 16 | 50
  crossfaderAssign: CrossfaderAssign
  cuePointSec: number
  loop: { startSec: number; endSec: number } | null
  /** True while the deck's audio graph supports EQ/filters (file & dropbox sources). */
  supportsEQ: boolean
  /** True while the deck's audio graph supports waveform + BPM analysis. */
  supportsAnalysis: boolean
  isLoading: boolean
  error?: string
}

export interface MixerState {
  /** 0 = full channel A side, 1 = full channel B side. */
  crossfader: number
  masterVolume: number
  /** cut/boost curve steepness is fixed; this only toggles which decks are audible via PFL headphone cue (UI-only, no real audio routing). */
  cueDeckIds: DeckId[]
}

/** Unified control surface every deck's playback backend must implement. */
export interface DeckController {
  readonly deckId: DeckId
  load(track: Track): Promise<void>
  play(): void
  pause(): void
  seek(seconds: number): void
  /** 0..1 linear volume as perceived loudness (implementations may apply their own curve). */
  setVolume(v: number): void
  setPlaybackRate(rate: number): void
  getCurrentTime(): number
  getDuration(): number
  /** EQ is a no-op for streaming-only controllers (SoundCloud/Spotify). */
  setEQ(band: EQBand, value: number): void
  setGainTrim(v: number): void
  onTimeUpdate(cb: (t: number) => void): () => void
  onEnded(cb: () => void): () => void
  onLoaded(cb: (durationSec: number) => void): () => void
  destroy(): void
  readonly supportsEQ: boolean
  readonly supportsAnalysis: boolean
}

export interface TrackAnalysis {
  bpm?: number
  peaks?: WaveformBand[]
  durationSec: number
}
