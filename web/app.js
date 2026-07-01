// Reading panel client (redesign): renders enriched lines as a line-card + word chips,
// a persistent word-detail panel, a translation card, and History / Saved tabs.

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const DEFAULTS = { showFurigana: true, showPitch: true, kanaRomaji: true, autoTranslate: false, autoSpeak: false, ttsEngine: "auto" };
const settings = { ...DEFAULTS, ...loadSettings() };
let caps = { dictLoaded: false, translateEnabled: false, ocrEnabled: false, ttsElevenLabs: false };

let currentLine = null;
let currentTranslation = "";
let askThread = [];
let historyCache = [];
let savedCards = [];
const savedFronts = new Set();
let sessionLines = 0;
const sessionWords = new Set();

function loadSettings() { try { return JSON.parse(localStorage.getItem("ejp-settings") || "{}"); } catch { return {}; } }
function saveSettings() { localStorage.setItem("ejp-settings", JSON.stringify(settings)); }

// ---------- ingest text (called by emulator.js after OCR) ----------
let lastJp = null;
window.EJP = { onText };
async function onText(japanese, src) {
  japanese = (japanese || "").trim();
  if (!japanese || japanese === lastJp) return;
  lastJp = japanese;
  let line;
  try {
    const j = await (await fetch("/api/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ japanese }) })).json();
    if (!j.line) return;
    line = { ...j.line, src: src || "game" };
  } catch { return; }
  historyCache.unshift(line);
  if (historyCache.length > 500) historyCache.pop();
  persistHistory();
  sessionLines++;
  for (const t of line.tokens) if (t.glosses && t.glosses.length) sessionWords.add(t.dictForm || t.surface);
  renderLine(line);
  if (settings.autoSpeak) speak(plain(line.japanese));
  updateStats();
  if (!$("#tab-history").hidden) renderHistory();
}

// ---------- pitch helpers ----------
const SMALL = new Set([..."ゃゅょぁぃぅぇぉゎャュョァィゥェォ"]);
function moraOf(reading) {
  const m = [];
  for (const ch of reading || "") { if (SMALL.has(ch) && m.length) m[m.length - 1] += ch; else m.push(ch); }
  return m;
}
function pattern(n, a) {
  const p = [];
  for (let i = 0; i < n; i++) p.push(a === 0 ? i >= 1 : a === 1 ? i === 0 : i >= 1 && i < a);
  return p;
}
function pitchType(n, a) {
  if (a === 0) return "heiban (flat)";
  if (a === 1) return "atamadaka (head)";
  if (a >= n) return "odaka (tail)";
  return "nakadaka (mid)";
}
function pitchMini(reading, accent) {
  const m = moraOf(reading);
  if (!m.length) return null;
  const pat = pattern(m.length, accent);
  const box = document.createElement("div");
  box.className = "pitch-mini";
  pat.forEach((h) => { const d = document.createElement("span"); d.className = "dot " + (h ? "h" : "l"); box.appendChild(d); });
  return box;
}
function pitchFull(reading, accent) {
  const m = moraOf(reading);
  const pat = pattern(m.length, accent);
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:flex-end;";
  const pd = document.createElement("div");
  pd.className = "pitch-full";
  m.forEach((mo, i) => {
    const s = document.createElement("span");
    s.className = "mora " + (pat[i] ? "high" : "low");
    if (accent >= 1 && i === accent - 1) s.classList.add("drop");
    s.innerHTML = `${esc(mo)}<span class="bar"></span>`;
    pd.appendChild(s);
  });
  wrap.appendChild(pd);
  const label = document.createElement("span");
  label.className = "pitch-label";
  label.textContent = pitchType(m.length, accent);
  wrap.appendChild(label);
  return wrap;
}

// ---------- render line ----------
const isPunct = (t) => t.pos === "symbol" || /^[\s！？。、,.!?「」『』（）()…・]+$/.test(t.surface);
function srcLabel(src) {
  return { dialog: "💬 dialogue", emulator: "🎮 game", ocr: "📷 screen", battle: "⚔ battle" }[src] || "💬 " + (src || "text");
}

function renderLine(line) {
  currentLine = line;
  currentTranslation = "";
  askThread = [];
  $("#placeholder").hidden = true;
  $("#lineWrap").hidden = false;

  const meta = $("#lineMeta");
  meta.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "src-tag";
  tag.textContent = srcLabel(line.src);
  meta.appendChild(tag);
  const sp = document.createElement("span");
  sp.textContent = "🔊";
  sp.style.cursor = "pointer";
  sp.title = "Play line";
  sp.onclick = () => speak(plain(line.japanese));
  meta.appendChild(sp);
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = relTime(line.ts);
  meta.appendChild(ts);

  $("#lineJp").textContent = line.japanese;
  $("#lineRomaji").textContent = line.romaji;

  const chips = $("#lineChips");
  chips.innerHTML = "";
  for (const t of line.tokens) chips.appendChild(buildChip(t, line));

  const wd = $("#wordDetail");
  wd.className = "word-detail empty";
  wd.innerHTML = "<p>Tap a word above to see its reading, pitch accent, and meaning.</p>";

  renderTranslate(line);
}

function buildChip(t, line) {
  if (t.br) { const b = document.createElement("div"); b.className = "chip break"; return b; }
  const chip = document.createElement("div");
  chip.className = "chip";
  const punct = isPunct(t);
  if (punct) chip.classList.add("punct");
  if (t.glosses && t.glosses.length) chip.classList.add("has-gloss");

  const surf = document.createElement("span");
  surf.className = "surface jp";
  if (settings.kanaRomaji && t.mora && t.mora.length) {
    surf.classList.add("kana-annot");
    surf.innerHTML = t.mora.map((m) => `<ruby>${esc(m.k)}<rt>${m.r ? esc(m.r) : ""}</rt></ruby>`).join("");
  } else if (settings.showFurigana && t.furigana && t.furigana !== t.surface) {
    surf.innerHTML = `<ruby>${esc(t.surface)}<rt>${esc(t.furigana)}</rt></ruby>`;
  } else {
    surf.textContent = t.surface;
  }
  chip.appendChild(surf);

  if (!punct) {
    const rom = document.createElement("span");
    rom.className = "romaji-sub";
    rom.textContent = t.romaji || "";
    chip.appendChild(rom);
    if (settings.showPitch && typeof t.pitch === "number") { const p = pitchMini(t.reading, t.pitch); if (p) chip.appendChild(p); }
    chip.addEventListener("click", () => selectWord(chip, t, line));
  }
  return chip;
}

function selectWord(chip, t, line) {
  $$(".chip.active").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  const wd = $("#wordDetail");
  wd.className = "word-detail";
  wd.innerHTML = "";

  const head = document.createElement("div");
  head.className = "wd-head";
  head.innerHTML =
    `<span class="wd-surface jp">${esc(t.surface)}</span>` +
    (t.dictForm && t.dictForm !== t.surface ? `<span class="wd-dict jp">→ ${esc(t.dictForm)}</span>` : "") +
    `<span class="wd-reading jp">${esc(t.reading || "")}</span>` +
    `<span class="wd-romaji">${esc(t.romaji || "")}</span>` +
    (t.pos ? `<span class="wd-pos">${esc(t.pos)}</span>` : "");
  wd.appendChild(head);

  if (settings.showPitch && typeof t.pitch === "number") wd.appendChild(pitchFull(t.reading, t.pitch));

  if (t.glosses && t.glosses.length) {
    const ul = document.createElement("ul");
    ul.className = "wd-glosses";
    t.glosses.forEach((g) => { const li = document.createElement("li"); li.textContent = g; ul.appendChild(li); });
    wd.appendChild(ul);
  } else {
    const p = document.createElement("div");
    p.className = "muted";
    p.style.marginTop = "10px";
    p.textContent = "No dictionary entry — reading & romaji only.";
    wd.appendChild(p);
  }

  const act = document.createElement("div");
  act.className = "wd-actions";
  const sp = document.createElement("button");
  sp.className = "wd-btn";
  sp.textContent = "🔊 Hear it";
  sp.onclick = () => speak(t.surface);
  act.appendChild(sp);
  if (t.glosses && t.glosses.length) {
    const sv = document.createElement("button");
    sv.className = "wd-btn accent";
    sv.textContent = "＋ Save word";
    sv.onclick = () => addCard(t, line.japanese);
    act.appendChild(sv);
  }
  const cp = document.createElement("button");
  cp.className = "wd-btn";
  cp.textContent = "📋 Copy";
  cp.onclick = () => { navigator.clipboard?.writeText(t.surface); toast("Copied " + t.surface); };
  act.appendChild(cp);
  wd.appendChild(act);
}

// ---------- translation ----------
function renderTranslate(line) {
  const box = $("#translateCard");
  box.innerHTML = "";
  if (!caps.translateEnabled) return;
  if (settings.autoTranslate) { doTranslate(line.japanese, box); return; }
  // Hidden by default — a compact button that reveals the full translation on demand.
  const btn = document.createElement("button");
  btn.className = "trans-btn";
  btn.style.marginTop = "14px";
  btn.textContent = "🌐 Show full translation";
  btn.onclick = () => doTranslate(line.japanese, box);
  box.appendChild(btn);
}
function noteHtml(note) {
  const m = note.match(/^\s*(.{1,18}?)\s*[—–-]\s*(.+)$/);
  return m ? `<b>${esc(m[1])}</b> — ${esc(m[2])}` : esc(note);
}
async function doTranslate(jp, box) {
  box.innerHTML = '<div class="translation-card"><div class="trans-head">🌐 Translation + grammar</div><div class="trans-en muted">Translating…</div></div>';
  try {
    const j = await (await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ japanese: jp }) })).json();
    if (j.disabled) { renderTranslate(currentLine); return; }
    currentTranslation = j.translation || "";
    let html = `<div class="trans-head">🌐 Translation + grammar</div><div class="trans-en">${esc(j.translation || "")}</div>`;
    if (j.notes && j.notes.length) html += '<ul class="trans-notes">' + j.notes.map((n) => `<li>${noteHtml(n)}</li>`).join("") + "</ul>";
    html += `<div class="ask"><div class="ask-thread"></div>
      <div class="ask-row"><input class="ask-input" placeholder="Ask about this line… e.g. why だから?" />
      <button class="trans-btn ask-send">Ask</button></div></div>`;
    box.innerHTML = `<div class="translation-card">${html}</div>`;
    wireAsk(box, jp);
    renderAskThread(box);
  } catch { box.innerHTML = '<div class="translation-card"><div class="trans-en">Translation failed.</div></div>'; }
}

