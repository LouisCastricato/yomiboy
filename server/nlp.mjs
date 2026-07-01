// Turns a decoded Japanese line into enriched, hoverable tokens:
//   { japanese, romaji, tokens:[{ surface, reading, romaji, pos, dictForm, furigana,
//                                 glosses, pitch, isWord }] }
//
// Strategy for Pokemon's all-kana text (the hard part — no kanji to anchor segmentation):
//   * Full-line romaji comes straight from wanakana (kana->romaji is deterministic and the
//     game inserts spaces at word boundaries) -> always reliable.
//   * The game's own spaces are real word boundaries, so we segment on them first.
//   * Within each segment we do a greedy JMdict longest-match (dictionary words win), and
//     hand leftover runs to kuromoji, which deinflects verbs/adjectives and tags proper
//     nouns. This recovers correct words like 仲間/大切 that kuromoji alone mis-splits.
//   * Glosses are only shown for content words; particles/aux/symbols get a POS label only
//     (looking those up in JMdict returns misleading rare homographs).
//   * For anything still ambiguous, the optional Claude sentence translation is the backstop.

import kuromoji from "kuromoji";
import { toRomaji, toHiragana, isKatakana } from "wanakana";
import * as dict from "./dict.mjs";
import * as pitch from "./pitch.mjs";

let tokenizer = null;
const MAX_MATCH = 8; // longest dictionary word (in chars) we'll try to match in a segment
// Only override kuromoji with a longest-match of >=3 chars: the good multi-kana compounds
// kuromoji mis-splits (たいせつ/なかま) are 3+, while bad grabs (かえ from かえろう) are 2-char.
// Shorter words + verb/adjective conjugations are left to kuromoji (which deinflects).
const MIN_MATCH = 3;

// kuromoji Japanese POS -> short English label.
const POS_MAP = {
  名詞: "noun",
  代名詞: "pronoun",
  動詞: "verb",
  形容詞: "adjective",
  形容動詞: "na-adjective",
  副詞: "adverb",
  助詞: "particle",
  助動詞: "aux. verb",
  連体詞: "adnominal",
  接続詞: "conjunction",
  感動詞: "interjection",
  接頭詞: "prefix",
  接頭辞: "prefix",
  接尾: "suffix",
  フィラー: "filler",
  記号: "symbol",
  数: "number",
};

// JMdict partOfSpeech codes -> short English label (for longest-match tokens).
const JMDICT_POS = {
  n: "noun",
  pn: "pronoun",
  adv: "adverb",
  prt: "particle",
  int: "interjection",
  exp: "expression",
  conj: "conjunction",
  "adj-i": "adjective",
  "adj-na": "na-adjective",
  "adj-no": "adjective",
  "aux-v": "aux. verb",
  aux: "auxiliary",
  num: "number",
  pref: "prefix",
  suf: "suffix",
  vs: "verb",
  cop: "copula",
};

// POS labels that are content words worth a dictionary meaning.
const CONTENT_POS = new Set([
  "noun",
  "pronoun",
  "verb",
  "adjective",
  "na-adjective",
  "adverb",
  "interjection",
  "conjunction",
  "expression",
  "prefix",
  "suffix",
  "number",
]);

export async function initNlp({ dicPath, jmdictPath, pitchPath }) {
  tokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tk) => (err ? reject(err) : resolve(tk)));
  });
  await dict.load(jmdictPath);
  await pitch.load(pitchPath);
  return { dictLoaded: dict.isLoaded(), pitchLoaded: pitch.isLoaded() };
}

