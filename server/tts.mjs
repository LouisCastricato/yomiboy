// Text-to-speech. Default is the browser's Web Speech API (handled client-side, free,
// zero-setup). When an ElevenLabs key is configured, this proxies to ElevenLabs so the
// key stays server-side, and caches audio on disk by content hash.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "server", "data", "tts-cache");

// A public ElevenLabs voice (Rachel) used when no voiceId is configured.
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

/**
 * @returns {Promise<{useBrowser:true} | {audio:Buffer, contentType:string}>}
 */
export async function synth(text, config) {
  const el = config.elevenLabs || {};
  if (!config.useElevenLabs || !el.apiKey) {
    return { useBrowser: true };
  }
  const voiceId = el.voiceId || DEFAULT_VOICE;
  const modelId = el.modelId || "eleven_multilingual_v2";

  await mkdir(CACHE_DIR, { recursive: true });
  const hash = createHash("sha1")
    .update(`${voiceId}:${modelId}:${text}`)
    .digest("hex");
  const cacheFile = join(CACHE_DIR, `${hash}.mp3`);
  if (existsSync(cacheFile)) {
    return { audio: await readFile(cacheFile), contentType: "audio/mpeg" };
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": el.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${msg.slice(0, 200)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  await writeFile(cacheFile, audio).catch(() => {});
  return { audio, contentType: "audio/mpeg" };
}