function wireAsk(box, jp) {
  const input = box.querySelector(".ask-input");
  const send = box.querySelector(".ask-send");
  const submit = () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    onAsk(jp, q, box);
  };
  send.onclick = submit;
  input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
}
function renderAskThread(box) {
  const t = box.querySelector(".ask-thread");
  if (!t) return;
  t.innerHTML = askThread
    .map((m) =>
      m.role === "user"
        ? `<div class="ask-q">${esc(m.content)}</div>`
        : `<div class="ask-a${m.pending ? " thinking" : ""}">${m.pending ? "thinking…" : esc(m.content)}</div>`
    )
    .join("");
}
async function onAsk(jp, q, box) {
  askThread.push({ role: "user", content: q });
  askThread.push({ role: "assistant", content: "", pending: true });
  renderAskThread(box);
  const a = askThread[askThread.length - 1];
  try {
    const messages = askThread.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content }));
    const j = await (await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ japanese: jp, translation: currentTranslation, messages }) })).json();
    a.pending = false;
    a.content = j.answer || (j.disabled ? "Q&A needs an Anthropic key (server/config.json)." : "Sorry — no answer.");
  } catch {
    a.pending = false;
    a.content = "Request failed.";
  }
  renderAskThread(box);
}

// ---------- TTS ----------
let jaVoice = null;
function pickJaVoice() {
  if (jaVoice) return jaVoice;
  const v = (window.speechSynthesis?.getVoices?.() || []).find((x) => x.lang && x.lang.toLowerCase().startsWith("ja"));
  jaVoice = v || null;
  return jaVoice;
}
if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = () => { jaVoice = null; pickJaVoice(); };
function browserSpeak(text) {
  if (!("speechSynthesis" in window)) return toast("No browser TTS available");
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP"; u.rate = 0.9;
  const v = pickJaVoice(); if (v) u.voice = v;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
async function speak(text) {
  if (!text) return;
  if (settings.ttsEngine === "browser") return browserSpeak(text);
  try {
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) { const j = await res.json(); if (j.useBrowser) return browserSpeak(text); if (j.error) return toast("TTS error: " + j.error); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); a.play();
  } catch { browserSpeak(text); }
}

