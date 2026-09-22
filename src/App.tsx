import { useEffect } from 'react'
import { audioEngine } from './engine/AudioEngine'
import { createMediaFileController } from './sources/mediaFileController'
import { createSoundCloudController } from './sources/soundcloud'
import { createSpotifyController } from './sources/spotify'
import { handleSpotifyRedirectCallback } from './sources/spotifyAuth'
import { useDjStore } from './store/useDjStore'
import type { DeckId } from './types'
import Deck from './components/Deck/Deck'
import Mixer from './components/Mixer/Mixer'
import Library from './components/Library/Library'
import SettingsPanel from './components/Settings/SettingsPanel'
import styles from './App.module.css'

if (!audioEngine.hasFactory('file')) {
  audioEngine.registerControllerFactory('file', createMediaFileController)
  audioEngine.registerControllerFactory('dropbox', createMediaFileController)
  audioEngine.registerControllerFactory('soundcloud', createSoundCloudController)
  audioEngine.registerControllerFactory('spotify', createSpotifyController)
}

export default function App() {
  const deckCount = useDjStore((s) => s.deckCount)
  const deckIds: DeckId[] = Array.from({ length: deckCount }, (_, i) => i as DeckId)

  useEffect(() => {
    void handleSpotifyRedirectCallback()
  }, [])

  // 2 decks: a single Deck-Mixer-Deck row, matching the reference all-in-one
  // controller (one deck either side of the mixer). 4 decks can't fit two
  // full decks squeezed into one side of that row at any usable width, so it
  // falls back to a deck grid above a full-width mixer instead.
  if (deckCount === 4) {
    return (
      <div className={styles.app}>
        <SettingsPanel />
        <div className={styles.decksGrid}>
          {deckIds.map((id) => (
            <div key={id} className={styles.deckSlot}>
              <Deck deckId={id} />
            </div>
          ))}
        </div>
        <div className={styles.mixerFull}>
          <Mixer />
        </div>
        <div className={styles.libraryArea}>
          <Library />
        </div>
      </div>
    )
  }

  // Matches the crossfader A/B convention (even id = A = left, odd id = B =
  // right) so a deck's physical side always matches which side of the
  // crossfader it defaults to.
  const leftDeckIds = deckIds.filter((id) => id % 2 === 0)
  const rightDeckIds = deckIds.filter((id) => id % 2 === 1)

  return (
    <div className={styles.app}>
      <SettingsPanel />
      <div className={styles.deckMixerRow}>
        <div className={styles.decksSide}>
          {leftDeckIds.map((id) => (
            <div key={id} className={styles.deckSlot}>
              <Deck deckId={id} />
            </div>
          ))}
        </div>
        <div className={styles.mixerArea}>
          <Mixer />
        </div>
        <div className={styles.decksSide}>
          {rightDeckIds.map((id) => (
            <div key={id} className={styles.deckSlot}>
              <Deck deckId={id} />
            </div>
          ))}
        </div>
      </div>
      <div className={styles.libraryArea}>
        <Library />
      </div>
    </div>
  )
}
