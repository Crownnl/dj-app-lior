// Shared localStorage keys for user-supplied API credentials. Users must
// register their own free Dropbox app key / Spotify client ID — these
// platforms require every application to have its own identity, there is no
// way around that requirement.
export const STORAGE_KEYS = {
  dropboxAppKey: 'dj-app.dropboxAppKey',
  spotifyClientId: 'dj-app.spotifyClientId',
} as const

export function getStoredValue(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function setStoredValue(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* ignore storage errors (private browsing, quota, etc.) */
  }
}