// ---------- Anki / saved ----------
function addCard(t, sentence) {
  const front = t.dictForm || t.surface;
  if (savedFronts.has(front)) { toast(`Already saved (${savedCards.length})`); return; }
  savedFronts.add(front);
  savedCards.unshift({ front, reading: t.reading, romaji: t.romaji, meaning: (t.glosses || []).join("; "), sentence, added: Date.now() });
  persistSaved();
  toast(`Saved “${front}” — ${savedCards.length}`);
  updateStats();
  if (!$("#tab-saved").hidden) renderSaved();
}
function loadSaved() {
  try { savedCards = JSON.parse(localStorage.getItem("ejp-saved") || "[]"); } catch { savedCards = []; }
  savedFronts.clear();
  savedCards.forEach((c) => savedFronts.add(c.front));
  renderSaved();
  updateStats();
}
function persistSaved() { localStorage.setItem("ejp-saved", JSON.stringify(savedCards.slice(0, 2000))); }
function ankiExport() {
  const cl = (s) => String(s || "").replace(/[\t\r\n]+/g, " ").trim();
  const header = "#separator:tab\n#html:true\n#columns:Front\tBack\tTags\n";
  const rows = savedCards.map((c) => {
    const back = [`${cl(c.reading)}${c.romaji ? ` (${cl(c.romaji)})` : ""}`, cl(c.meaning), c.sentence ? `<br><span style="color:#888">${cl(c.sentence)}</span>` : ""].filter(Boolean).join("<br>");
    return `${cl(c.front)}\t${back}\tpokemon-emerald-jp`;
  });
  const url = URL.createObjectURL(new Blob([header + rows.join("\n") + "\n"], { type: "text/tab-separated-values" }));
  const a = document.createElement("a");
  a.href = url; a.download = "emerald-jp-anki.txt"; a.click();
  URL.revokeObjectURL(url);
}
function renderSaved() {
  const list = $("#savedList");
  if (!list) return;
  list.innerHTML = "";
  if (!savedCards.length) { list.innerHTML = '<div class="empty-note">No saved words yet — tap ＋ Save word on any word.</div>'; return; }
  for (const c of savedCards) {
    const it = document.createElement("div");
    it.className = "sw-item";
    it.innerHTML = `<span class="sw-word jp">${esc(c.front)}</span><span class="sw-reading jp">${esc(c.reading || "")}</span><span class="sw-meaning">${esc(c.meaning || "")}</span>`;
    list.appendChild(it);
  }
}
function updateStats() {
  const b = $("#savedBadge"); if (b) b.textContent = savedFronts.size;
  const w = $("#statWords"); if (w) w.textContent = savedFronts.size;
  const s = $("#statSeen"); if (s) s.textContent = sessionLines;
  const n = $("#statNew"); if (n) n.textContent = sessionWords.size;
}

