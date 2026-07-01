#!/usr/bin/env node
// One-time setup:
//   1. (Re)generate the charmap from pret/pokeemerald.
//   2. Download the JMdict (English) dictionary -> server/data/jmdict-eng.json
//   3. Best-effort download of pitch-accent data -> server/data/pitch_accents.txt
//
// Re-run any time; pass --force to re-download dictionaries that already exist.

import { mkdir, writeFile, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "server", "data");
const FORCE = process.argv.includes("--force");

async function run() {
  await mkdir(DATA, { recursive: true });

  // 1) charmap ----------------------------------------------------------------
  log("Generating charmap...");
  const r = spawnSync("node", [join(ROOT, "scripts", "build-charmap.mjs")], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("charmap generation failed");

  // 2) JMdict -----------------------------------------------------------------
  const jmdictPath = join(DATA, "jmdict-eng.json");
  if (existsSync(jmdictPath) && !FORCE) {
    log(`JMdict already present (${jmdictPath}) — skipping. Use --force to redownload.`);
  } else {
    await downloadJmdict(jmdictPath);
  }

  // 3) pitch accents (optional) ----------------------------------------------
  const pitchPath = join(DATA, "pitch_accents.txt");
  if (existsSync(pitchPath) && !FORCE) {
    log("Pitch-accent data already present — skipping.");
  } else {
    await downloadPitch(pitchPath).catch((e) =>
      log(`(optional) pitch-accent download skipped: ${e.message}`)
    );
  }

  log("\nSetup complete. Start the app with:  npm start");
}

async function downloadJmdict(destJson) {
  log("Looking up latest jmdict-simplified release...");
  const rel = await fetchJson(
    "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
  );
  // Prefer the full English .tgz (exclude the "common"-only and non-eng variants).
  const asset = (rel.assets || []).find(
    (a) =>
      /^jmdict-eng-\d.*\.json\.tgz$/.test(a.name) && !a.name.includes("common")
  );
  if (!asset)
    throw new Error(
      "Could not find a jmdict-eng-*.json.tgz asset in the latest release"
    );

  const tgz = join(DATA, asset.name);
  log(`Downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)...`);
  await downloadFile(asset.browser_download_url, tgz);

  log("Extracting...");
  const ex = spawnSync("tar", ["-xzf", tgz, "-C", DATA], { stdio: "inherit" });
  if (ex.status !== 0) throw new Error("tar extraction failed");

  // Find the extracted jmdict-eng-*.json and normalize the filename.
  const files = await readdir(DATA);
  const extracted = files.find(
    (f) => /^jmdict-eng-.*\.json$/.test(f) && !f.includes("common")
  );
  if (!extracted) throw new Error("extracted JMdict json not found");
  await rm(destJson, { force: true });
  await rename(join(DATA, extracted), destJson);
  await rm(tgz, { force: true });
  log(`JMdict ready: ${destJson}`);
}

async function downloadPitch(dest) {
  // Mifune Toshiro's kanjium pitch-accent data (open). Format: word<TAB>reading<TAB>accents
  const url =
    "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt";
  log("Downloading pitch-accent data (optional)...");
  await downloadFile(url, dest);
  log(`Pitch-accent data ready: ${dest}`);
}

// ---- helpers ----
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "emerald-jp-reader-setup" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { "User-Agent": "emerald-jp-reader-setup" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

function log(m) {
  process.stdout.write(m + "\n");
}

run().catch((e) => {
  process.stderr.write("\nsetup failed: " + e.message + "\n");
  process.exit(1);
});
