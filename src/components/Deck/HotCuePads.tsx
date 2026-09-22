import { useDjStore } from '../../store/useDjStore'
import { HOT_CUE_COUNT } from '../../types'
import type { DeckId } from '../../types'
import styles from './HotCuePads.module.css'

interface Props {
  deckId: DeckId
}

const BEAT_LOOP_PRESETS: Array<{ label: string; beats: number }> = [
  { label: '1/2', beats: 0.5 },
  { label: '1', beats: 1 },
  { label: '2', beats: 2 },
  { label: '4', beats: 4 },
  { label: '8', beats: 8 },
]

const BEAT_JUMPS = [-4, -1, 1, 4]

/** Hot cue pads (set/jump/clear) plus a compact beat-loop and beat-jump row. */
export default function HotCuePads({ deckId }: Props) {
  const deck = useDjStore((s) => s.decks[deckId])
  const triggerHotCue = useDjStore((s) => s.triggerHotCue)
  const clearHotCue = useDjStore((s) => s.clearHotCue)
  const setBeatLoop = useDjStore((s) => s.setBeatLoop)
  const halveLoop = useDjStore((s) => s.halveLoop)
  const doubleLoop = useDjStore((s) => s.doubleLoop)
  const beatJump = useDjStore((s) => s.beatJump)

  const track = deck.track
  const hasBpm = Boolean(track?.bpm)

  return (
    <div className={styles.panel}>
      <div className={styles.padsRow}>
        {Array.from({ length: HOT_CUE_COUNT }, (_, slot) => {
          const isSet = deck.hotCues[slot] != null
          return (
            <button
              key={slot}
              type="button"
              className={`${styles.pad} ${isSet ? styles.padSet : ''}`}
              onClick={() => triggerHotCue(deckId, slot)}
              onContextMenu={(e) => {
                e.preventDefault()
                clearHotCue(deckId, slot)
              }}
              disabled={!track}
              aria-label={isSet ? `Hot cue ${slot + 1}, set — click to jump, right-click to clear` : `Hot cue ${slot + 1}, unset — click to set`}
            >
              {slot + 1}
            </button>
          )
        })}
      </div>

      <div className={styles.loopRow} title={hasBpm ? undefined : 'Beat loop/jump needs a known BPM'}>
        <div className={styles.group}>
          {BEAT_LOOP_PRESETS.map(({ label, beats }) => (
            <button
              key={label}
              type="button"
              className={styles.smallButton}
              onClick={() => setBeatLoop(deckId, beats)}
              disabled={!hasBpm}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.divider} />

        <div className={styles.group}>
          <button type="button" className={styles.smallButton} onClick={() => halveLoop(deckId)} disabled={!hasBpm}>
            ½
          </button>
          <button type="button" className={styles.smallButton} onClick={() => doubleLoop(deckId)} disabled={!hasBpm}>
            ×2
          </button>
        </div>

        <div className={styles.divider} />

        <div className={styles.group}>
          {BEAT_JUMPS.map((beats) => (
            <button
              key={beats}
              type="button"
              className={styles.smallButton}
              onClick={() => beatJump(deckId, beats)}
              disabled={!hasBpm}
            >
              {beats > 0 ? `+${beats}` : beats}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
