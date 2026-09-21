# DJ Deck

Een simpele, browser-gebaseerde DJ-app met hetzelfde mechanisme als een echte
2- tot 4-decks club/Rekordbox-set: per deck play/cue/pitch/loop, een mixer met
kanaalfaders, 3-band EQ, crossfader-toewijzing (A/THRU/B) en een crossfader.

Je kunt tracks laden vanaf: **lokale bestanden**, **Dropbox**, **SoundCloud**
en **Spotify**.

## Starten

```bash
npm install
npm run dev
```

Open de URL die Vite toont (standaard `http://localhost:5173`).

## Belangrijk: wat kan wel/niet per bron

| Bron | Play/pause/seek | Volume in mixer/crossfader | EQ, filters, gain trim | Golfvorm | Pitch/tempo, sync, loops |
|---|---|---|---|---|---|
| Bestanden | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dropbox | ✅ | ✅ | ✅ | ✅ | ✅ |
| SoundCloud | ✅ | ✅ (via widget-volume) | ❌ | ❌ | ❌ |
| Spotify | ✅ | ✅ (via SDK-volume) | ❌ | ❌ | ❌ |

Dit is geen technische keuze van deze app, maar een harde beperking van
SoundCloud en Spotify zelf: geen van beide platforms geeft een webpagina
toegang tot de ruwe audio van een track (dat zou hun auteursrecht-bescherming
omzeilen). Je kunt via hun eigen speler wel volume/crossfade regelen, maar
geen EQ, geen golfvorm en geen tempo/pitch-aanpassing. Voor "echt" mixen
(EQ'en, beatmatchen, loopen) gebruik je bestanden of Dropbox — daar heeft de
app wél volledige toegang tot het geluid via de Web Audio API.

## Eigen API-sleutels instellen

Klik rechtsboven op het tandwiel-icoon.

- **Dropbox**: maak een gratis app-key op
  https://www.dropbox.com/developers/apps en vul die in. Zet de eigen host
  van deze app op de allowlist van je Dropbox-app.
- **Spotify**: maak een gratis app op
  https://developer.spotify.com/dashboard, vul het Client ID in, en voeg de
  exacte URL die in de instellingen wordt getoond toe als "Redirect URI" in
  je Spotify-app-instellingen. Afspelen via Spotify vereist een **Spotify
  Premium**-account (verplicht door Spotify, geldt voor elke app die hun
  Web Playback SDK gebruikt).
- **SoundCloud** heeft geen sleutel nodig — plak gewoon een publieke
  SoundCloud-tracklink.

## Architectuur in het kort

- `src/engine/AudioEngine.ts` — de Web Audio-graaf: per deck
  gain-trim → laag/mid/hoog-EQ → kanaalfader → crossfader → master, plus een
  losse pad voor streaming-decks (SoundCloud/Spotify) die hun eigen volume
  regelen.
- `src/sources/*` — per bron een `DeckController`-implementatie achter
  hetzelfde interface, zodat de UI niet hoeft te weten waar een track
  vandaan komt.
- `src/store/useDjStore.ts` — de enige plek met applicatiestatus (Zustand).
- `src/components/*` — Deck-, Mixer-, Library- en Instellingen-UI.
