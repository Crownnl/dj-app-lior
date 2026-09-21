import { useDjStore } from '../../store/useDjStore'
import type { DeckId, EQBand } from '../../types'
import { useDragKnob } from './useDragKnob'
import styles from './Mixer.module.css'

const BAND_LABELS: Record<EQBand, string> = { high: 'HI', mid: 'MID', low: 'LOW' }
const MIN = 0
const MAX = 2
const DISABLED_TITLE = 'EQ niet beschikbaar voor streaming-bronnen (Spotify/SoundCloud staan geen ruwe audiotoegang toe)'

export default function EQKnob({ deckId, band }: { deckId: DeckId; band: EQBand }) {
  const value = useDjStore((s) => s.decks[deckId].eq[band])
  const supportsEQ = useDjStore((s) => s.decks[deckId].supportsEQ)
  const setEQ = useDjStore((s) => s.setEQ)

  const disabled = !supportsEQ
  const { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onKeyDown } = useDragKnob({
    value,
    min: MIN,
    max: MAX,
    disabled,
    onChange: (v) => setEQ(deckId, band, v),
  })

  // 0 -> -135deg, 1 (flat, noon) -> 0deg, 2 -> +135deg, like a real EQ pot.
  const angle = ((value - MIN) / (MAX - MIN)) * 270 - 135

  return (
    <div className={styles.knobWrap}>
      <div
        className={disabled ? `${styles.knob} ${styles.knobDisabled}` : styles.knob}
        role="slider"
        aria-label={`EQ ${band}`}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-disabled={disabled}
        aria-orientation="vertical"
        tabIndex={disabled ? -1 : 0}
        title={disabled ? DISABLED_TITLE : `EQ ${BAND_LABELS[band]}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <div className={styles.knobIndicator} style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span className={styles.knobLabel}>{BAND_LABELS[band]}</span>
    </div>
  )
}
