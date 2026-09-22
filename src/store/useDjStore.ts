import { create } from 'zustand'
import { audioEngine, SupersededLoadError } from '../engine/AudioEngine'
import { analyzeAudio } from '../engine/analysis'
import type { CrossfaderAssign, DeckId, DeckState, EQBand, MixerState, Track } from '../types'

const ALL_DECK_IDS: DeckId[] = [0, 1, 2, 3]
// A loop with endSec <= startSec would make the onTimeUpdate loop check
// reseek to startSec on every tick forever (playback appears frozen) —
// setLoopIn/setLoopOut both enforce this minimum so that can't happen.
// Kept comfortably above the browser's ~250ms timeupdate polling interval
// so the time readout/waveform playhead keep visibly advancing even for an
// accidental near-instant IN+OUT tap, not just technically non-frozen.
const MIN_LOOP_LENGTH_SEC = 0.3

function makeInitialDeck(id: DeckId): DeckState {
  return {
    id,
    track: null,
    isPlaying: false,
    currentTime: 0,
    durationSec: 0,
    volume: 0.8,
    gainTrim: 1,
    eq: { low: 1, mid: 1, high: 1 },
    pitch: 1,
    pitchRangePercent: 8,
    crossfaderAssign: id % 2 === 0 ? 'A' : 'B',
    cuePointSec: 0,
    loop: null,
    supportsEQ: true,
    supportsAnalysis: true,
    isLoading: false,
  }
}

interface DjStore {
  deckCount: 2 | 4
  decks: Record<DeckId, DeckState>
  mixer: MixerState
  library: Track[]

  setDeckCount(n: 2 | 4): void
  addTracks(tracks: Track[]): void
  removeTrack(id: string): void

  loadTrackToDeck(deckId: DeckId, track: Track): Promise<void>
  togglePlay(deckId: DeckId): void
  play(deckId: DeckId): void
  pause(deckId: DeckId): void
  seek(deckId: DeckId, seconds: number): void

  setCue(deckId: DeckId): void
  jumpToCue(deckId: DeckId): void

  setDeckVolume(deckId: DeckId, v: number): void
  setGainTrim(deckId: DeckId, v: number): void
  setEQ(deckId: DeckId, band: EQBand, v: number): void
  setPitchPercent(deckId: DeckId, percent: number): void
  setPitchRange(deckId: DeckId, range: 8 | 16 | 50): void
  toggleSync(deckId: DeckId): void

  setLoopIn(deckId: DeckId): void
  setLoopOut(deckId: DeckId): void
  clearLoop(deckId: DeckId): void

  setCrossfader(v: number): void
  setCrossfaderAssign(deckId: DeckId, assign: CrossfaderAssign): void
  setMasterVolume(v: number): void
  toggleCue(deckId: DeckId): void
}

