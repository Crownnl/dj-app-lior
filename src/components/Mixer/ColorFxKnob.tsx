import { useDjStore } from '../../store/useDjStore'
import type { DeckId } from '../../types'
import { useDragKnob } from './useDragKnob'
import styles from './Mixer.module.css'

const MIN = -1
const MAX = 1
const DISABLED_TITLE = "Sound Color FX unavailable for streaming sources (Spotify/SoundCloud don't allow raw audio access)"

/**
 * Per-channel Sound Color FX (filter) knob: center detent at 0 (flat/off),
 * negative sweeps a low-pass filter in, positive sweeps a high-pass filter in.
 * Same drag/keyboard interaction and disabled treatment as EQKnob.
 */
export default function ColorFxKnob({ deckId }: { deckId: DeckId }) {
  const value = useDjStore((s) => s.decks[deckId].colorFx)
  const supportsEQ = useDjStore((s) => s.decks[deckId].supportsEQ)
  const setColorFx = useDjStore((s) => s.setColorFx)

  const disabled = !supportsEQ
  const { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, onKeyDown } = useDragKnob({
    value,
    min: MIN,
    max: MAX,
    disabled,
    onChange: (v) => setColorFx(deckId, v),
  })

  // -1 -> -135deg, 0 (flat, noon) -> 0deg, 1 -> +135deg, same sweep as EQKnob.
  const angle = ((value - MIN) / (MAX - MIN)) * 270 - 135

  return (
    <div className={styles.knobWrap}>
      <div
        className={disabled ? `${styles.knob} ${styles.knobDisabled}` : styles.knob}
        role="slider"
        aria-label="Sound Color FX"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={value}
        aria-disabled={disabled}
        aria-orientation="vertical"
        tabIndex={disabled ? -1 : 0}
        title={disabled ? DISABLED_TITLE : 'Sound Color FX'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <div className={styles.knobIndicator} style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <span className={styles.knobLabel}>COLOR</span>
    </div>
  )
}
