// Single-window mode: run Pokémon Emerald (JP) in-browser and CONTINUOUSLY OCR the on-screen
// text, enrich it, and show romaji + meanings in the panel.
//
// Pipeline: capture native frame → watch the text-box region → when a box appears AND its
// content stops changing (so the typewriter effect + overworld animation don't trigger it),
// OCR it ONCE (cropped + upscaled). Cost scales with text changes, not frames.
//
// OCR backend is the server's /api/ocr (Claude vision) for now; the capture/detection is
// backend-agnostic so a local engine can be swapped in later.

import mGBA from "/vendor/mgba/mgba.js";

const canvas = document.getElementById("emuCanvas");
const statusEl = document.getElementById("emuStatus");
const romInput = document.getElementById("romInput");
const autoBtn = document.getElementById("autoBtn");
const readBtn = document.getElementById("ocrBtn");
const pauseBtn = document.getElementById("pauseBtn");
const muteBtn = document.getElementById("muteBtn");

let Module = null;
let romLoaded = false;
let paused = false;
let autoRead = true;
let muted = true; // game audio off by default

function setStatus(s) { statusEl.textContent = s; }
function applyVolume() { if (Module) try { Module.setVolume(muted ? 0 : 100); } catch {} }
function setMuteLabel() { if (muteBtn) muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound"; }
function setAutoLabel() { if (autoBtn) autoBtn.textContent = autoRead ? "Auto-read: ON" : "Auto-read: OFF"; }

// ---------- input (explicit; no canvas-focus / SDL dependency) ----------
const KEYMAP = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  z: "A", Z: "A", x: "B", X: "B", a: "L", A: "L", s: "R", S: "R",
  Enter: "Start", Backspace: "Select", Shift: "Select",
};
const held = new Set();
function press(btn) { if (Module && romLoaded) try { Module.buttonPress(btn); } catch {} }
function release(btn) { if (Module) try { Module.buttonUnpress(btn); } catch {} }
function setupInput() {
  const typing = (el) =>
    el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  window.addEventListener("keydown", (e) => {
    if (!romLoaded || typing(e.target)) return; // don't steal keys while typing in a field
    const btn = KEYMAP[e.key];
    if (!btn) return;
    e.preventDefault();
    if (held.has(btn)) return;
    held.add(btn);
    press(btn);
  });
  window.addEventListener("keyup", (e) => {
    if (typing(e.target)) return;
    const btn = KEYMAP[e.key];
    if (!btn) return;
    e.preventDefault();
    held.delete(btn);
    release(btn);
  });
  // The mGBA core captures keyboard itself (SDL) and preventDefaults game keys — which blocks
  // typing in our text fields. Release its capture while a field is focused, restore on blur.
  window.addEventListener("focusin", (e) => { if (typing(e.target) && Module) try { Module.toggleInput(false); } catch {} });
  window.addEventListener("focusout", (e) => { if (typing(e.target) && Module) try { Module.toggleInput(true); } catch {} });
  window.addEventListener("blur", () => { for (const b of held) release(b); held.clear(); });
  for (const el of document.querySelectorAll("[data-btn]")) {
    const btn = el.dataset.btn;
    const down = (e) => { e.preventDefault(); el.classList.add("pressed"); press(btn); };
    const up = (e) => { e.preventDefault(); el.classList.remove("pressed"); release(btn); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
  }
}

// ---------- frame capture (native 240x160 via mGBA screenshot) ----------
const work = document.createElement("canvas");
const wctx = work.getContext("2d", { willReadFrequently: true });

async function captureNative() {
  if (!Module || !romLoaded) return null;
  try {
    Module.screenshot("f.png");
    const dir = Module.filePaths().screenshotsPath.replace(/\/$/, "");
    let png;
    try { png = Module.FS.readFile(dir + "/f.png"); } catch { return null; }
    const bmp = await createImageBitmap(new Blob([png], { type: "image/png" }));
    work.width = bmp.width;
    work.height = bmp.height;
    wctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return wctx.getImageData(0, 0, work.width, work.height);
  } catch {
    return null;
  }
}

// Pokémon's dialogue/battle text sits in the bottom ~38% of the screen.
function textRegion(w, h) {
  const top = Math.floor(h * 0.62);
  return { x: 0, y: top, w, h: h - top };
}

// Fraction of bright pixels in a region — a text box is a light panel; overworld grass is not.
function lightFraction(img, r) {
  const { data, width } = img;
  let light = 0, tot = 0;
  for (let y = r.y; y < r.y + r.h; y += 2)
    for (let x = r.x; x < r.x + r.w; x += 2) {
      const i = (y * width + x) * 4;
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 190) light++;
      tot++;
    }
  return tot ? light / tot : 0;
}

