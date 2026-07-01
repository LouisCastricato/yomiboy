# Deploying to Vercel (private)

This app is structured for Vercel: a **static frontend** (`public/`, built from `web/` + the
mGBA WASM core) plus **serverless functions** in `api/` (`ocr`, `enrich`, `translate`, `tts`,
`status`). History and saved words live in the browser (localStorage). There's no database and
no always-on server.

## One-time prep

1. **Install deps and build the dictionaries** (needs the full JMdict download once):
   ```bash
   npm install
   npm run setup        # downloads JMdict + pitch data, builds the charmap
   npm run build:dict   # → server/data/jmdict-compact.json  (~6 MB, common words)
   ```
   `jmdict-compact.json` and `pitch_accents.txt` are **committed** (the enrich function bundles
   them); the full `jmdict-eng.json` stays gitignored.

2. **Install the Vercel CLI and log in:**
   ```bash
   npm i -g vercel
   vercel login
   ```

## Configure secrets (Vercel env vars)

Set these on the project (dashboard → Settings → Environment Variables, or `vercel env add`):

| Variable | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | your Claude key (`sk-ant-…`) | **yes** (OCR + translation) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | recommended (haiku misreads the tiny font) |
| `USE_TRANSLATE` | `true` | enables the sentence-translation button |
| `ELEVENLABS_API_KEY` / `USE_ELEVENLABS` | optional | nicer TTS (else free browser voice) |

These are read by `server/api-core.mjs` (env first, then local `server/config.json`).

## Bundle your ROM (optional, private only)

Drop your legally-owned ROM at **`web/rom/game.gba`** — it auto-loads on page open. It's
gitignored by default; for a private Vercel deploy, force-add it (`git add -f web/rom/game.gba`)
or rely on `vercel` CLI upload. **Do not** do this on a public deploy — distributing the
commercial ROM is copyright infringement. Without a bundled ROM, users click **📂 Load ROM**.

## Deploy

```bash
vercel          # preview deploy
vercel --prod   # production
```

`vercel.json` sets the build (`scripts/build-vercel.mjs` → `public/`), the function configs
(memory / `maxDuration` / `includeFiles` for the enrich function's dictionary + kuromoji data),
and the **COOP/COEP headers** the threaded WASM emulator needs.

## Notes / caveats

- **Cold starts:** the `enrich` function loads kuromoji + the 6 MB dictionary (~1–3 s) on a cold
  start, then stays warm. OCR/translate call Claude (a few seconds each).
- **Private use:** your key is used server-side for every visitor. Don't share the URL widely or
  you'll pay for others' usage — for a public deploy, switch to a per-user-key model first.
- **Fonts:** the cross-origin-isolation headers block Google Fonts on the page; it falls back to
  the system Japanese font (looks fine). Self-host the fonts if you want them exact.
- **Local dev** is unchanged: `npm start` → http://localhost:8080 (uses the same `api-core`).
