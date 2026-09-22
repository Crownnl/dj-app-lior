import { useDjStore } from '../../store/useDjStore'
import type { CrossfaderAssign, DeckId } from '../../types'
import { useDragKnob } from './useDragKnob'
import EQKnob from './EQKnob'
import ColorFxKnob from './ColorFxKnob'
import VUMeter from './VUMeter'
import styles from './Mixer.module.css'

const ASSIGN_OPTIONS: CrossfaderAssign[] = ['A', 'THRU', 'B']
const GAIN_DISABLED_TITLE = "Gain trim unavailable for streaming sources (Spotify/SoundCloud don't allow raw audio access)"
const MIN_GAIN = 0
const MAX_GAIN = 2

function assignButtonClass(option: CrossfaderAssign, active: CrossfaderAssign): string {
  if (option !== active) return styles.assignBtn
  if (option === 'A') return `${styles.assignBtn} ${styles.assignBtnA}`
  if (option === 'B') return `${styles.assignBtn} ${styles.assignBtnB}`
  return `${styles.assignBtn} ${styles.assignBtnActive}`
}

function assignTitle(option: CrossfaderAssign, deckNumber: number): string {
  if (option === 'THRU') return `Channel ${deckNumber} always audible (THRU, no crossfade)`
  return `Assign channel ${deckNumber} to side ${option}`
}

export default function ChannelStrip({ deckId }: { deckId: DeckId }) {
  const deck = useDjStore((s) => s.decks[deckId])
  const cueDeckIds = useDjStore((s) => s.mixer.cueDeckIds)
  const setDeckVolume = useDjStore((s) => s.setDeckVolume)
  const setGainTrim = useDjStore((s) => s.setGainTrim)
  const setCrossfaderAssign = useDjStore((s) => s.setCrossfaderAssign)
  const toggleCue = useDjStore((s) => s.toggleCue)

  const disabled = !deck.supportsEQ
  const isCued = cueDeckIds.includes(deckId)

  const gainKnob = useDragKnob({
    value: deck.gainTrim,
    min: MIN_GAIN,
    max: MAX_GAIN,
    disabled,
    onChange: (v) => setGainTrim(deckId, v),
  })
  const gainAngle = ((deck.gainTrim - MIN_GAIN) / (MAX_GAIN - MIN_GAIN)) * 270 - 135

  const accentClass =
    deck.crossfaderAssign === 'A' ? styles.stripAccentA : deck.crossfaderAssign === 'B' ? styles.stripAccentB : styles.stripAccentNeutral

  return (
    <div className={`${styles.strip} ${accentClass}`}>
      <span className={styles.stripLabel}>CH {deckId + 1}</span>

      <div className={styles.knobWrap}>
        <div
          className={disabled ? `${styles.knob} ${styles.knobDisabled}` : styles.knob}
          role="slider"
          aria-label="Gain trim"
          aria-valuemin={MIN_GAIN}
          aria-valuemax={MAX_GAIN}
          aria-valuenow={deck.gainTrim}
          aria-disabled={disabled}
          aria-orientation="vertical"
          tabIndex={disabled ? -1 : 0}
          title={disabled ? GAIN_DISABLED_TITLE : 'Gain trim'}
          onPointerDown={gainKnob.onPointerDown}
          onPointerMove={gainKnob.onPointerMove}
          onPointerUp={gainKnob.onPointerUp}
          onDoubleClick={gainKnob.onDoubleClick}
          onKeyDown={gainKnob.onKeyDown}
        >
          <div className={styles.knobIndicator} style={{ transform: `rotate(${gainAngle}deg)` }} />
        </div>
        <span className={styles.knobLabel}>GAIN</span>
      </div>

      <div className={styles.eqStack}>
        <EQKnob deckId={deckId} band="high" />
        <EQKnob deckId={deckId} band="mid" />
        <EQKnob deckId={deckId} band="low" />
      </div>

      <ColorFxKnob deckId={deckId} />

      <div className={styles.assignGroup} role="group" aria-label="Crossfader assignment">
        {ASSIGN_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={assignButtonClass(option, deck.crossfaderAssign)}
            onClick={() => setCrossfaderAssign(deckId, option)}
            title={assignTitle(option, deckId + 1)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className={styles.faderRow}>
        <VUMeter deckId={deckId} />
        <div className={styles.faderArea}>
          <input
            type="range"
            className={styles.volumeFaderInput}
            min={0}
            max={1}
            step={0.01}
            value={deck.volume}
            onChange={(e) => setDeckVolume(deckId, Number(e.target.value))}
            aria-label={`Channel ${deckId + 1} volume`}
          />
        </div>
      </div>

      <button
        type="button"
        className={isCued ? `${styles.cueBtn} ${styles.cueBtnActive}` : styles.cueBtn}
        onClick={() => toggleCue(deckId)}
        title="Headphone cue (indicator only, no real audio routing in this version)"
        aria-pressed={isCued}
      >
        CUE
      </button>
    </div>
  )
}