export const useDjStore = create<DjStore>((set, get) => ({
  deckCount: 2,
  decks: {
    0: makeInitialDeck(0),
    1: makeInitialDeck(1),
    2: makeInitialDeck(2),
    3: makeInitialDeck(3),
  },
  mixer: {
    crossfader: 0.5,
    masterVolume: 0.85,
    cueDeckIds: [],
  },
  library: [],

  setDeckCount(n) {
    const previous = get().deckCount
    if (n < previous) {
      // Decks that just left the active range must actually stop playing —
      // they keep running in AudioEngine (their controller doesn't know it
      // was "hidden") until told to shut down, otherwise a track left
      // playing on deck 3/4 stays audible with no UI left to control it.
      const deckIdsToStop = ALL_DECK_IDS.slice(n, previous)
      for (const id of deckIdsToStop) {
        audioEngine.destroyDeck(id)
      }
      set((state) => ({
        deckCount: n,
        decks: {
          ...state.decks,
          ...Object.fromEntries(deckIdsToStop.map((id) => [id, makeInitialDeck(id)])),
        },
      }))
      return
    }
    set({ deckCount: n })
  },

  addTracks(tracks) {
    set((state) => ({ library: [...state.library, ...tracks] }))
    for (const track of tracks) {
      if (track.source !== 'file' && track.source !== 'dropbox') continue
      if (!track.playUrl) continue
      analyzeAudio(track.playUrl)
        .then((analysis) => {
          set((state) => ({
            library: state.library.map((t) =>
              t.id === track.id ? { ...t, bpm: analysis.bpm, peaks: analysis.peaks, durationMs: analysis.durationSec * 1000 } : t,
            ),
            decks: Object.fromEntries(
              ALL_DECK_IDS.map((id) => {
                const deck = state.decks[id]
                if (deck.track?.id !== track.id) return [id, deck]
                return [
                  id,
                  { ...deck, track: { ...deck.track, bpm: analysis.bpm, peaks: analysis.peaks } },
                ]
              }),
            ) as Record<DeckId, DeckState>,
          }))
        })
        .catch(() => {
          /* analysis is best-effort; playback still works without bpm/peaks */
        })
    }
  },

  removeTrack(id) {
    set((state) => ({ library: state.library.filter((t) => t.id !== id) }))
  },

  async loadTrackToDeck(deckId, track) {
    set((state) => ({
      decks: { ...state.decks, [deckId]: { ...state.decks[deckId], isLoading: true, error: undefined } },
    }))
    try {
      const controller = await audioEngine.loadTrackToDeck(deckId, track)

      controller.onTimeUpdate((t) => {
        const deck = get().decks[deckId]
        if (deck.loop && deck.loop.endSec > deck.loop.startSec && t >= deck.loop.endSec) {
          audioEngine.seek(deckId, deck.loop.startSec)
          return
        }
        set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], currentTime: t } } }))
      })
      controller.onEnded(() => {
        set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], isPlaying: false } } }))
      })
      controller.onLoaded((durationSec) => {
        set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], durationSec } } }))
      })

      const deck = get().decks[deckId]
      audioEngine.setDeckVolume(deckId, deck.volume)
      audioEngine.setDeckGainTrim(deckId, deck.gainTrim)
      audioEngine.setDeckEQ(deckId, 'low', deck.eq.low)
      audioEngine.setDeckEQ(deckId, 'mid', deck.eq.mid)
      audioEngine.setDeckEQ(deckId, 'high', deck.eq.high)
      audioEngine.setCrossfaderAssign(deckId, deck.crossfaderAssign)
      audioEngine.setPitch(deckId, deck.pitch)

      set((state) => ({
        decks: {
          ...state.decks,
          [deckId]: {
            ...state.decks[deckId],
            track,
            isLoading: false,
            isPlaying: false,
            currentTime: 0,
            cuePointSec: 0,
            loop: null,
            supportsEQ: controller.supportsEQ,
            supportsAnalysis: controller.supportsAnalysis,
          },
        },
      }))
    } catch (err) {
      if (err instanceof SupersededLoadError) {
        // A newer loadTrackToDeck call for this same deck already won; that
        // call owns isLoading/error now, so this stale one must not touch it.
        return
      }
      set((state) => ({
        decks: {
          ...state.decks,
          [deckId]: { ...state.decks[deckId], isLoading: false, error: err instanceof Error ? err.message : String(err) },
        },
      }))
    }
  },

  togglePlay(deckId) {
    const deck = get().decks[deckId]
    if (deck.isPlaying) get().pause(deckId)
    else get().play(deckId)
  },

  play(deckId) {
    if (!get().decks[deckId].track) return
    audioEngine.play(deckId)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], isPlaying: true } } }))
  },

  pause(deckId) {
    audioEngine.pause(deckId)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], isPlaying: false } } }))
  },

  seek(deckId, seconds) {
    audioEngine.seek(deckId, seconds)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], currentTime: seconds } } }))
  },

  setCue(deckId) {
    const deck = get().decks[deckId]
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], cuePointSec: deck.currentTime } } }))
  },

  jumpToCue(deckId) {
    const deck = get().decks[deckId]
    get().seek(deckId, deck.cuePointSec)
  },

  setDeckVolume(deckId, v) {
    audioEngine.setDeckVolume(deckId, v)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], volume: v } } }))
  },

  setGainTrim(deckId, v) {
    audioEngine.setDeckGainTrim(deckId, v)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], gainTrim: v } } }))
  },

  setEQ(deckId, band, v) {
    audioEngine.setDeckEQ(deckId, band, v)
    set((state) => ({
      decks: { ...state.decks, [deckId]: { ...state.decks[deckId], eq: { ...state.decks[deckId].eq, [band]: v } } },
    }))
  },

  setPitchPercent(deckId, percent) {
    const rate = 1 + percent / 100
    audioEngine.setPitch(deckId, rate)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], pitch: rate } } }))
  },

  setPitchRange(deckId, range) {
    // Narrowing the range must also reclamp the actually-applied pitch —
    // otherwise the fader/readout snap into the new range visually while the
    // deck keeps audibly playing at the old, now out-of-range rate.
    const deck = get().decks[deckId]
    const currentPercent = (deck.pitch - 1) * 100
    const clampedPercent = Math.min(range, Math.max(-range, currentPercent))
    const clampedRate = 1 + clampedPercent / 100
    if (clampedRate !== deck.pitch) audioEngine.setPitch(deckId, clampedRate)
    set((state) => ({
      decks: { ...state.decks, [deckId]: { ...state.decks[deckId], pitchRangePercent: range, pitch: clampedRate } },
    }))
  },

  toggleSync(deckId) {
    const { decks } = get()
    const thisDeck = decks[deckId]
    if (!thisDeck.track?.bpm) return
    const reference = ALL_DECK_IDS.filter((id) => id !== deckId).find((id) => decks[id].isPlaying && decks[id].track?.bpm)
    if (!reference) return
    const referenceDeck = decks[reference]
    if (!referenceDeck.track?.bpm) return
    const currentEffectiveBpm = referenceDeck.track.bpm * referenceDeck.pitch
    const targetRate = currentEffectiveBpm / thisDeck.track.bpm
    const clampedRate = Math.min(1 + thisDeck.pitchRangePercent / 100, Math.max(1 - thisDeck.pitchRangePercent / 100, targetRate))
    audioEngine.setPitch(deckId, clampedRate)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], pitch: clampedRate } } }))
  },

  setLoopIn(deckId) {
    const deck = get().decks[deckId]
    const startSec = deck.currentTime
    // A stale endSec from a previous loop can sit at or before the new
    // startSec (e.g. re-marking IN after scrubbing past the old OUT point) —
    // enforcing a minimum length here keeps startSec < endSec always true,
    // which is what stops onTimeUpdate's loop check from reseeking forever.
    const endSec = Math.max(deck.loop?.endSec ?? startSec + 4, startSec + MIN_LOOP_LENGTH_SEC)
    set((state) => ({
      decks: { ...state.decks, [deckId]: { ...state.decks[deckId], loop: { startSec, endSec } } },
    }))
  },

  setLoopOut(deckId) {
    const deck = get().decks[deckId]
    const rawEndSec = deck.currentTime
    const desiredStart = deck.loop?.startSec ?? Math.max(0, rawEndSec - 4)
    // Clamp startSec first, then re-derive endSec from it (not the other way
    // around) so startSec < endSec holds even at the edge case of pressing
    // OUT at/near currentTime 0 with no prior loop.
    const startSec = Math.max(0, Math.min(desiredStart, rawEndSec - MIN_LOOP_LENGTH_SEC))
    const endSec = Math.max(rawEndSec, startSec + MIN_LOOP_LENGTH_SEC)
    set((state) => ({
      decks: { ...state.decks, [deckId]: { ...state.decks[deckId], loop: { startSec, endSec } } },
    }))
  },

  clearLoop(deckId) {
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], loop: null } } }))
  },

  setCrossfader(v) {
    audioEngine.setCrossfader(v)
    set((state) => ({ mixer: { ...state.mixer, crossfader: v } }))
  },

  setCrossfaderAssign(deckId, assign) {
    audioEngine.setCrossfaderAssign(deckId, assign)
    set((state) => ({ decks: { ...state.decks, [deckId]: { ...state.decks[deckId], crossfaderAssign: assign } } }))
  },

  setMasterVolume(v) {
    audioEngine.setMasterVolume(v)
    set((state) => ({ mixer: { ...state.mixer, masterVolume: v } }))
  },

  toggleCue(deckId) {
    set((state) => ({
      mixer: {
        ...state.mixer,
        cueDeckIds: state.mixer.cueDeckIds.includes(deckId)
          ? state.mixer.cueDeckIds.filter((id) => id !== deckId)
          : [...state.mixer.cueDeckIds, deckId],
      },
    }))
  },
}))
