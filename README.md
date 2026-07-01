# yomiboy

**Play Japanese Game Boy Advance games in your browser and read the dialogue as you go** —
live rōmaji, per-word dictionary meanings, per-kana readings, pitch accent, text-to-speech,
and on-demand sentence translation + grammar Q&A. Built for learners who read rōmaji.

Tuned for **Pokémon Emerald (JP)**, but the reader works on any Japanese GBA text.

## How it works

A single browser window runs the game and a reading panel side by side:

1. **Emulator** — [mGBA](https://mgba.io/) compiled to WebAssembly runs your ROM in the page.
2. **Continuous OCR** — as you play, the on-screen text is read automatically (Claude vision),
   once per line, with change-detection so it ignores the blinking cursor and doesn't re-read.
3. **Enrichment** — text is segmented with [kuromoji](https://github.com/takuyaa/kuromoji.js),
   romanized with [wanakana](https://github.com/WaniKani/WanaKana), and looked up in
   [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html); pitch accents from Kanjium.
4. **Reading panel** — each word becomes a hoverable chip with rōmaji over each kana, pitch
   marks, and meanings. Optional **sentence translation + grammar notes** and a **follow-up
   Q&A**, plus **save-to-Anki** and a searchable history.

## Quick start (local)

```bash
npm install
npm run setup          # downloads JMdict + pitch data, builds the charmap
cp server/config.example.json server/config.json
# add your Anthropic API key to server/config.json (for OCR + translation)
npm start              # → http://localhost:8080
```

Open the page, click **📂 Load ROM**, choose your Emerald (JP) file, and play. Dialogue flows
into the panel automatically.

- **Keys:** arrows = D-pad, `Z`=A, `X`=B, `A`=L, `S`=R, `Enter`=Start, `Backspace`=Select (or use the on-screen pad).
- OCR/translation need an Anthropic key; without one, the emulator + dictionary hover still work.
- History and saved words are stored in your browser (localStorage).

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — it ships to Vercel as a static frontend + serverless functions
(the enrich function bundles a compact dictionary; keys go in Vercel env vars).

## Bring your own ROM

**No ROM is included, and you should not commit or distribute one** — use a game you legally own.
For local use you can drop it at `web/rom/game.gba` to auto-load (gitignored).

## Stack & licenses

mGBA (MPL-2.0) · kuromoji (Apache-2.0) · wanakana (MIT) · JMdict (CC BY-SA) · Kanjium pitch data ·
Anthropic Claude (OCR + translation). This tool only reads your local emulator's screen.