/** Tidy decoded text for display: collapse runs of spaces, trim around newlines. */
function normalizeForDisplay(s) {
  return s
    .replace(/　/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function kuromojiPos(t) {
  if (t.pos === "名詞" && t.pos_detail_1 === "代名詞") return "pronoun";
  return POS_MAP[t.pos] || t.pos;
}

function jmdictPos(codes) {
  for (const c of codes) {
    if (JMDICT_POS[c]) return JMDICT_POS[c];
    if (c.startsWith("v")) return "verb";
  }
  return codes[0] || "";
}

// Reorder homograph entries so the one whose JMdict POS matches kuromoji's reading of the
// word comes first (e.g. きミ as a pronoun -> 君 "you", not 黄身 "egg yolk"), then common.
const POS_TO_JMDICT = {
  pronoun: ["pn"],
  noun: ["n"],
  adverb: ["adv"],
  particle: ["prt"],
  interjection: ["int"],
  conjunction: ["conj"],
  "na-adjective": ["adj-na"],
  adjective: ["adj-i", "adj-no"],
  "aux. verb": ["aux-v", "aux"],
};
function hitMatchesPos(entry, posLabel) {
  if (posLabel === "verb") return entry.pos.some((c) => c.startsWith("v"));
  const codes = POS_TO_JMDICT[posLabel];
  return codes ? entry.pos.some((c) => codes.includes(c)) : false;
}
function sortHits(hits, posLabel) {
  return [...hits].sort((a, b) => {
    const am = posLabel && hitMatchesPos(a, posLabel) ? 0 : 1;
    const bm = posLabel && hitMatchesPos(b, posLabel) ? 0 : 1;
    if (am !== bm) return am - bm;
    return (b.common ? 1 : 0) - (a.common ? 1 : 0);
  });
}

function mergeGlosses(hits) {
  const glosses = [];
  for (const e of hits.slice(0, 3)) {
    for (const g of e.glosses) {
      if (!glosses.includes(g)) glosses.push(g);
      if (glosses.length >= 7) break;
    }
    if (glosses.length >= 7) break;
  }
  return glosses.length ? glosses : null;
}

// Split kana into mora and romanize each (for the per-kana learning view).
// Small kana (ゃゅょ, ぁぃぅぇぉ, ゎ) attach to the preceding mora so combos stay correct.
const KANA_COMBINE = new Set([..."ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ"]);
function moraPairs(surface) {
  const out = [];
  for (const ch of surface) {
    if (KANA_COMBINE.has(ch) && out.length) out[out.length - 1].k += ch;
    else out.push({ k: ch, r: "" });
  }
  for (const m of out) m.r = toRomaji(m.k);
  return out;
}

function baseToken(surface, reading, romaji, pos, dictForm, glosses) {
  const hasKanji = /[一-龯]/.test(surface);
  return {
    surface,
    reading,
    romaji,
    pos,
    dictForm,
    furigana: hasKanji ? reading : null,
    // per-kana romaji, only when the surface is pure kana (no kanji / latin / digits)
    mora: hasKanji || /[A-Za-z0-9]/.test(surface) ? null : moraPairs(surface),
    glosses,
    pitch: pitch.lookup(dictForm, reading),
    isWord: pos !== "symbol",
  };
}

/** Build a token from a JMdict longest-match hit (surface is kana from the game text). */
function dictToken(surface, hits) {
  const reading = isKatakana(surface) ? toHiragana(surface) : surface;
  const pos = jmdictPos(hits[0].pos);
  const dictForm = hits[0].kanji[0] || surface;
  const glosses = CONTENT_POS.has(pos) ? mergeGlosses(hits) : null;
  return baseToken(surface, reading, toRomaji(surface), pos, dictForm, glosses);
}

/** Build a token from a kuromoji morpheme (handles conjugation + unknown proper nouns). */
function kuromojiToken(t) {
  const readingKata = t.reading && t.reading !== "*" ? t.reading : t.surface_form;
  const reading = isKatakana(readingKata) ? toHiragana(readingKata) : readingKata;
  const dictForm =
    t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form;
  const pos = kuromojiPos(t);
  let glosses = null;
  if (dict.isLoaded() && CONTENT_POS.has(pos)) {
    const hits = dict.lookup(dictForm, t.surface_form, reading);
    if (hits) glosses = mergeGlosses(sortHits(hits, pos));
  }
  return baseToken(t.surface_form, reading, toRomaji(readingKata), pos, dictForm, glosses);
}

/** Segment one whitespace-delimited chunk into tokens (JMdict longest-match + kuromoji). */
function segmentTokens(seg, out) {
  let i = 0;
  let pending = "";
  const flush = () => {
    if (!pending) return;
    if (tokenizer) for (const t of tokenizer.tokenize(pending)) out.push(kuromojiToken(t));
    pending = "";
  };
  while (i < seg.length) {
    let matched = null;
    const maxL = Math.min(MAX_MATCH, seg.length - i);
    for (let L = maxL; L >= MIN_MATCH; L--) {
      const sub = seg.slice(i, i + L);
      const hits = dict.lookup(sub);
      // Require a COMMON dictionary word to override kuromoji: this keeps real compounds
      // (大切/仲間/元気) while rejecting rare homographs (e.g. 亜欧 for あおう=会おう) and
      // letting kuromoji deinflect conjugated verbs instead.
      if (hits && hits.some((h) => h.common)) {
        matched = { sub, hits, L };
        break;
      }
    }
    if (matched) {
      flush();
      out.push(dictToken(matched.sub, matched.hits));
      i += matched.L;
    } else {
      pending += seg[i];
      i++;
    }
  }
  flush();
}

/**
 * Enrich a raw decoded Japanese string.
 * @param {string} japaneseRaw
 * @returns {{japanese:string, romaji:string, tokens:Array}}
 */
export function enrich(japaneseRaw) {
  const japanese = normalizeForDisplay(japaneseRaw);
  const romaji = toRomaji(japanese).replace(/[ \t]+/g, " ").trim();

  const tokens = [];
  // Keep newlines as explicit break tokens; split on the game's spaces (word boundaries).
  const pieces = japanese.replace(/\n/g, " \n ").split(" ").filter((p) => p.length);
  for (const p of pieces) {
    if (p === "\n") {
      tokens.push({ br: true });
      continue;
    }
    segmentTokens(p, tokens);
  }
  return { japanese, romaji, tokens };
}
