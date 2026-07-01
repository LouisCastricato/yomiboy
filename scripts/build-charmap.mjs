#!/usr/bin/env node
// Generates the Generation-III Japanese text decode table for Pokemon Emerald (JP)
// from the canonical pret/pokeemerald charmap.txt.
//
// Why this works: the Gen-3 charmap maps the SAME byte to a Latin glyph (e.g. 0x01='À')
// AND a Japanese glyph (0x01='あ'). The JP ROM uses the Japanese reading, so for any byte
// defined in the Japanese section we prefer that glyph; otherwise we fall back to the Latin
// glyph (covers digits, latin letters, a few symbols). Gen-3 JP uses NO kanji — only kana
// and punctuation — so single-byte decoding is complete.
//
// Outputs:
//   shared/charmap_jp.json   (used by the Node server / tests)
//   bridge/charmap_jp.lua    (used by the mGBA Lua bridge)

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHARMAP_URL =
  "https://raw.githubusercontent.com/pret/pokeemerald/master/charmap.txt";

// 0xFC extended-control-code -> number of argument bytes that follow the code byte.
// Source: COLOR/HIGHLIGHT/... defines in pokeemerald charmap.txt.
const FC_ARG_LEN = {
  0x00: 0, // NAME_END
  0x01: 1, // COLOR
  0x02: 1, // HIGHLIGHT
  0x03: 1, // SHADOW
  0x04: 3, // COLOR_HIGHLIGHT_SHADOW
  0x05: 1, // PALETTE
  0x06: 1, // FONT
  0x07: 0, // RESET_FONT
  0x08: 1, // PAUSE
  0x09: 0, // PAUSE_UNTIL_PRESS
  0x0a: 0, // WAIT_SE
  0x0b: 2, // PLAY_BGM
  0x0c: 1, // ESCAPE
  0x0d: 1, // SHIFT_RIGHT
  0x0e: 1, // SHIFT_DOWN
  0x0f: 0, // FILL_WINDOW
  0x10: 2, // PLAY_SE
  0x11: 1, // CLEAR
  0x12: 1, // SKIP
  0x13: 1, // CLEAR_TO
  0x14: 1, // MIN_LETTER_SPACING
  0x15: 0, // JPN
  0x16: 0, // ENG
};

// Control bytes handled by the decoder (not glyphs).
const CONTROL = {
  END: 0xff, // '$' terminator
  NEWLINE: 0xfe, // \n
  SCROLL: 0xfa, // \l (scroll up, wait)
  PARAGRAPH: 0xfb, // \p (clear, new page)
  PLACEHOLDER: 0xfd, // FD <arg> : buffered string (usually already expanded in gStringVar4)
  EXT: 0xfc, // FC <code> <args...>
  DYNAMIC: 0xf7, // dynamic placeholder (no arg)
  KEYPAD: 0xf8, // keypad icon, +1 arg
  EXTRA: 0xf9, // extra symbol, +1 arg
};

// Is this glyph a Japanese character we should prefer over the Latin reading of the same byte?
function isJapanese(ch) {
  return /[぀-ヿ　-〿！-｠⋯]/.test(ch);
}

