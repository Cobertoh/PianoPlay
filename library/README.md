# Adding songs to PianoPlay

1. Drop a `.mid` file into `library/midi/` (e.g. `library/midi/clair-de-lune.mid`).
2. Add an entry to `library/index.json`:

```json
{ "songs": [
  { "id": "clair-de-lune", "title": "Clair de Lune", "composer": "Claude Debussy", "era": "Impressionist",
    "level": "Advanced", "cat": "classical", "file": "library/midi/clair-de-lune.mid" }
] }
```

3. Commit and push – Cloudflare Pages redeploys and the song appears in **Songs** (it is parsed in the browser when opened).

Find free public-domain MIDI scores on Mutopia Project or IMSLP. MIDI files give exact notes, so the sheet music and lessons are accurate.
