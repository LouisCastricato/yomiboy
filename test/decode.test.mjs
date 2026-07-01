import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBytes } from "../server/decode.mjs";

test("hiragana あいうえお (0x01-0x05)", () => {
  assert.equal(decodeBytes([0x01, 0x02, 0x03, 0x04, 0x05]), "あいうえお");
});

test("katakana ポケモン", () => {
  // ポ=9F ケ=59 モ=73 ン=7E
  assert.equal(decodeBytes([0x9f, 0x59, 0x73, 0x7e]), "ポケモン");
});

test("greeting こんにちは", () => {
  // こ=0A ん=2E に=16 ち=11 は=1A
  assert.equal(decodeBytes([0x0a, 0x2e, 0x16, 0x11, 0x1a]), "こんにちは");
});

test("terminator 0xFF stops decoding", () => {
  assert.equal(decodeBytes([0x01, 0xff, 0x02]), "あ");
});

test("newline 0xFE -> \\n", () => {
  assert.equal(decodeBytes([0x01, 0xfe, 0x02]), "あ\nい");
});

test("scroll 0xFA and paragraph 0xFB -> \\n", () => {
  assert.equal(decodeBytes([0x01, 0xfa, 0x02, 0xfb, 0x03]), "あ\nい\nう");
});

test("space 0x00 -> ASCII space", () => {
  assert.equal(decodeBytes([0x01, 0x00, 0x02]), "あ い");
});

test("FC ext control code consumes its args (COLOR = FC 01 <arg>)", () => {
  // FC 01 02 is a 1-arg color command; the 0x03 after it is glyph 'う'
  assert.equal(decodeBytes([0x01, 0xfc, 0x01, 0x02, 0x03]), "あう");
});

test("FC COLOR_HIGHLIGHT_SHADOW = FC 04 consumes 3 args", () => {
  // FC 04 AA BB CC then 0x02 -> 'い'
  assert.equal(decodeBytes([0x01, 0xfc, 0x04, 0xaa, 0xbb, 0xcc, 0x02]), "あい");
});

test("FD placeholder consumes 1 arg byte", () => {
  // FD 06 (RIVAL) then 0x02 -> 'い'
  assert.equal(decodeBytes([0x01, 0xfd, 0x06, 0x02]), "あい");
});

test("keypad icon 0xF8 consumes 1 arg byte", () => {
  assert.equal(decodeBytes([0x01, 0xf8, 0x00, 0x02]), "あい");
});

test("dakuten/handakuten kana decode (がぎゲ)", () => {
  // が=37 ぎ=38 ゲ=8A
  assert.equal(decodeBytes([0x37, 0x38, 0x8a]), "がぎゲ");
});

test("JP punctuation ！？。ー", () => {
  // ！=AB ？=AC 。=AD ー=AE
  assert.equal(decodeBytes([0xab, 0xac, 0xad, 0xae]), "！？。ー");
});

test("realistic line: わたしの なまえは", () => {
  // わ=2C た=10 し=0C の=19 (space) な=15 ま=1F え=04 は=1A
  const bytes = [0x2c, 0x10, 0x0c, 0x19, 0x00, 0x15, 0x1f, 0x04, 0x1a];
  assert.equal(decodeBytes(bytes), "わたしの なまえは");
});

test("unknown/unmapped byte is skipped, not crashed", () => {
  // there should be no glyph that breaks; an undefined slot is skipped
  const out = decodeBytes([0x01, 0xff]);
  assert.equal(out, "あ");
});
