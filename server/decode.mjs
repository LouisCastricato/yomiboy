// JS mirror of bridge/charmap_jp.lua's decoder. Kept in sync via shared/charmap_jp.json,
// which both consume. Used by the server (defensive re-decode) and by the test suite to
// validate the byte -> Japanese mapping without needing the emulator.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const charmap = JSON.parse(
  readFileSync(join(ROOT, "shared", "charmap_jp.json"), "utf8")
);

export const { glyphs, control, fcArgLen } = charmap;

/**
 * Decode an array of GBA text bytes into a UTF-8 Japanese string.
 * Stops at the END terminator (0xFF). Newlines/scroll/paragraph -> "\n".
 * Spaces (0x00) -> " ". Control codes (FC/FD/F7/F8/F9) are consumed with the
 * correct number of argument bytes so the stream never desyncs.
 *
 * @param {number[]|Uint8Array} bytes
 * @param {number} [len]
 * @returns {string}
 */
export function decodeBytes(bytes, len = bytes.length) {
  let out = "";
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b === undefined || b === control.END) break;
    else if (
      b === control.NEWLINE ||
      b === control.SCROLL ||
      b === control.PARAGRAPH
    ) {
      out += "\n";
    } else if (b === control.PLACEHOLDER) {
      i += 1; // skip 1 arg byte (already-expanded in gStringVar4, but be safe)
    } else if (b === control.EXT) {
      const code = bytes[i + 1];
      const n = fcArgLen[code] ?? 0;
      i += 1 + n;
    } else if (b === control.DYNAMIC) {
      // no arg
    } else if (b === control.KEYPAD || b === control.EXTRA) {
      i += 1;
    } else {
      const g = glyphs[b];
      if (g != null) out += g;
    }
  }
  return out;
}

/**
 * Read a buffer up to the first terminator and decode it. Convenience for callers
 * that have a fixed-size RAM dump (e.g. 1000 bytes of gStringVar4).
 */
export function decodeBuffer(buf) {
  return decodeBytes(buf, buf.length);
}
