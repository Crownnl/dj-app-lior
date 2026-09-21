import { getStoredValue, STORAGE_KEYS } from '../config'
import type { Track } from '../types'

/**
 * Dropbox file import.
 *
 * Dropbox never exposes a public npm SDK with an official Chooser UI, so this
 * loads Dropbox's own hosted "dropins.js" script at runtime (as their docs
 * prescribe) and drives the resulting window.Dropbox.choose() picker. Chosen
 * files come back as direct https: links (linkType: 'direct'), which are
 * directly playable -- exactly like a 'file' track -- so they are mapped onto
 * Track.playUrl the same way.
 */

const DROPBOX_SCRIPT_ID = 'dropboxjs'
const DROPBOX_SCRIPT_SRC = 'https://www.dropbox.com/static/api/2/dropins.js'
const READY_POLL_INTERVAL_MS = 100
const READY_TIMEOUT_MS = 10_000

// --- Minimal shape of the Dropbox Chooser API (window.Dropbox), loaded at
// runtime from a <script> tag -- there is no official TypeScript package for
// this. ---
interface DropboxChooserFile {
  name: string
  link: string
  bytes: number
  icon: string
  thumbnailLink?: string
  isDir?: boolean
}

interface DropboxChooserOptions {
  success: (files: DropboxChooserFile[]) => void
  cancel: () => void
  linkType: 'direct' | 'preview'
  multiselect: boolean
  extensions: string[]
}

declare global {
  interface Window {
    Dropbox?: {
      choose(options: DropboxChooserOptions): void
    }
  }
}

// Module-level singleton: at most one dropins.js load is ever in flight,
// keyed off the actual <script id="dropboxjs"> tag in the document so it
// survives being called from multiple places without double-injecting.
let chooserScriptPromise: Promise<void> | null = null

export function isDropboxConfigured(): boolean {
  return getStoredValue(STORAGE_KEYS.dropboxAppKey).trim().length > 0
}

export function loadDropboxChooserScript(appKey: string): Promise<void> {
  const existing = document.getElementById(DROPBOX_SCRIPT_ID) as HTMLScriptElement | null

  if (existing && existing.getAttribute('data-app-key') === appKey) {
    if (window.Dropbox) return Promise.resolve()
    if (chooserScriptPromise) return chooserScriptPromise
    // The tag is present (e.g. left over from a previous call that never
    // settled) but we have no in-flight promise for it -- wait on it as-is
    // rather than re-creating the tag.
    chooserScriptPromise = waitForDropboxReady(existing)
    return chooserScriptPromise
  }

  // No script tag yet, or a previous load used a different app key -- drop
  // the old tag (if any) and inject a fresh one bound to this key.
  if (existing) existing.remove()
  window.Dropbox = undefined
  chooserScriptPromise = null

  const script = document.createElement('script')
  script.id = DROPBOX_SCRIPT_ID
  script.src = DROPBOX_SCRIPT_SRC
  script.async = true
  script.setAttribute('data-app-key', appKey)
  document.head.appendChild(script)

  chooserScriptPromise = waitForDropboxReady(script)
  return chooserScriptPromise
}

function waitForDropboxReady(script: HTMLScriptElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let pollHandle = 0

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearInterval(pollHandle)
      fn()
    }

    script.addEventListener('error', () => {
      finish(() => reject(new Error('Kon het Dropbox-script niet laden. Controleer je internetverbinding.')))
    })

    const startedAt = Date.now()
    pollHandle = window.setInterval(() => {
      if (window.Dropbox) {
        finish(resolve)
      } else if (Date.now() - startedAt > READY_TIMEOUT_MS) {
        finish(() =>
          reject(new Error('Dropbox-bestandskiezer kon niet geladen worden (time-out). Probeer het later opnieuw.')),
        )
      }
    }, READY_POLL_INTERVAL_MS)
  })
}

function stripExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName
}

/** Opens the Dropbox file picker and resolves with the tracks the user chose (or [] if they cancelled). */
export async function openDropboxChooser(): Promise<Track[]> {
  const appKey = getStoredValue(STORAGE_KEYS.dropboxAppKey).trim()
  if (!appKey) {
    throw new Error(
      'Er is nog geen Dropbox app-key ingesteld. Vul er een in bij de instellingen (gratis aan te maken via https://www.dropbox.com/developers/apps).',
    )
  }

  await loadDropboxChooserScript(appKey)

  if (!window.Dropbox) {
    throw new Error('Dropbox is niet beschikbaar. Probeer het later opnieuw.')
  }

  return new Promise<Track[]>((resolve, reject) => {
    try {
      window.Dropbox!.choose({
        success: (files) => {
          const tracks: Track[] = files.map((file) => ({
            id: crypto.randomUUID(),
            title: stripExtension(file.name),
            source: 'dropbox',
            playUrl: file.link,
            artworkUrl: file.thumbnailLink,
            addedAt: Date.now(),
          }))
          resolve(tracks)
        },
        cancel: () => resolve([]),
        linkType: 'direct',
        multiselect: true,
        extensions: ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'],
      })
    } catch {
      reject(new Error('Kon de Dropbox-bestandskiezer niet openen. Probeer het opnieuw.'))
    }
  })
}
