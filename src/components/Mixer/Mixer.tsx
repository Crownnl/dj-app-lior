import { useDjStore } from '../../store/useDjStore'
import type { DeckId } from '../../types'
import ChannelStrip from './ChannelStrip'
import Crossfader from './Crossfader'
import styles from './Mixer.module.css'

export default function Mixer() {
  const deckCount = useDjStore((s) => s.deckCount)
  const setDeckCount = useDjStore((s) => s.setDeckCount)
  const masterVolume = useDjStore((s) => s.mixer.masterVolume)
  const setMasterVolume = useDjStore((s) => s.setMasterVolume)

  const deckIds: DeckId[] = Array.from({ length: deckCount }, (_, i) => i as DeckId)

  return (
    <div className={styles.mixer}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>MIXER</span>
        <div className={styles.deckCountToggle} role="group" aria-label="Aantal decks">
          <button
            type="button"
            className={deckCount === 2 ? `${styles.deckCountBtn} ${styles.deckCountBtnActive}` : styles.deckCountBtn}
            onClick={() => setDeckCount(2)}
          >
            2 decks
          </button>
          <button
            type="button"
            className={deckCount === 4 ? `${styles.deckCountBtn} ${styles.deckCountBtnActive}` : styles.deckCountBtn}
            onClick={() => setDeckCount(4)}
          >
            4 decks
          </button>
        </div>
      </div>

      <div className={styles.strips}>
        {deckIds.map((id) => (
          <ChannelStrip key={id} deckId={id} />
        ))}

        <div className={styles.masterStrip}>
          <span className={styles.masterLabel}>MASTER</span>
          <div className={styles.faderArea}>
            <input
              type="range"
              className={styles.masterFaderInput}
              min={0}
              max={1}
              step={0.01}
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              aria-label="Master volume"
            />
          </div>
          <span className={styles.masterReadout}>{Math.round(masterVolume * 100)}</span>
        </div>
      </div>

      <Crossfader />
    </div>
  )
}
