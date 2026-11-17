# 🎹 PianoPlay

A modern piano-learning web app that runs entirely in the browser – installable on an iPhone home screen, works offline, no accounts, no paid APIs.

**Ways to learn**
- **Falling notes** over a realistic keyboard, with **live sheet music** that follows along
- **Watch** (it plays), **Learn** (wait mode – notes stop until you play them, Simply-Piano style) and **Play** (flow mode with timing scores)
- **Left / right hand** modes, speed 25–125 %, **A–B loop** (tap bars on the sheet), metronome
- **Microphone listening** – play a real piano and PianoPlay checks every note (touch keys and USB MIDI also work)
- **Library** of classical & folk pieces (Beginner / Intermediate / Advanced) with search and filters
- **Practice**: daily warm-up, scales (8 types, 12 keys), chords and progressions, hand drills, note-reading and keyboard quizzes
- **Learn path**, XP, streaks, progress tracking and personalised recommendations
- **Import**: audio file or microphone recording → sheet music, falling notes, L/R split, difficulty rating; MIDI import/export

## Deploy on Cloudflare Pages
1. Push this repo to GitHub (it is already at `Cobertoh/PianoPlay`).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings: **Framework preset: None · Build command: *(leave empty)* · Build output directory: `/`** (the repo root).
4. Save and deploy. You get a `https://…pages.dev` URL – HTTPS is required for the microphone.

## Add to iPhone home screen
Open the site in **Safari → Share → Add to Home Screen**. It then launches full-screen and works offline.

## Local development
```bash
npm test          # theory, library and audio-engine tests (Node 18+)
npm run dev       # static server on http://localhost:5173
npm run icons     # regenerate the app icons
```
No build step: plain ES modules.

## Honest limitations
- **YouTube links cannot be analysed.** Browsers don't let a web page read YouTube's audio and YouTube's terms forbid extracting it. PianoPlay validates the link and shows a reference player, but you must import an audio file / MIDI, or record with the microphone.
- **Audio → sheet music is approximate.** It's built on open DSP (spectral multi-pitch detection, beat tracking, key detection). On synthetic solo-piano tests it reaches note-F1 ≈ 0.8–0.95; full mixes, vocals, fast runs and dense chords are much worse. Tune tempo/sensitivity/simplify in the Import screen, or use a MIDI file for exact results.
- **Microphone detection** is most reliable for C3–C7 and one or two notes at once, in a quiet room. iPhone Safari has no Web MIDI, so the mic is the way to play a real instrument there.
- **Library pieces are simplified teaching arrangements** written from the public-domain melodies, not scanned scores; ones flagged "approx." may differ from the published edition. Several famous composers (Chopin, Liszt, Debussy, Tchaikovsky) are intentionally not bundled until exact scores are added – drop MIDI files into `library/` (see `library/README.md`) or import MIDI in the app.

## Extending
- **Songs** – add objects to `js/songs.js` (compact notation, validated by `npm test`) or MIDI files via `library/`.
- **Instruments** – `js/audio.js` is the only sound source (`noteOn/play`); swap in samples or new waveforms there.
- **Lessons / drills** – `js/practice.js` (`LESSONS`, `DRILLS`, generators).

## Credits
Music-notation glyph outlines are from GNU FreeFont's FreeSerif (GPL with font exception).
