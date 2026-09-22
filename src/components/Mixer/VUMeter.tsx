import { useEffect, useRef } from 'react'
import { audioEngine } from '../../engine/AudioEngine'
import type { DeckId } from '../../types'
import styles from './VUMeter.module.css'

// Fixed LED-segment count, bottom to top. Zone split mirrors the theme's
// meter tokens: low ~60%, mid ~25%, high ~15% (the "hot" zone).
const SEGMENT_COUNT = 12
const LOW_COUNT = Math.round(SEGMENT_COUNT * 0.6)
const MID_COUNT = Math.round(SEGMENT_COUNT * 0.25)
// Remainder rather than a third rounded fraction, so the three zones always add up to SEGMENT_COUNT.
const HIGH_COUNT = SEGMENT_COUNT - LOW_COUNT - MID_COUNT

// Exponential moving average weight given to each new raw sample, so the
// segment count doesn't flicker harshly frame to frame (simple ballistics).
const SMOOTHING = 0.3

function zoneClassName(index: number): string {
  if (index < LOW_COUNT) return styles.segmentLow
  if (index < LOW_COUNT + MID_COUNT) return styles.segmentMid
  return styles.segmentHigh
}

interface Props {
  deckId: DeckId | 'master'
}

/** Slim vertical LED-style level meter. Renders either a per-channel meter (a real
 * DeckId) or the master output meter ('master') — both read the same 0..1 engine API
 * shape, just from a different getter. Reads audioEngine directly on a rAF loop instead
 * of subscribing to Zustand, matching Waveform.tsx's pattern for animation-rate data. */
export default function VUMeter({ deckId }: Props) {
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([])
  const smoothedRef = useRef(0)

  useEffect(() => {
    let raf = 0
    const loop = () => {
      const raw = deckId === 'master' ? audioEngine.getMasterLevel() : audioEngine.getChannelLevel(deckId)
      smoothedRef.current = smoothedRef.current * (1 - SMOOTHING) + raw * SMOOTHING
      const level = Math.min(1, Math.max(0, smoothedRef.current))
      const lit = Math.round(level * SEGMENT_COUNT)

      // Direct DOM mutation instead of React state: this runs every animation
      // frame, so toggling a class per segment is far cheaper than a re-render.
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        segmentRefs.current[i]?.classList.toggle(styles.lit, i < lit)
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [deckId])

  return (
    <div className={styles.meter} aria-hidden="true">
      {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            segmentRefs.current[i] = el
          }}
          className={`${styles.segment} ${zoneClassName(i)}`}
        />
      ))}
    </div>
  )
}
