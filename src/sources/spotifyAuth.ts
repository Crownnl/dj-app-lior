// Spotify OAuth (Authorization Code + PKCE) — fully client-side, no backend
// and no client secret. Handles login kickoff, the redirect-back token
// exchange, refreshing, and reading back a currently-valid access token.
import { STORAGE_KEYS, getStoredValue } from '../config'

const PKCE_VERIFIER_STORAGE_KEY = 'dj-app.spotifyPkceVerifier' // sessionStorage
const TOKEN_STORAGE_KEY = 'dj-app.spotifyToken' // localStorage

const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize'

/** How long before real expiry we treat a token as "expiring" and refresh it. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000

interface StoredSpotifyToken {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

function getRedirectUri(): string {
  return window.location.origin + window.location.pathname
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateCodeVerifier(length = 64): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const randomValues = new Uint32Array(length)
  crypto.getRandomValues(randomValues)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += charset[randomValues[i] % charset.length]
  }
  return result
}

async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

function readStoredToken(): StoredSpotifyToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSpotifyToken>
    if (!parsed || typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null
    }
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

function writeStoredToken(token: StoredSpotifyToken): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
  } catch {
    /* ignore storage errors (private browsing, quota, etc.) */
  }
}

function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function getSpotifyClientId(): string {
  return getStoredValue(STORAGE_KEYS.spotifyClientId)
}

/** True once the user has entered a Spotify Client ID in settings. */
export function isSpotifyConfigured(): boolean {
  return getSpotifyClientId().trim().length > 0
}

/** True if we currently hold a token that's still valid, or can be refreshed. */
export function isSpotifyAuthorized(): boolean {
  const token = readStoredToken()
  if (!token) return false
  const stillValid = Date.now() < token.expiresAt
  return stillValid || Boolean(token.refreshToken)
}

/**
 * Kicks off the PKCE login flow: generates a code_verifier/code_challenge
 * pair, stashes the verifier for the redirect-back step, then navigates the
 * whole page to Spotify's authorize screen.
 */
export async function startSpotifyLogin(): Promise<void> {
  const clientId = getSpotifyClientId()
  if (!clientId) {
    throw new Error('No Spotify Client ID has been set yet. Add one in settings first.')
  }

  const verifier = generateCodeVerifier()
  const challenge = await deriveCodeChallenge(verifier)

  try {
    sessionStorage.setItem(PKCE_VERIFIER_STORAGE_KEY, verifier)
  } catch {
    /* ignore storage errors; the redirect-back step will simply fail cleanly */
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
  })

  window.location.href = `${AUTHORIZE_ENDPOINT}?${params.toString()}`
}

/**
 * Call once on app start. If the current URL carries a Spotify "code" param
 * (i.e. we just got redirected back from the authorize screen), exchanges it
 * for an access + refresh token and stores them. No-op otherwise. Never
 * throws — this runs unconditionally on every boot, so failures are only
 * logged.
 */
export async function handleSpotifyRedirectCallback(): Promise<void> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return

  try {
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_STORAGE_KEY)
    if (!verifier) {
      throw new Error('No stored PKCE code_verifier found for this Spotify login.')
    }
    const clientId = getSpotifyClientId()
    if (!clientId) {
      throw new Error('No Spotify Client ID configured.')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    })

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!response.ok) {
      throw new Error(`Spotify token exchange failed (status ${response.status})`)
    }
    const json = (await response.json()) as SpotifyTokenResponse
    writeStoredToken({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    })
  } catch (err) {
    console.error('Spotify: redirect login failed', err)
  } finally {
    try {
      sessionStorage.removeItem(PKCE_VERIFIER_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    history.replaceState({}, '', url.toString())
  }
}

async function refreshAccessToken(refreshToken: string): Promise<StoredSpotifyToken> {
  const clientId = getSpotifyClientId()
  if (!clientId) {
    throw new Error('No Spotify Client ID configured.')
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`Spotify token refresh failed (status ${response.status})`)
  }
  const json = (await response.json()) as SpotifyTokenResponse
  const refreshed: StoredSpotifyToken = {
    accessToken: json.access_token,
    // Spotify doesn't always rotate the refresh token; keep the old one if none comes back.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  writeStoredToken(refreshed)
  return refreshed
}

/**
 * Returns a currently-valid access token, refreshing it first if it's
 * expired (or about to expire) and we hold a refresh token. Returns null if
 * we've never authorized, or a refresh attempt fails.
 */
export async function getValidSpotifyAccessToken(): Promise<string | null> {
  const token = readStoredToken()
  if (!token) return null

  const isExpiring = Date.now() >= token.expiresAt - EXPIRY_SAFETY_MARGIN_MS
  if (!isExpiring) return token.accessToken

  if (!token.refreshToken) return null

  try {
    const refreshed = await refreshAccessToken(token.refreshToken)
    return refreshed.accessToken
  } catch (err) {
    console.error('Spotify: token refresh failed', err)
    return null
  }
}

/** Clears the stored Spotify token, effectively logging the app out. */
export function logoutSpotify(): void {
  clearStoredToken()
}
