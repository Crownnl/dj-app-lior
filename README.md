# DJ Deck

A simple, browser-based DJ app with the same mechanics as a real 2-to-4-deck
club/Rekordbox set: per-deck play/cue/pitch/loop, a mixer with channel
faders, 3-band EQ, crossfader assign (A/THRU/B) and a crossfader — styled
after real hardware DJ mixers, and designed to work great on a phone held
sideways (landscape), just like a real controller.

Load tracks from **local files**, **Dropbox**, **SoundCloud** and **Spotify**.

## Run it locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## What each source can and can't do

| Source | Play/pause/seek | Mixer volume/crossfade | EQ, filters, gain trim | Waveform | Pitch/tempo, sync, loops |
|---|---|---|---|---|---|
| Files | ✅ | ✅ | ✅ | ✅ (colored 3-band) | ✅ |
| Dropbox | ✅ | ✅ | ✅ | ✅ (colored 3-band) | ✅ |
| SoundCloud | ✅ | ✅ (via widget volume) | ❌ | ❌ | ❌ |
| Spotify | ✅ | ✅ (via SDK volume) | ❌ | ❌ | ❌ |

This isn't a limitation of this app — it's a hard restriction from SoundCloud
and Spotify themselves: neither platform gives a web page access to a
track's raw audio (that would bypass their copyright protection). You get
volume/crossfade control through their own player, but no EQ, no waveform,
and no tempo/pitch changes. For real mixing (EQ'ing, beatmatching, looping)
use files or Dropbox — there the app has full access to the audio via the
Web Audio API.

## Set your own API keys

Click the gear icon in the top-right corner.

- **Dropbox**: create a free app key at
  https://www.dropbox.com/developers/apps and paste it in. Add this app's
  own host to that Dropbox app's allowed origins.
- **Spotify**: create a free app at
  https://developer.spotify.com/dashboard, paste the Client ID in, and add
  the exact URL shown in settings as a "Redirect URI" in that Spotify app's
  settings. Playback via Spotify requires a **Spotify Premium** account
  (required by Spotify for every app using their Web Playback SDK).
- **SoundCloud** needs no key — just paste a public SoundCloud track link.

## Install it like an app (PWA)

The app is a installable Progressive Web App: open it in Chrome (Android) or
Safari (iOS) and use "Add to Home Screen" / "Install app". It then launches
without browser chrome, remembers your Dropbox/Spotify settings, and works
offline for anything already cached.

## Native app (iOS / Android via Capacitor)

The `android/` and `ios/` folders are ready-made native app projects
(Capacitor), already configured with app icons, a splash screen, and a
landscape-only orientation lock. To actually build them you need tools this
sandboxed session doesn't have access to (Android's own package servers and
Xcode are blocked/unavailable here) — but on your own machine:

```bash
npm run build        # produces dist/, which the native projects load
npx cap sync          # copies the latest web build into android/ and ios/
```

**Android**: open the `android/` folder in
[Android Studio](https://developer.android.com/studio) — it downloads
whatever SDK components it needs automatically — then
Build → Generate Signed App Bundle/APK. You'll need a free Google Play
Console account ($25 one-time) to publish it.

**iOS**: open `ios/App/App.xcworkspace` in Xcode **on a Mac** (this is an
Apple requirement, not something any tool can route around), then
Product → Archive to submit to the App Store. You'll need an Apple Developer
Program account ($99/year).

Re-run `npx cap sync` after every `npm run build` to push web changes into
both native projects.

## Architecture, in short

- `src/engine/AudioEngine.ts` — the Web Audio graph: per-deck gain trim →
  low/mid/high EQ → channel fader → crossfader → master, plus a separate
  path for streaming decks (SoundCloud/Spotify) that manage their own volume.
- `src/sources/*` — one `DeckController` implementation per source behind
  the same interface, so the UI never needs to know where a track came from.
- `src/store/useDjStore.ts` — the single place holding app state (Zustand).
- `src/components/*` — Deck, Mixer, Library and Settings UI.
- `src/native.ts` — best-effort native bootstrap (status bar, splash
  screen), a no-op when running as a plain web page.