// ---------- history ----------
function loadHistory() {
  try { historyCache = JSON.parse(localStorage.getItem("ejp-history") || "[]"); } catch { historyCache = []; }
}
function persistHistory() { localStorage.setItem("ejp-history", JSON.stringify(historyCache.slice(0, 500))); }
function renderHistory() {
  const q = ($("#histSearch")?.value || "").toLowerCase().trim();
  const list = $("#historyList");
  list.innerHTML = "";
  const items = historyCache.filter((l) => !q || l.japanese.toLowerCase().includes(q) || (l.romaji || "").toLowerCase().includes(q));
  if (!items.length) { list.innerHTML = '<div class="empty-note">' + (q ? "No matches." : "No lines yet this session.") + "</div>"; return; }
  for (const line of items) {
    const it = document.createElement("div");
    it.className = "h-item";
    const d = document.createElement("div");
    d.style.flex = "1";
    d.innerHTML = `<div class="h-jp jp">${esc(plain(line.japanese))}</div><div class="h-romaji">${esc(line.romaji)}</div>`;
    it.appendChild(d);
    it.onclick = () => { switchTab("read"); renderLine(line); };
    list.appendChild(it);
  }
}

// ---------- tabs ----------
function switchTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("#tab-read").hidden = name !== "read";
  $("#tab-history").hidden = name !== "history";
  $("#tab-saved").hidden = name !== "saved";
  if (name === "history") renderHistory();
  if (name === "saved") loadSaved();
}
$$(".tab").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
$("#histSearch")?.addEventListener("input", renderHistory);

