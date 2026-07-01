// Optional pitch-accent lookup, backed by server/data/pitch_accents.txt
// (mifunetoshiro/kanjium raw accents). Format per line: term<TAB>reading<TAB>accent
// where `accent` is the mora position of the downstep (0 = heiban / no downstep).
// If the file is absent, lookups return null and pitch marks are simply omitted.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const byTermReading = new Map(); // `${term}${reading}` -> accent
const byReading = new Map(); // reading -> accent (fallback)
let loaded = false;

export async function load(path) {
  if (!path || !existsSync(path)) return false;
  const raw = await readFile(path, "utf8");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [term, reading, accentRaw] = parts;
    const accent = parseInt(String(accentRaw).split(/[,\s]/)[0], 10);
    if (Number.isNaN(accent)) continue;
    if (term && reading) byTermReading.set(`${term}${reading}`, accent);
    if (reading && !byReading.has(reading)) byReading.set(reading, accent);
  }
  loaded = byTermReading.size > 0 || byReading.size > 0;
  if (loaded)
    console.log(`[pitch] loaded ${byTermReading.size} pitch-accent entries`);
  return loaded;
}

export function isLoaded() {
  return loaded;
}

/** @returns {number|null} downstep mora position (0 = heiban), or null if unknown */
export function lookup(term, reading) {
  if (!loaded) return null;
  if (term && reading) {
    const k = byTermReading.get(`${term}${reading}`);
    if (k !== undefined) return k;
  }
  if (reading) {
    const k = byReading.get(reading);
    if (k !== undefined) return k;
  }
  return null;
}
