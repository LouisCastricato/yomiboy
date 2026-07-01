// Shared request logic used by BOTH the local dev server (server/index.mjs) and the Vercel
// serverless functions (api/*.js). Keeps behavior identical across local and deployed.
//
// Config resolves from environment variables first (Vercel) then server/config.json (local):
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL, USE_TRANSLATE, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, USE_ELEVENLABS

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { initNlp, enrich as enrichLine } from "./nlp.mjs";
import * as translateSvc from "./translate.mjs";
import * as ttsSvc from "./tts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let _config = null;
export function getConfig() {
  if (_config) return _config;
  let file = {};
  const p = join(ROOT, "server", "config.json");
  if (existsSync(p)) { try { file = JSON.parse(readFileSync(p, "utf8")); } catch {} }
  const env = process.env;
  const bool = (v, d) => (v == null ? d : v === "true" || v === "1");
  _config = {
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || file.anthropic?.apiKey || "",
      model: env.ANTHROPIC_MODEL || file.anthropic?.model || "claude-sonnet-4-6",
    },
    useTranslate: bool(env.USE_TRANSLATE, file.useTranslate ?? false),
    elevenLabs: {
      apiKey: env.ELEVENLABS_API_KEY || file.elevenLabs?.apiKey || "",
      voiceId: env.ELEVENLABS_VOICE_ID || file.elevenLabs?.voiceId || "",
      modelId: file.elevenLabs?.modelId || "eleven_multilingual_v2",
    },
    useElevenLabs: bool(env.USE_ELEVENLABS, file.useElevenLabs ?? false),
  };
  return _config;
}

let _nlpReady = null;
function ensureNlp() {
  if (!_nlpReady) {
    const compact = join(ROOT, "server", "data", "jmdict-compact.json");
    const full = join(ROOT, "server", "data", "jmdict-eng.json");
    _nlpReady = initNlp({
      dicPath: join(ROOT, "node_modules", "kuromoji", "dict"),
      jmdictPath: existsSync(compact) ? compact : full,
      pitchPath: join(ROOT, "server", "data", "pitch_accents.txt"),
    });
  }
  return _nlpReady;
}

let _anthropicReady = null;
function ensureAnthropic() {
  if (!_anthropicReady) _anthropicReady = translateSvc.initTranslate(getConfig());
  return _anthropicReady;
}

let _seq = 0;

export async function status() {
  await ensureAnthropic().catch(() => {});
  const c = getConfig();
  return {
    dictLoaded: true,
    pitchLoaded: true,
    translateEnabled: translateSvc.isEnabled(),
    ocrEnabled: translateSvc.isOcrEnabled(),
    ttsElevenLabs: !!(c.useElevenLabs && c.elevenLabs.apiKey),
  };
}

export async function enrich(japanese) {
  await ensureNlp();
  const e = enrichLine(japanese || "");
  if (!e.tokens.length) return { empty: true };
  return { line: { id: ++_seq, ts: Date.now(), ...e } };
}

export async function ocr(image, mediaType) {
  await ensureAnthropic();
  if (!translateSvc.isOcrEnabled()) return { disabled: true };
  const jp = await translateSvc.transcribe(image, mediaType || "image/png");
  return jp ? { japanese: jp } : { empty: true };
}

export async function translate(japanese) {
  await ensureAnthropic();
  if (!translateSvc.isEnabled()) return { disabled: true };
  return (await translateSvc.translate(japanese)) || { disabled: true };
}

export async function ask(japanese, translation, messages) {
  await ensureAnthropic();
  if (!translateSvc.isOcrEnabled()) return { disabled: true };
  const answer = await translateSvc.ask(japanese, translation, messages);
  return answer ? { answer } : { error: "no answer" };
}

export async function tts(text) {
  return ttsSvc.synth(text, getConfig());
}
