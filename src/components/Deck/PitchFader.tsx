import type { ChangeEvent } from 'react'
import { useDjStore } from '../../store/useDjStore'
import type { DeckId } from '../../types'
import styles from './PitchFader.module.css'

interface Props {
  deckId: DeckId
}

const PITCH_RANGES: Array<8 | 16 | 50> = [8, 16, 50]

/** Vertical pitch/tempo fader with a center detent, plus range selector buttons. */
export default function PitchFader({ deckId }: Props) {
  const deck = useDjStore((s) => s.decks[deckId])
  const setPitchPercent = useDjStore((s) => s.setPitchPercent)
  const setPitchRange = useDjStore((s) => s.setPitchRange)

  const range = deck.pitchRangePercent
  const rawPercent = (deck.pitch - 1) * 100
  const percent = Math.min(range, Math.max(-range, rawPercent))
  const readout = `${percent > 0 ? '+' : percent < 0 ? '-' : '+'}${Math.abs(percent).toFixed(1)}%`

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPitchPercent(deckId, Number(e.target.value))
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.readout}>{readout}</div>
      <div className={styles.sliderTrack}>
        <div className={styles.detent} />
        <input
          type="range"
          className={styles.slider}
          min={-range}
          max={range}
          step={0.1}
          value={percent}
          onChange={handleChange}
          aria-label="Pitch"
        />
      </div>
      <div className={styles.rangeButtons}>
        {PITCH_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={r === range ? styles.rangeButtonActive : styles.rangeButton}
            onClick={() => setPitchRange(deckId, r)}
          >
            {r}%
          </button>
        ))}
      </div>
    </div>
  )
}
