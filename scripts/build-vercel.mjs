#!/usr/bin/env node
// Vercel build: assemble the static site into public/ (the frontend + the mGBA WASM core).
// The /api/*.js serverless functions and their data (compact dict, pitch, kuromoji dict) are
// handled by Vercel separately (see vercel.json `functions.includeFiles`).

import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, "web"), OUT, { recursive: true });

const dist = join(ROOT, "node_modules", "@thenick775", "mgba-wasm", "dist");
const vendor = join(OUT, "vendor", "mgba");
mkdirSync(vendor, { recursive: true });
for (const f of ["mgba.js", "mgba.wasm", "mgba.wasm.map"]) {
  const src = join(dist, f);
  if (existsSync(src)) cpSync(src, join(vendor, f));
}

console.log("built public/ — frontend + mGBA core (vendor/mgba)");