// ---------- settings ----------
$("#settingsBtn").onclick = () => {
  $("#setKanaRomaji").checked = settings.kanaRomaji;
  $("#setFurigana").checked = settings.showFurigana;
  $("#setPitch").checked = settings.showPitch;
  $("#setAutoTranslate").checked = settings.autoTranslate;
  $("#setAutoSpeak").checked = settings.autoSpeak;
  $("#setTts").value = settings.ttsEngine;
  updateCaps();
  $("#settingsModal").hidden = false;
};
$("#closeSettings").onclick = () => ($("#settingsModal").hidden = true);
$("#settingsModal").addEventListener("click", (e) => { if (e.target.id === "settingsModal") $("#settingsModal").hidden = true; });
$("#setKanaRomaji").onchange = (e) => set("kanaRomaji", e.target.checked);
$("#setFurigana").onchange = (e) => set("showFurigana", e.target.checked);
$("#setPitch").onchange = (e) => set("showPitch", e.target.checked);
$("#setAutoTranslate").onchange = (e) => set("autoTranslate", e.target.checked);
$("#setAutoSpeak").onchange = (e) => set("autoSpeak", e.target.checked);
$("#setTts").onchange = (e) => set("ttsEngine", e.target.value);
function set(k, v) { settings[k] = v; saveSettings(); if (currentLine && (k === "showFurigana" || k === "showPitch" || k === "kanaRomaji")) renderLine(currentLine); }

async function refreshCaps() {
  try { caps = await (await fetch("/api/status")).json(); $("#statusDot").classList.add("on"); }
  catch { $("#statusDot").classList.remove("on"); }
  updateCaps();
}
function updateCaps() {
  const el = $("#capabilities");
  if (el) el.textContent = [
    caps.dictLoaded ? "Dictionary ✓" : "Dictionary off",
    caps.translateEnabled ? "Translation ✓" : "Translation off",
    caps.ocrEnabled ? "OCR ✓" : "OCR off",
    caps.ttsElevenLabs ? "ElevenLabs ✓" : "Browser voice",
  ].join("  •  ");
}

// ---------- helpers ----------
let toastTimer = null;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2200); }
function plain(s) { return (s || "").replace(/\n+/g, " "); }
function relTime(ts) { if (!ts) return ""; const d = (Date.now() - ts) / 1000; if (d < 5) return "just now"; if (d < 60) return Math.floor(d) + "s ago"; if (d < 3600) return Math.floor(d / 60) + "m ago"; return Math.floor(d / 3600) + "h ago"; }
function esc(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- boot ----------
refreshCaps();
loadSaved();
loadHistory();
if (historyCache.length) renderLine(historyCache[0]);
$$('a[href="/api/cards/export"]').forEach((a) => { a.removeAttribute("href"); a.style.cursor = "pointer"; a.onclick = ankiExport; });
