// JMdict (jmdict-simplified) loader + lookup. Optional: if the JSON isn't present
// (user hasn't run `npm run setup`), lookups return null and the app still works
// (romaji + readings, just no English glosses).

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/** key (kanji text or kana text) -> array of compact entries */
const index = new Map();
let loaded = false;
let entryCount = 0;

function addKey(key, entry) {
  if (!key) return;
  let arr = index.get(key);
  if (!arr) index.set(key, (arr = []));
  // de-dup identical entries that share both a kanji and kana key
  if (!arr.includes(entry)) arr.push(entry);
}

/**
 * Load jmdict-simplified JSON from `path`. Safe to call when the file is missing.
 * @returns {boolean} whether a dictionary was loaded
 */
export async function load(path) {
  if (!path || !existsSync(path)) {
    console.warn(
      `[dict] JMdict not found at ${path} — meanings disabled. Run \`npm run setup\` to enable.`
    );
    return false;
  }
  const raw = await readFile(path, "utf8");
  const data = JSON.parse(raw);
  const words = data.words || [];
  for (const w of words) {
    const glosses = [];
    const posSet = new Set();
    for (const s of w.sense || []) {
      for (const g of s.gloss || []) if (g.text) glosses.push(g.text);
      for (const p of s.partOfSpeech || []) posSet.add(p);
    }
    if (!glosses.length) continue;
    const common =
      (w.kanji || []).some((k) => k.common) ||
      (w.kana || []).some((k) => k.common);
    const entry = {
      glosses: glosses.slice(0, 8),
      pos: [...posSet],
      kanji: (w.kanji || []).map((k) => k.text),
      kana: (w.kana || []).map((k) => k.text),
      common,
    };
    entryCount++;
    for (const k of w.kanji || []) addKey(k.text, entry);
    for (const k of w.kana || []) addKey(k.text, entry);
  }
  // Sort each key's entries so common (everyday) meanings come first — helps homographs
  // like きみ surface 君 ("you") ahead of 黄身 ("egg yolk").
  for (const arr of index.values()) {
    arr.sort((a, b) => (b.common ? 1 : 0) - (a.common ? 1 : 0));
  }
  loaded = true;
  console.log(
    `[dict] loaded ${entryCount} JMdict entries (${index.size} lookup keys)`
  );
  return true;
}

export function isLoaded() {
  return loaded;
}

/**
 * Look up a word (exact match against any kanji or kana form).
 * Tries the candidates in order and returns the first hit.
 * @param {...string} candidates
 * @returns {Array|null}
 */
export function lookup(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const hit = index.get(c);
    if (hit) return hit;
  }
  return null;
}
