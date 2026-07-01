#!/usr/bin/env node
// Dev tool: pretend to be the mGBA bridge. Connects to the server's TCP port and sends
// sample Pokémon Emerald (JP) dialogue lines so you can exercise the panel without a ROM.
//
//   node scripts/replay.mjs            # play the sample script once
//   node scripts/replay.mjs --loop     # repeat forever
//   node scripts/replay.mjs --delay 1500

import net from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function tcpPort() {
  const ex = JSON.parse(readFileSync(join(ROOT, "server", "config.example.json"), "utf8"));
  const userPath = join(ROOT, "server", "config.json");
  if (existsSync(userPath)) {
    return JSON.parse(readFileSync(userPath, "utf8")).tcpPort || ex.tcpPort;
  }
  return ex.tcpPort;
}

// Representative Emerald-JP-style lines (kana only, with the game's word spaces).
const SCRIPT = [
  "ようこそ　ポケモンの せかいへ！",
  "わたしの なまえは オダマキ。",
  "みんなには ポケモンはかせと よばれて いるよ。",
  "きみは おとこのこ？　それとも おんなのこ？",
  "きみの なまえを おしえて くれるかな？",
  "たいせつな なかまに なる ポケモンだ。",
  "やせいの ポチエナが とびだして きた！",
  "ポケモンセンターで げんきに しよう！",
  "がんばって マサラタウンへ もどろう。",
  "また あおうね！　げんきでね！",
];

const args = process.argv.slice(2);
const loop = args.includes("--loop");
const delayArg = args.indexOf("--delay");
const delay = delayArg >= 0 ? parseInt(args[delayArg + 1], 10) : 2500;

const port = tcpPort();
const sock = net.connect(port, "127.0.0.1", () => {
  console.log(`replay: connected to 127.0.0.1:${port}`);
  run();
});
sock.on("error", (e) => {
  console.error(`replay: could not connect on ${port} (${e.message}). Is the server running?`);
  process.exit(1);
});

async function run() {
  do {
    for (const japanese of SCRIPT) {
      const msg = JSON.stringify({ src: "dialog", japanese }) + "\n";
      sock.write(msg);
      console.log("→", japanese);
      await sleep(delay);
    }
  } while (loop);
  console.log("replay: done");
  sock.end();
  process.exit(0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