async function main() {
  process.stdout.write(`Fetching charmap from ${CHARMAP_URL} ...\n`);
  let res;
  try {
    res = await fetch(CHARMAP_URL);
  } catch (e) {
    throw new Error(`Network error fetching charmap.txt: ${e.message}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching charmap.txt`);
  const text = await res.text();

  const intl = {}; // byte -> latin glyph
  const jp = {}; // byte -> japanese glyph

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/@.*$/, "").trim(); // drop trailing @ comments
    if (!line) continue;
    // Only single-character glyph definitions:  'X' = HH
    // (Named macros like PLAYER, COLOR, SE_*, A_BUTTON are intentionally skipped.)
    const m = line.match(/^'(.)'\s*=\s*([0-9A-Fa-f]{2})$/u);
    if (!m) continue;
    const ch = m[1];
    const byte = parseInt(m[2], 16);
    if (isJapanese(ch)) jp[byte] = ch;
    else if (!(byte in intl)) intl[byte] = ch; // keep first latin definition
  }

  // Build the 256-entry glyph table: Japanese reading wins, else Latin.
  const glyphs = new Array(256).fill(null);
  for (let b = 0; b < 256; b++) {
    if (b in jp) glyphs[b] = jp[b];
    else if (b in intl) glyphs[b] = intl[b];
  }
  glyphs[0x00] = " "; // word separator -> ASCII space (game uses 0x00 between words)

  const kanaCount = Object.keys(jp).length;
  if (kanaCount < 90) {
    throw new Error(
      `Sanity check failed: only ${kanaCount} Japanese glyphs parsed (expected ~100+). ` +
        `charmap.txt format may have changed.`
    );
  }

  // ---- Write shared/charmap_jp.json ----
  const json = {
    _generated: "scripts/build-charmap.mjs",
    _source: CHARMAP_URL,
    glyphs,
    control: CONTROL,
    fcArgLen: FC_ARG_LEN,
  };
  await mkdir(join(ROOT, "shared"), { recursive: true });
  await writeFile(
    join(ROOT, "shared", "charmap_jp.json"),
    JSON.stringify(json, null, 0) + "\n"
  );

  // ---- Write bridge/charmap_jp.lua ----
  const lua = buildLua(glyphs, FC_ARG_LEN, CONTROL);
  await mkdir(join(ROOT, "bridge"), { recursive: true });
  await writeFile(join(ROOT, "bridge", "charmap_jp.lua"), lua);

  // Quick self-check: decode あいうえお
  const sample = [0x01, 0x02, 0x03, 0x04, 0x05];
  const decoded = sample.map((b) => glyphs[b]).join("");
  process.stdout.write(
    `OK: ${kanaCount} JP glyphs, ${
      glyphs.filter(Boolean).length
    } total mapped bytes.\n` +
      `Sample 01-05 -> "${decoded}" (expect "あいうえお")\n` +
      `Wrote shared/charmap_jp.json and bridge/charmap_jp.lua\n`
  );
}

function luaStr(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function buildLua(glyphs, fcArgLen, control) {
  const glyphLines = [];
  for (let b = 0; b < 256; b++) {
    if (glyphs[b] != null) glyphLines.push(`  [${b}]=${luaStr(glyphs[b])},`);
  }
  const fcLines = Object.entries(fcArgLen).map(
    ([k, v]) => `  [${parseInt(k, 10)}]=${v},`
  );
  return `-- AUTO-GENERATED by scripts/build-charmap.mjs -- do not edit by hand.
-- Generation-III Japanese (Pokemon Emerald JP) byte -> UTF-8 glyph table.
local M = {}

M.glyphs = {
${glyphLines.join("\n")}
}

-- 0xFC extended control code -> arg byte count
M.fcArgLen = {
${fcLines.join("\n")}
}

M.END        = ${control.END}
M.NEWLINE    = ${control.NEWLINE}
M.SCROLL     = ${control.SCROLL}
M.PARAGRAPH  = ${control.PARAGRAPH}
M.PLACEHOLDER= ${control.PLACEHOLDER}
M.EXT        = ${control.EXT}
M.DYNAMIC    = ${control.DYNAMIC}
M.KEYPAD     = ${control.KEYPAD}
M.EXTRA      = ${control.EXTRA}

-- Decode a byte array (table of integers, 1-indexed) into a UTF-8 string.
-- Stops at END (0xFF). Returns the decoded string.
function M.decode(bytes, len)
  local out = {}
  local i = 1
  len = len or #bytes
  while i <= len do
    local b = bytes[i]
    if b == nil or b == M.END then
      break
    elseif b == M.NEWLINE or b == M.SCROLL or b == M.PARAGRAPH then
      out[#out + 1] = "\\n"
    elseif b == M.PLACEHOLDER then
      i = i + 1 -- skip 1 arg byte
    elseif b == M.EXT then
      local code = bytes[i + 1]
      local n = M.fcArgLen[code] or 0
      i = i + 1 + n
    elseif b == M.DYNAMIC then
      -- no arg
    elseif b == M.KEYPAD or b == M.EXTRA then
      i = i + 1 -- skip 1 arg byte
    else
      local g = M.glyphs[b]
      if g ~= nil then out[#out + 1] = g end
    end
    i = i + 1
  end
  return table.concat(out)
end

return M
`;
}

main().catch((e) => {
  process.stderr.write("build-charmap failed: " + e.message + "\n");
  process.exit(1);
});
