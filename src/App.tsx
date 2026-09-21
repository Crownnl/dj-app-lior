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

  return (
    <div className={styles.app}>
      <SettingsPanel />
      <div className={deckCount === 4 ? `${styles.decks} ${styles.decksFour}` : styles.decks}>
        {deckIds.map((id) => (
          <Deck key={id} deckId={id} />
        ))}
      </div>
      <div className={styles.mixerArea}>
        <Mixer />
      </div>
      <div className={styles.libraryArea}>
        <Library />
      </div>
    </div>
  )
}
