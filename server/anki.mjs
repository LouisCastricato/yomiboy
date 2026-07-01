// Saved-word storage + Anki export. Cards persist to server/data/cards.json and export
// as a tab-separated file that Anki imports directly (Front / Back / Tags columns).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "server", "data");
const CARDS = join(DATA, "cards.json");

let cards = [];
let ready = false;

async function ensureLoaded() {
  if (ready) return;
  if (existsSync(CARDS)) {
    try {
      cards = JSON.parse(await readFile(CARDS, "utf8"));
    } catch {
      cards = [];
    }
  }
  ready = true;
}

async function persist() {
  await mkdir(DATA, { recursive: true });
  await writeFile(CARDS, JSON.stringify(cards, null, 2));
}

/**
 * Add a card. Dedups by front (the Japanese word). Returns {added, total}.
 * card: { front, reading, romaji, meaning, sentence }
 */
export async function addCard(card) {
  await ensureLoaded();
  const front = (card.front || "").trim();
  if (!front) throw new Error("card.front is required");
  if (cards.some((c) => c.front === front)) {
    return { added: false, total: cards.length };
  }
  cards.push({
    front,
    reading: card.reading || "",
    romaji: card.romaji || "",
    meaning: card.meaning || "",
    sentence: card.sentence || "",
    added: card.ts || null,
  });
  await persist();
  return { added: true, total: cards.length };
}

export async function listCards() {
  await ensureLoaded();
  return cards;
}

function tsvEscape(s) {
  return String(s || "").replace(/[\t\r\n]+/g, " ").trim();
}

/** Anki-importable TSV: Front, Back (HTML), Tags */
export async function exportTsv() {
  await ensureLoaded();
  const header = "#separator:tab\n#html:true\n#columns:Front\tBack\tTags\n";
  const rows = cards.map((c) => {
    const back = [
      `${tsvEscape(c.reading)}${c.romaji ? ` (${tsvEscape(c.romaji)})` : ""}`,
      tsvEscape(c.meaning),
      c.sentence ? `<br><span style="color:#888">${tsvEscape(c.sentence)}</span>` : "",
    ]
      .filter(Boolean)
      .join("<br>");
    return `${tsvEscape(c.front)}\t${back}\tpokemon-emerald-jp`;
  });
  return header + rows.join("\n") + "\n";
}
