import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useDjStore } from '../../store/useDjStore'
import type { DeckId } from '../../types'
import styles from './JogWheel.module.css'

interface Props {
  deckId: DeckId
}

// A nudge, not a full scrub: a full wheel-width drag should move playback by a
// few seconds, roughly matching the feel of a real jog wheel's touch strip.
const SECONDS_PER_PIXEL = 0.03

/** CDJ-style jog wheel: spins while the deck plays, and can be dragged to nudge/seek. */
export default function JogWheel({ deckId }: Props) {
  const deck = useDjStore((s) => s.decks[deckId])
  const seek = useDjStore((s) => s.seek)

  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const baseTimeRef = useRef(0)

  const track = deck.track
  const bpmText = track?.bpm ? track.bpm.toFixed(1) : '--'

  const accentClass =
    deck.crossfaderAssign === 'A' ? styles.accentA : deck.crossfaderAssign === 'B' ? styles.accentB : styles.accentNeutral

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!track) return
    draggingRef.current = true
    startXRef.current = e.clientX
    baseTimeRef.current = deck.currentTime
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    const deltaX = e.clientX - startXRef.current
    const target = baseTimeRef.current + deltaX * SECONDS_PER_PIXEL
    const upperBound = deck.durationSec > 0 ? deck.durationSec : Infinity
    seek(deckId, Math.min(upperBound, Math.max(0, target)))
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className={`${styles.wheel} ${accentClass} ${!track ? styles.disabled : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className={`${styles.disc} ${deck.isPlaying ? styles.spinning : ''}`}>
        <span className={styles.marker} />
      </div>
      <span className={styles.spindle} />
      <span className={styles.readout}>{bpmText}</span>
    </div>
  )
}
