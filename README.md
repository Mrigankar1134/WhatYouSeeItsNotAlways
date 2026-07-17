# The Garden Beyond Seasons

> *“Some people don't stay forever. Some never become ours. Yet somehow… they still become part of who we are.”*

A cinematic, **local-first** memory sanctuary that lives entirely in the browser. You walk a quiet
garden, plant memories as flowers, and return to them whenever you wish. Nothing is uploaded, tracked,
or scored. The garden is alive even when you do nothing.

This is a self-contained, **zero-build** implementation: open it and it runs. Three.js is vendored
locally, all audio is synthesised procedurally at runtime, and every flower and prop is generated from
code — so there are no external assets to download and nothing leaves your device.

## Running it

Because it uses ES modules, it must be served over HTTP (not opened as a `file://`):

```bash
# from the project root — any static server works
python -m http.server 8123
# then open http://localhost:8123
```

Or with Node: `npx serve .`

A modern browser with WebGL2 is recommended. Audio begins only after you consent on the first screen.

## What's inside

| Experience | Status |
|---|---|
| Cinematic opening (darkness → felt-piano note → mist → gate → "scroll to enter") | ✅ |
| Calm camera on a spline through connected zones, damped scroll travel | ✅ |
| Memory Garden with plantable bare-soil spots that glow on focus | ✅ |
| Tactile parchment **Memory Journal** (title, date, place, emotion, story, song) | ✅ |
| Six emotion → flower mappings (Joy, Love, Comfort, Adventure, Goodbye, Silence) | ✅ |
| Planting & bloom ceremony (seed → soil glow → sprout → bloom) with camera approach | ✅ |
| Memory Viewer on translucent parchment; edit / return-to-soil | ✅ |
| Garden Journal **archive** with search + emotion filters (pressed-flower cards) | ✅ |
| Reflection Pond with shader ripples + surfacing memory fragments | ✅ |
| Quiet Bench (UI + music fade to silence; *Stand and continue* after 30s) | ✅ |
| Forgotten Bridge (cannot be crossed; two quiet inscriptions) | ✅ |
| Exit Meadow (inscription, fade to warm white, return to entrance later in the day) | ✅ |
| **24-minute** day/night cycle (sky shader, sun, fog, water, fireflies) | ✅ |
| Gentle weather (mist / wind) with eased transitions | ✅ |
| Instanced wind-driven grass, drifting pollen, falling petals, night fireflies | ✅ |
| Procedural **AdaptiveAudioManager** — pad, wind, birds by day, crickets by night, cues | ✅ |
| Local-first storage (IndexedDB) + draft autosave | ✅ |
| Encrypted **`.seed`** export / restore (AES-GCM + PBKDF2, merge or replace) | ✅ |
| Accessibility: reduced motion, high contrast, dyslexia font, text size, per-bus volume, keyboard, focus trapping | ✅ |

### Controls

- **Scroll / swipe** — drift forward along the path
- **Click / tap** — plant on bare soil, open a flower, ripple the pond, sit on the bench
- **Arrow keys / W,S** — gentle movement · **J** journal · **M** sound · **A** comfort & access · **Esc** stand / close · **Enter** activate

## Architecture

```
index.html          entry, import map, overlay DOM
styles.css          design tokens + all overlay UI
vendor/three.module.js   (vendored locally)
src/
  config.js         centralised copy, zones, emotion→flower palette
  db.js             IndexedDB + prefs + draft autosave
  audio.js          fully procedural Web-Audio score & cues
  flowers.js        procedural per-emotion flower geometry + bloom/sway
  world.js          scene, terrain, sky, gate, pond, bench, bridge, meadow,
                    grass, particles, camera spline, time-of-day, weather, picking
  seed.js           encrypted .seed export/restore
  ui.js             journal / viewer / archive / accessibility overlays
  main.js           orchestrator: state, input, opening, zones, planting flow
```

Simulation is kept separate from rendering; state lives in a small central object rather than one giant
component. Deterministic seeded randomness drives each flower's shape.

## Privacy

No analytics, trackers, accounts, or network calls after the initial page load. Memories, photos-in-spirit,
and preferences live only in this browser's IndexedDB / localStorage. The only way anything leaves the
device is an **encrypted `.seed`** file you choose to export — protected by a passphrase that cannot be
recovered.

## Notes & honest gaps

- Fonts load from Google Fonts for typographic beauty, with graceful serif/sans fallbacks; drop the
  `<link>` in `index.html` and bundle the WOFF2 files under `assets/` for a fully offline install.
- 3D assets are **procedural stand-ins** (low-poly, hand-tuned), not sourced art — in the spirit of the
  brief's "simple temporary assets until final assets are wired." The systems (planting, time, weather,
  audio, storage, crypto, accessibility) are real and complete.
- Photo/audio *capture* fields are scoped to text + song reference in this build; the schema and storage
  layer already carry space for local media.

Built to feel like a place you can visit — not a feature set you operate.
