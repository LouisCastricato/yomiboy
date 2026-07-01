import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { initNlp, enrich } from "../server/nlp.mjs";

const dicPath = new URL("../node_modules/kuromoji/dict", import.meta.url).pathname;
const jmdictPath = "server/data/jmdict-eng.json";
const hasDict = existsSync(jmdictPath);

before(async () => {
  await initNlp({
    dicPath,
    jmdictPath,
    pitchPath: "server/data/pitch_accents.txt",
  });
});

test("full-line romaji is reliable kana->romaji", () => {
  assert.equal(enrich("こんにちは").romaji, "konnichiha");
});

test("game spaces are preserved as word boundaries in romaji", () => {
  assert.equal(enrich("きみの なまえ").romaji, "kimino namae");
});

test("newlines become break tokens", () => {
  const t = enrich("あ\nい").tokens;
  assert.ok(t.some((x) => x.br === true));
});

test("particles carry a POS label but no (misleading) gloss", () => {
  const toks = enrich("きみの").tokens;
  const no = toks.find((t) => t.surface === "の");
  assert.equal(no.pos, "particle");
  assert.equal(no.glosses, null);
});

test("longest-match recovers compounds kuromoji mis-splits (たいせつ/なかま)", { skip: !hasDict }, () => {
  const toks = enrich("たいせつな なかま").tokens;
  const nakama = toks.find((t) => t.surface === "なかま");
  assert.ok(nakama, "なかま should be one token");
  assert.ok(
    nakama.glosses.some((g) => /friend|companion|fellow/.test(g)),
    `expected friend/companion, got ${JSON.stringify(nakama.glosses)}`
  );
  assert.ok(toks.some((t) => t.surface === "たいせつ"));
});

test("homograph disambiguated by POS (きみ pronoun -> 'you')", { skip: !hasDict }, () => {
  const kimi = enrich("きみ").tokens.find((t) => t.surface === "きみ");
  assert.ok(
    kimi.glosses.some((g) => /you/.test(g)),
    `expected 'you' among ${JSON.stringify(kimi.glosses)}`
  );
});

test("pitch accent attached when available", { skip: !hasDict }, () => {
  const namae = enrich("なまえ").tokens.find((t) => t.surface === "なまえ");
  assert.equal(typeof namae.pitch, "number");
});
