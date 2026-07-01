// Optional sentence-level translation + grammar notes via the Claude API.
// Off unless useTranslate is set and an Anthropic API key is configured. Results are
// cached per line (in memory + on disk) so replayed/looping dialogue costs nothing extra.
//
// Uses the official @anthropic-ai/sdk (imported lazily so the feature degrades gracefully
// if the package isn't installed). The request is intentionally plain — no thinking/effort/
// sampling params — so it works across model tiers (haiku/sonnet/opus) without 400s.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = join(ROOT, "server", "data", "translate-cache.json");

let client = null;
let model = "claude-haiku-4-5";
let enabled = false; // sentence translation feature (gated by useTranslate)
let hasKey = false; // an Anthropic client exists (enables OCR regardless of useTranslate)
let cache = {};
let cacheLoaded = false;

const OCR_SYSTEM = `You transcribe text from Pokémon Emerald (Game Boy Advance, Japanese) screenshots,
which use a small pixel font. Transcribe the on-screen text EXACTLY — character by character, in
reading order (top to bottom), preserving the spaces between words and the line breaks.

The dialogue is hiragana and katakana only (no kanji). Read every kana precisely and do NOT add,
drop, or change any character — in particular keep particles and small kana exactly as shown
(か / が, は / ば / ぱ, っ, ゃ ゅ ょ, ー, ん). Do NOT translate, romanize, explain, or "correct" the
grammar; output the literal characters even if the result looks grammatically unusual. Include
punctuation/symbols (。 ！ ？ 「 」 … ♥) as shown. If a glyph is genuinely unclear, give your single
best reading. Output ONLY the Japanese text (newlines between separate lines). If no Japanese text
is visible, output nothing.`;

const SYSTEM = `You help an English speaker learning Japanese by playing Pokémon Emerald (Japanese version).
You receive ONE line of in-game Japanese text (hiragana/katakana, sometimes with the player's name already filled in).
Respond with a single compact JSON object and nothing else:
{"translation": "<natural, faithful English translation>", "notes": ["<short note>", ...]}
Rules:
- 1 to 4 notes, each a short beginner-friendly explanation of a particle, verb form, or set phrase in the line.
- No markdown, no code fences, no text outside the JSON object.`;

export async function initTranslate(config) {
  const a = config.anthropic || {};
  model = a.model || "claude-haiku-4-5";
  if (a.apiKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      client = new Anthropic({ apiKey: a.apiKey });
      hasKey = true;
    } catch (e) {
      console.warn(`[anthropic] @anthropic-ai/sdk unavailable: ${e.message}`);
    }
  }
  enabled = !!(config.useTranslate && hasKey);
  console.log(
    `[anthropic] model ${model} — translation ${enabled ? "on" : "off"}, OCR ${hasKey ? "on" : "off"}`
  );
  return { enabled, ocrEnabled: hasKey };
}

export function isEnabled() {
  return enabled;
}
export function isOcrEnabled() {
  return hasKey;
}

/**
 * Transcribe Japanese text visible in a screenshot via Claude vision.
 * @param {string} imageBase64 - base64 (no data: prefix)
 * @param {string} mediaType - e.g. "image/png"
 * @returns {Promise<string|null>} transcribed Japanese (may be empty), or null if no key
 */
const ocrCache = new Map(); // image hash -> transcription (skips API on identical screens)

export async function transcribe(imageBase64, mediaType = "image/png") {
  if (!hasKey) return null;
  const key = createHash("sha1").update(imageBase64).digest("hex");
  if (ocrCache.has(key)) return ocrCache.get(key);
  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    system: OCR_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Transcribe the Japanese text on this screen." },
        ],
      },
    ],
  });
  const text = (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  ocrCache.set(key, text);
  if (ocrCache.size > 100) ocrCache.delete(ocrCache.keys().next().value);
  return text;
}

const ASK_SYSTEM = (jp, tr) =>
  `You are a warm, concise Japanese tutor for a beginner who currently reads only romaji.
They are reading this line from Pokémon Emerald (Japanese):\n「${jp}」` +
  (tr ? `\nEnglish meaning: ${tr}` : "") +
  `\n\nAnswer their questions about this line. Always include romaji in parentheses after any
Japanese you write (e.g. だから (dakara)). Keep it short and friendly (1–4 sentences) unless they
ask for more depth. Stay focused on helping them understand this line and its Japanese.`;

/**
 * Follow-up Q&A about a line. messages = prior [{role:'user'|'assistant', content}].
 * @returns {Promise<string|null>}
 */
export async function ask(japanese, translation, messages) {
  if (!hasKey) return null;
  const turns = (messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    .slice(-12);
  if (!turns.length || turns[turns.length - 1].role !== "user") return null;
  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    system: ASK_SYSTEM(japanese, translation),
    messages: turns,
  });
  return (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function loadCache() {
  if (cacheLoaded) return;
  if (existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    } catch {
      cache = {};
    }
  }
  cacheLoaded = true;
}

async function saveCache() {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache));
}

function parseLoose(text) {
  const t = (text || "").trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      return {
        translation: o.translation || "",
        notes: Array.isArray(o.notes) ? o.notes.slice(0, 4) : [],
      };
    } catch {
      /* fall through */
    }
  }
  return { translation: t, notes: [] };
}

/**
 * Translate one Japanese line. Returns {translation, notes} or null if disabled.
 * @param {string} japanese
 */
export async function translate(japanese) {
  if (!enabled || !japanese) return null;
  await loadCache();
  if (cache[japanese]) return cache[japanese];

  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: japanese }],
  });
  const text = (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const result = parseLoose(text);
  cache[japanese] = result;
  saveCache().catch(() => {});
  return result;
}
