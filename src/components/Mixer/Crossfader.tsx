import { useDjStore } from '../../store/useDjStore'
import styles from './Mixer.module.css'

export default function Crossfader() {
  const crossfader = useDjStore((s) => s.mixer.crossfader)
  const setCrossfader = useDjStore((s) => s.setCrossfader)

  return (
    <div className={styles.crossfaderRow}>
      <span className={styles.crossfaderLabelA}>A</span>
      <input
        type="range"
        className={styles.crossfaderInput}
        min={0}
        max={1}
        step={0.01}
        value={crossfader}
        onChange={(e) => setCrossfader(Number(e.target.value))}
        aria-label="Crossfader"
      />
      <span className={styles.crossfaderLabelB}>B</span>
    </div>
  )
}
