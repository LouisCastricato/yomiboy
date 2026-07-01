#!/usr/bin/env node
// Builds a compact JMdict for the serverless enrich function: common-word entries only,
// trimmed to the fields we use, in the same schema as jmdict-eng.json so dict.mjs loads it
// unchanged. Cuts ~112MB → a few MB so a Vercel cold start parses it in well under a second.

import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "server", "data", "jmdict-eng.json");
const OUT = join(ROOT, "server", "data", "jmdict-compact.json");

const full = JSON.parse(await readFile(SRC, "utf8"));
const words = [];
for (const w of full.words || []) {
  const commonKanji = (w.kanji || []).filter((k) => k.common);
  const commonKana = (w.kana || []).filter((k) => k.common);
  if (!commonKanji.length && !commonKana.length) continue; // common entries only
  const sense = (w.sense || [])
    .map((s) => ({
      partOfSpeech: s.partOfSpeech || [],
      gloss: (s.gloss || []).slice(0, 6).map((g) => ({ text: g.text })),
    }))
    .filter((s) => s.gloss.length)
    .slice(0, 4);
  if (!sense.length) continue;
  words.push({
    kanji: (w.kanji || []).map((k) => ({ text: k.text, common: !!k.common })),
    kana: (w.kana || []).map((k) => ({ text: k.text, common: !!k.common })),
    sense,
  });
}
await writeFile(OUT, JSON.stringify({ words }));
const { size } = await stat(OUT);
console.log(`compact JMdict: ${words.length} common entries, ${(size / 1e6).toFixed(1)} MB → ${OUT}`);
