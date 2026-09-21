import { useEffect, useState } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import { STORAGE_KEYS, getStoredValue, setStoredValue } from '../../config'
import styles from './SettingsPanel.module.css'

/** Floating gear button + overlay panel for the user's own Dropbox app key and Spotify client ID. */
export default function SettingsPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [dropboxAppKey, setDropboxAppKey] = useState(() => getStoredValue(STORAGE_KEYS.dropboxAppKey))
  const [spotifyClientId, setSpotifyClientId] = useState(() => getStoredValue(STORAGE_KEYS.spotifyClientId))

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleDropboxChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setDropboxAppKey(value)
    setStoredValue(STORAGE_KEYS.dropboxAppKey, value)
  }

  const handleSpotifyChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSpotifyClientId(value)
    setStoredValue(STORAGE_KEYS.spotifyClientId, value)
  }

  const handleOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setIsOpen(false)
  }

  const currentPageUrl = window.location.origin + window.location.pathname

  return (
    <>
      <button
        type="button"
        className={styles.gearButton}
        onClick={() => setIsOpen(true)}
        aria-label="Open settings"
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.overlay} onMouseDown={handleOverlayMouseDown}>
          <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Settings">
            <div className={styles.header}>
              <h2 className={styles.title}>Settings</h2>
              <button
                type="button"
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className={styles.section}>
              <label className={styles.label} htmlFor="dropbox-app-key">
                Dropbox App Key
              </label>
              <input
                id="dropbox-app-key"
                type="text"
                className={styles.input}
                value={dropboxAppKey}
                onChange={handleDropboxChange}
                placeholder="e.g. 8f2k9x1qz..."
                autoComplete="off"
                spellCheck={false}
              />
              <p className={styles.help}>
                Create a free app key at https://www.dropbox.com/developers/apps. Add this app's domain there under
                "Allowed origins", otherwise the file picker won't work.
              </p>
            </div>

            <div className={styles.section}>
              <label className={styles.label} htmlFor="spotify-client-id">
                Spotify Client ID
              </label>
              <input
                id="spotify-client-id"
                type="text"
                className={styles.input}
                value={spotifyClientId}
                onChange={handleSpotifyChange}
                placeholder="e.g. 3f9a7c2e..."
                autoComplete="off"
                spellCheck={false}
              />
              <p className={styles.help}>
                Create a free app at https://developer.spotify.com/dashboard. Add the exact URL below there as the
                "Redirect URI":
              </p>
              <p className={styles.redirectUrl}>{currentPageUrl}</p>
              <p className={styles.help}>
                Note: playback via Spotify requires a Spotify Premium account — this is a requirement from Spotify
                itself, not a limitation of this app.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
