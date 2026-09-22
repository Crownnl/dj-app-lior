import { useDjStore } from '../../store/useDjStore'
import type { BeatFxType } from '../../types'
import { useDragKnob } from './useDragKnob'
import mixerStyles from './Mixer.module.css'
import styles from './BeatFxUnit.module.css'

type EngagedBeatFxType = Exclude<BeatFxType, 'off'>

const TYPE_OPTIONS: EngagedBeatFxType[] = ['echo', 'flanger', 'reverb']
const TYPE_LABELS: Record<EngagedBeatFxType, string> = { echo: 'ECHO', flanger: 'FLANGER', reverb: 'REVERB' }
const MIN_MIX = 0
const MAX_MIX = 1

/**
 * Shared master Beat FX unit (echo/flanger/reverb), applied post-crossfader.
 * Rendered once in the Mixer, not per-deck. Clicking the already-active type
 * button turns the effect off, like the lit-effect-toggle convention on real
 * club mixers.
 */
export default function BeatFxUnit() {
  const beatFx = useDjStore((s) => s.mixer.beatFx)
  const setBeatFx = useDjStore((s) => s.setBeatFx)

  const mixKnob = useDragKnob({
    value: beatFx.mix,
    min: MIN_MIX,
    max: MAX_MIX,
    onChange: (v) => setBeatFx(beatFx.type, v),
  })
  // 0 -> -135deg, 1 -> +135deg, same 270deg sweep as every other knob.
  const mixAngle = ((beatFx.mix - MIN_MIX) / (MAX_MIX - MIN_MIX)) * 270 - 135

  const handleTypeClick = (type: EngagedBeatFxType) => {
    setBeatFx(beatFx.type === type ? 'off' : type, beatFx.mix)
  }

  return (
    <div className={styles.unit}>
      <span className={styles.unitLabel}>BEAT FX</span>

      <div className={styles.typeGroup} role="group" aria-label="Beat FX type">
        {TYPE_OPTIONS.map((type) => (
          <button
            key={type}
            type="button"
            className={beatFx.type === type ? `${styles.typeBtn} ${styles.typeBtnActive}` : styles.typeBtn}
            onClick={() => handleTypeClick(type)}
            aria-pressed={beatFx.type === type}
            title={beatFx.type === type ? `${TYPE_LABELS[type]} on (click to turn off)` : `Engage ${TYPE_LABELS[type]}`}
          >
            {TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <div className={mixerStyles.knobWrap}>
        <div
          className={mixerStyles.knob}
          role="slider"
          aria-label="Beat FX mix"
          aria-valuemin={MIN_MIX}
          aria-valuemax={MAX_MIX}
          aria-valuenow={beatFx.mix}
          aria-orientation="vertical"
          tabIndex={0}
          title="Beat FX mix"
          onPointerDown={mixKnob.onPointerDown}
          onPointerMove={mixKnob.onPointerMove}
          onPointerUp={mixKnob.onPointerUp}
          onDoubleClick={mixKnob.onDoubleClick}
          onKeyDown={mixKnob.onKeyDown}
        >
          <div className={mixerStyles.knobIndicator} style={{ transform: `rotate(${mixAngle}deg)` }} />
        </div>
        <span className={mixerStyles.knobLabel}>MIX</span>
      </div>
    </div>
  )
}