// Coarse ink fingerprint of the region: a grid where each cell is 1 if it has dark text.
// Comparing two fingerprints by counting differing cells lets us treat tiny changes (the
// blinking ▼ arrow, a cursor) as noise and only react to real text changes.
function signatureCells(img, r) {
  const { data, width } = img;
  const gx = 32, gy = 8;
  const cells = new Uint8Array(gx * gy);
  for (let cy = 0; cy < gy; cy++)
    for (let cx = 0; cx < gx; cx++) {
      const x0 = r.x + Math.floor((cx * r.w) / gx), x1 = r.x + Math.floor(((cx + 1) * r.w) / gx);
      const y0 = r.y + Math.floor((cy * r.h) / gy), y1 = r.y + Math.floor(((cy + 1) * r.h) / gy);
      let dark = 0, tot = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          tot++;
          if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 130) dark++;
        }
      cells[cy * gx + cx] = tot && dark / tot > 0.22 ? 1 : 0;
    }
  return cells;
}
function cellsDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 1e9;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// ---------- OCR a region (crop + 3x nearest upscale -> /api/ocr -> enrich via app) ----------
async function ocrRegion(r, src) {
  const SCALE = 4; // upscale the tiny native crop so the model sees the pixel font clearly
  const up = document.createElement("canvas");
  up.width = r.w * SCALE;
  up.height = r.h * SCALE;
  const ux = up.getContext("2d");
  ux.imageSmoothingEnabled = false;
  ux.drawImage(work, r.x, r.y, r.w, r.h, 0, 0, up.width, up.height);
  const b64 = up.toDataURL("image/png").split(",")[1];
  const j = await (await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: b64, mediaType: "image/png" }),
  })).json();
  if (j.japanese && window.EJP) window.EJP.onText(j.japanese, src);
  return j;
}

function reportOcr(j) {
  if (j.disabled) setStatus("OCR off — set an Anthropic key (server/config.json or ANTHROPIC_API_KEY).");
  else if (j.empty) setStatus("Auto-read on (no text detected)");
  else if (j.error) setStatus("OCR error: " + j.error);
  else setStatus("Auto-read on ✓");
}

// ---------- continuous loop ----------
const NOISE = 3; // cell-diff at/below this = animation noise (blinking ▼, cursor), not new text
const STABLE_MS = 350; // text must hold still this long before we read it (typewriter finished)
let prevSig = null; // previous tick's fingerprint (to detect ongoing change)
let lastOcrSig = null; // fingerprint of the content we last resolved (read or reused)
let changedAt = 0;
let busy = false;
const boxCache = []; // [{cells, japanese}] — reuse text for boxes already read (no API call)

