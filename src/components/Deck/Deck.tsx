import { useDjStore } from '../../store/useDjStore'
import type { DeckId, SourceKind } from '../../types'
import Waveform from './Waveform'
import PitchFader from './PitchFader'
import styles from './Deck.module.css'

interface Props {
  deckId: DeckId
}

const SOURCE_LABELS: Record<SourceKind, string> = {
  file: 'bestand',
  dropbox: 'dropbox',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
}

function formatTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** One CDJ-style deck panel: track info, waveform, transport, loop and pitch controls. */
export default function Deck({ deckId }: Props) {
  const deck = useDjStore((s) => s.decks[deckId])
  const togglePlay = useDjStore((s) => s.togglePlay)
  const setCue = useDjStore((s) => s.setCue)
  const jumpToCue = useDjStore((s) => s.jumpToCue)
  const toggleSync = useDjStore((s) => s.toggleSync)
  const setLoopIn = useDjStore((s) => s.setLoopIn)
  const setLoopOut = useDjStore((s) => s.setLoopOut)
  const clearLoop = useDjStore((s) => s.clearLoop)

  const track = deck.track
  const remaining = Math.max(0, deck.durationSec - deck.currentTime)

  const accentClass =
    deck.crossfaderAssign === 'A' ? styles.accentA : deck.crossfaderAssign === 'B' ? styles.accentB : styles.accentNeutral

  const handleCue = () => {
    if (!track) return
    if (deck.isPlaying) setCue(deckId)
    else jumpToCue(deckId)
  }

  return (
    <div className={`${styles.deck} ${accentClass} ${deck.isLoading ? styles.loading : ''}`}>
      <div className={styles.header}>
        <div className={styles.trackInfo}>
          {track ? (
            <>
              <span className={styles.title}>{track.title}</span>
              {track.artist && <span className={styles.artist}>{track.artist}</span>}
            </>
          ) : (
            <span className={styles.placeholder}>Geen track geladen</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {track && <span className={styles.badge}>{SOURCE_LABELS[track.source]}</span>}
          <span className={styles.bpm}>{track?.bpm ? track.bpm.toFixed(1) : '--'} BPM</span>
        </div>
      </div>

      {!deck.supportsEQ && track && <div className={styles.streamNote}>beperkte mixing (streaming)</div>}

      <Waveform deckId={deckId} />

      <div className={styles.timeRow}>
        <span>{formatTime(deck.currentTime)}</span>
        <span>-{formatTime(remaining)}</span>
      </div>

      <div className={styles.transportRow}>
        <button type="button" className={styles.transportButton} onClick={handleCue} disabled={!track}>
          CUE
        </button>
        <button
          type="button"
          className={`${styles.transportButton} ${styles.playButton}`}
          onClick={() => togglePlay(deckId)}
          disabled={!track}
        >
          {deck.isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2" y="1" width="4" height="12" fill="currentColor" />
              <rect x="8" y="1" width="4" height="12" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <polygon points="2,1 13,7 2,13" fill="currentColor" />
            </svg>
          )}
        </button>
        <button type="button" className={styles.transportButton} onClick={() => toggleSync(deckId)} disabled={!track}>
          SYNC
        </button>
      </div>

      <div className={styles.loopRow}>
        <span className={styles.loopLabel}>LOOP</span>
        <button type="button" className={styles.loopButton} onClick={() => setLoopIn(deckId)} disabled={!track}>
          IN
        </button>
        <button type="button" className={styles.loopButton} onClick={() => setLoopOut(deckId)} disabled={!track}>
          OUT
        </button>
        <button type="button" className={styles.loopButton} onClick={() => clearLoop(deckId)} disabled={!track || !deck.loop}>
          EXIT
        </button>
        <span className={deck.loop ? styles.loopIndicatorActive : styles.loopIndicator} />
      </div>

      <div className={styles.bottomRow}>
        <PitchFader deckId={deckId} />
      </div>

      {deck.isLoading && <div className={styles.loadingOverlay}>Laden...</div>}
      {deck.error && <div className={styles.error}>{deck.error}</div>}
    </div>
  )
}
