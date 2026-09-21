import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { useDjStore } from '../../store/useDjStore'
import type { DeckId, SourceKind, Track } from '../../types'
import { openDropboxChooser } from '../../sources/dropbox'
import { resolveSoundCloudUrl } from '../../sources/soundcloud'
import { isSpotifyAuthorized, startSpotifyLogin } from '../../sources/spotifyAuth'
import { fetchSpotifyTrackMetadata } from '../../sources/spotify'
import styles from './Library.module.css'

const SOURCE_LABELS: Record<SourceKind, string> = {
  file: 'bestand',
  dropbox: 'dropbox',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
}

function trackFromFile(file: File): Track {
  return {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^/.]+$/, ''),
    source: 'file',
    playUrl: URL.createObjectURL(file),
    addedAt: Date.now(),
  }
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '--:--'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Library / import panel: bring tracks in from files, Dropbox, SoundCloud or Spotify, then load them onto a deck. */
export default function Library() {
  const library = useDjStore((s) => s.library)
  const deckCount = useDjStore((s) => s.deckCount)
  const addTracks = useDjStore((s) => s.addTracks)
  const removeTrack = useDjStore((s) => s.removeTrack)
  const loadTrackToDeck = useDjStore((s) => s.loadTrackToDeck)

  const deckIds: DeckId[] = Array.from({ length: deckCount }, (_, i) => i as DeckId)

  // --- local files ---
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setIsDragActive] = useState(false)

  const handleFiles = (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    addTracks(list.map(trackFromFile))
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragActive(false)
    handleFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragActive(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragActive(false)
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files)
    e.target.value = ''
  }

  // --- dropbox ---
  const [dropboxError, setDropboxError] = useState<string | null>(null)
  const [isDropboxLoading, setIsDropboxLoading] = useState(false)

  const handleDropboxClick = async () => {
    setDropboxError(null)
    setIsDropboxLoading(true)
    try {
      const result = await openDropboxChooser()
      if (result.length > 0) addTracks(result)
    } catch (err) {
      setDropboxError(errorMessage(err))
    } finally {
      setIsDropboxLoading(false)
    }
  }

  // --- soundcloud ---
  const [scUrl, setScUrl] = useState('')
  const [scError, setScError] = useState<string | null>(null)
  const [isScLoading, setIsScLoading] = useState(false)

  const handleScSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = scUrl.trim()
    if (!trimmed) return
    setScError(null)
    setIsScLoading(true)
    try {
      const track = await resolveSoundCloudUrl(trimmed)
      addTracks([track])
      setScUrl('')
    } catch (err) {
      setScError(errorMessage(err))
    } finally {
      setIsScLoading(false)
    }
  }

  // --- spotify ---
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(() => isSpotifyAuthorized())
  const [spotifyConnectError, setSpotifyConnectError] = useState<string | null>(null)
  const [isSpotifyConnecting, setIsSpotifyConnecting] = useState(false)
  const [spotifyUrl, setSpotifyUrl] = useState('')
  const [spotifyError, setSpotifyError] = useState<string | null>(null)
  const [isSpotifyLoading, setIsSpotifyLoading] = useState(false)

  // The login flow navigates away and back, so re-check on focus (in case the
  // redirect-back token exchange happened elsewhere / another tab regained focus).
  useEffect(() => {
    const recheck = () => setIsSpotifyConnected(isSpotifyAuthorized())
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [])

  const handleSpotifyConnect = async () => {
    setSpotifyConnectError(null)
    setIsSpotifyConnecting(true)
    try {
      await startSpotifyLogin()
    } catch (err) {
      setSpotifyConnectError(errorMessage(err))
    } finally {
      setIsSpotifyConnecting(false)
    }
  }

  const handleSpotifySubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = spotifyUrl.trim()
    if (!trimmed) return
    setSpotifyError(null)
    setIsSpotifyLoading(true)
    try {
      const track = await fetchSpotifyTrackMetadata(trimmed)
      addTracks([track])
      setSpotifyUrl('')
    } catch (err) {
      setSpotifyError(errorMessage(err))
    } finally {
      setIsSpotifyLoading(false)
    }
  }

  return (
    <div className={styles.panel}>
      <p className={styles.legalNote}>
        SoundCloud en Spotify staan om technische/juridische redenen geen volledige mixing toe (geen EQ, geen golfvorm, geen
        pitch) — voor volledig mixen (EQ, sync, loops) gebruik je bestanden of Dropbox.
      </p>

      <div className={styles.importRow}>
        <div
          className={`${styles.importGroup} ${isDragActive ? styles.dragActive : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className={styles.groupLabel}>Bestanden</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="audio/*"
            className={styles.hiddenInput}
            onChange={handleFileInputChange}
          />
          <button type="button" className={styles.smallButton} onClick={() => fileInputRef.current?.click()}>
            Bestanden toevoegen
          </button>
          <span className={styles.dropHint}>of sleep audiobestanden hierheen</span>
        </div>

        <div className={styles.importGroup}>
          <span className={styles.groupLabel}>Dropbox</span>
          <button type="button" className={styles.smallButton} onClick={handleDropboxClick} disabled={isDropboxLoading}>
            {isDropboxLoading ? 'Bezig...' : 'Dropbox'}
          </button>
          {dropboxError && (
            <span className={styles.errorNote}>
              {dropboxError} Open eventueel de instellingen om een Dropbox app-key in te vullen.
            </span>
          )}
        </div>

        <div className={styles.importGroup}>
          <span className={styles.groupLabel}>SoundCloud</span>
          <form className={styles.inlineForm} onSubmit={handleScSubmit}>
            <input
              type="text"
              className={styles.textInput}
              placeholder="SoundCloud track-URL"
              value={scUrl}
              onChange={(e) => setScUrl(e.target.value)}
            />
            <button type="submit" className={styles.smallButton} disabled={isScLoading || !scUrl.trim()}>
              {isScLoading ? 'Bezig...' : 'Toevoegen'}
            </button>
          </form>
          {scError && <span className={styles.errorNote}>{scError}</span>}
        </div>

        <div className={styles.importGroup}>
          <span className={styles.groupLabel}>Spotify</span>
          {isSpotifyConnected ? (
            <>
              <form className={styles.inlineForm} onSubmit={handleSpotifySubmit}>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Spotify track-URL of URI"
                  value={spotifyUrl}
                  onChange={(e) => setSpotifyUrl(e.target.value)}
                />
                <button type="submit" className={styles.smallButton} disabled={isSpotifyLoading || !spotifyUrl.trim()}>
                  {isSpotifyLoading ? 'Bezig...' : 'Toevoegen'}
                </button>
              </form>
              {spotifyError && <span className={styles.errorNote}>{spotifyError}</span>}
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.smallButton}
                onClick={handleSpotifyConnect}
                disabled={isSpotifyConnecting}
              >
                {isSpotifyConnecting ? 'Bezig...' : 'Verbind met Spotify'}
              </button>
              {spotifyConnectError && (
                <span className={styles.errorNote}>
                  {spotifyConnectError} Open eventueel eerst de instellingen om een Spotify Client ID in te vullen.
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div className={styles.trackList}>
        {library.length === 0 && <p className={styles.emptyState}>Nog geen tracks in de bibliotheek.</p>}
        {library.map((track) => (
          <div className={styles.row} key={track.id}>
            <div className={styles.artwork}>
              {track.artworkUrl ? (
                <img src={track.artworkUrl} alt="" className={styles.artworkImg} />
              ) : (
                <div className={styles.artworkPlaceholder} />
              )}
            </div>
            <div className={styles.info}>
              <span className={styles.trackTitle}>{track.title}</span>
              {track.artist && <span className={styles.trackArtist}>{track.artist}</span>}
            </div>
            <span className={styles.sourceBadge}>{SOURCE_LABELS[track.source]}</span>
            <span className={styles.bpm}>{track.bpm ? track.bpm.toFixed(0) : '--'} BPM</span>
            <span className={styles.duration}>{formatDuration(track.durationMs)}</span>
            <div className={styles.deckButtons}>
              {deckIds.map((deckId) => (
                <button
                  key={deckId}
                  type="button"
                  className={`${styles.deckButton} ${deckId % 2 === 0 ? styles.deckButtonA : styles.deckButtonB}`}
                  onClick={() => loadTrackToDeck(deckId, track)}
                  title={`Laad op deck ${deckId + 1}`}
                >
                  {deckId + 1}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => removeTrack(track.id)}
              aria-label="Verwijder track"
              title="Verwijder track"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