async function tick() {
  if (!romLoaded || paused || !autoRead || busy) return;
  busy = true;
  try {
    const img = await captureNative();
    if (!img) return;
    const r = textRegion(img.width, img.height);
    if (lightFraction(img, r) < 0.32) { prevSig = null; return; } // no text box on screen
    const sig = signatureCells(img, r);
    const now = Date.now();
    const movedSinceLastTick = cellsDiff(sig, prevSig);
    prevSig = sig;
    if (movedSinceLastTick > NOISE) { changedAt = now; return; } // still changing (typewriter/anim)
    if (cellsDiff(sig, lastOcrSig) <= NOISE) return; // same content as last read (e.g. ▼ blink)
    if (now - changedAt < STABLE_MS) return; // hasn't settled long enough yet
    lastOcrSig = sig;
    const cached = boxCache.find((e) => cellsDiff(sig, e.cells) <= NOISE);
    if (cached) { setStatus("Auto-read ✓ (cached)"); window.EJP?.onText(cached.japanese, "emulator"); return; }
    setStatus("Reading…");
    try {
      const j = await ocrRegion(r, "emulator");
      if (j && j.japanese) {
        boxCache.push({ cells: sig, japanese: j.japanese });
        if (boxCache.length > 60) boxCache.shift();
      }
      reportOcr(j || {});
    } catch { setStatus("read failed"); }
  } finally {
    busy = false;
  }
}

// Manual: OCR the WHOLE screen (catches menus / text outside the dialogue box).
async function readScreenFull() {
  if (!romLoaded) { setStatus("Load a ROM first."); return; }
  const img = await captureNative();
  if (!img) { setStatus("Capture failed."); return; }
  setStatus("Reading screen…");
  try {
    reportOcr(await ocrRegion({ x: 0, y: 0, w: img.width, h: img.height }, "screen"));
    lastOcrSig = signatureCells(img, textRegion(img.width, img.height));
    prevSig = lastOcrSig;
  } catch (e) { setStatus("Read failed: " + (e?.message || e)); }
}

// ---------- controls ----------
romInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file || !Module) return;
  setStatus(`Loading ${file.name}…`);
  Module.uploadRom(file, () => {
    const ok = Module.loadGame(Module.filePaths().gamePath + "/" + file.name);
    romLoaded = !!ok;
    applyVolume();
    setStatus(ok ? "Running. Auto-read is on — dialogue & battle text will appear automatically." : "Could not load that ROM.");
  });
};
if (autoBtn) autoBtn.onclick = () => { autoRead = !autoRead; setAutoLabel(); setStatus(autoRead ? "Auto-read on" : "Auto-read paused"); };
if (readBtn) readBtn.onclick = readScreenFull;
pauseBtn.onclick = () => {
  if (!Module || !romLoaded) return;
  paused = !paused;
  if (paused) Module.pauseGame(); else Module.resumeGame();
  pauseBtn.textContent = paused ? "▶" : "⏸";
};
if (muteBtn) muteBtn.onclick = () => { muted = !muted; applyVolume(); setMuteLabel(); };
const grabBtn = document.getElementById("grabBtn");
if (grabBtn)
  grabBtn.onclick = async () => {
    const img = await captureNative();
    if (!img) { setStatus("No frame to grab (load a ROM)."); return; }
    const a = document.createElement("a");
    a.href = work.toDataURL("image/png"); // native 240x160
    a.download = "ejp-frame.png";
    a.click();
  };

// Auto-load a bundled ROM if deployed at /rom/game.gba (private-deploy convenience).
async function tryAutoRom() {
  try {
    const res = await fetch("/rom/game.gba");
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) return false;
    Module.uploadRom(new File([buf], "game.gba"), () => {
      romLoaded = !!Module.loadGame(Module.filePaths().gamePath + "/game.gba");
      applyVolume();
      setStatus(romLoaded ? "ROM loaded — auto-read on. Play!" : "Bundled ROM failed to load.");
    });
    return true;
  } catch {
    return false;
  }
}

// ---------- init ----------
async function init() {
  setupInput();
  setAutoLabel();
  setMuteLabel();
  setStatus("Loading emulator core…");
  Module = await mGBA({ canvas });
  await Module.FSInit();
  applyVolume(); // muted by default
  if (!(await tryAutoRom())) setStatus("Emulator ready — click 📂 Load ROM and choose your Emerald (JP) file.");
  setInterval(tick, 300);
}

init().catch((e) => {
  setStatus("Emulator failed to start: " + (e?.message || e) + ". Open http://localhost:8080 served by `npm start`.");
});
