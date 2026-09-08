/**
 * READCORRECT-001 / CODEX_AUDIT.md A-039 — parseKey() must reject numeric
 * junk, not silently truncate it.
 *
 * `Number.parseInt(part, 10)` stops at the first non-digit character
 * ("1x" -> 1, "3junk" -> 3, "15oops" -> 15), so keys like "1x.3", "1.3junk",
 * and "1.3.15oops" used to parse as valid RefKeys. parseKey() is the single
 * choke point untrusted URLs and stored (e.g. localStorage last-read, IndexedDB
 * entry.chapter/entry.verse) keys pass through, so this file exercises the
 * real exported parseKey() -- never a reimplementation of its regex -- against
 * both the rejection cases the audit's live probe found and the full set of
 * legitimate formats it must keep accepting exactly as before.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseKey } from "@/lib/bible/reference";

// ===========================================================================
// REJECT — the exact junk the audit's live probe found accepted.
// ===========================================================================

test("parseKey: rejects a trailing letter after the book segment (\"1x.3\")", () => {
  assert.equal(parseKey("1x.3"), null);
});

test("parseKey: rejects a trailing word after the chapter segment (\"1.3junk\")", () => {
  assert.equal(parseKey("1.3junk"), null);
});

test("parseKey: rejects a trailing word after the verse segment (\"1.3.15oops\")", () => {
  assert.equal(parseKey("1.3.15oops"), null);
});

test("parseKey: rejects a leading letter (\"x1.3\")", () => {
  assert.equal(parseKey("x1.3"), null);
});

test("parseKey: rejects a purely alphabetic segment (\"1.abc\")", () => {
  assert.equal(parseKey("1.abc"), null);
});

test("parseKey: rejects internal whitespace (\"1 .3\", \"1. 3\")", () => {
  assert.equal(parseKey("1 .3"), null);
  assert.equal(parseKey("1. 3"), null);
});

test("parseKey: rejects a comma inside a segment (\"1.3,5\")", () => {
  assert.equal(parseKey("1.3,5"), null);
});

test("parseKey: rejects a signed segment (\"-1.3\", \"1.+3\")", () => {
  assert.equal(parseKey("-1.3"), null);
  assert.equal(parseKey("1.+3"), null);
});

test("parseKey: rejects an empty segment (\"1..3\", \".3\", \"1.\")", () => {
  assert.equal(parseKey("1..3"), null);
  assert.equal(parseKey(".3"), null);
  assert.equal(parseKey("1."), null);
});

test("parseKey: rejects a totally empty string", () => {
  assert.equal(parseKey(""), null);
});

test("parseKey: rejects hex-looking junk (\"0x1.3\")", () => {
  assert.equal(parseKey("0x1.3"), null);
});

// ===========================================================================
// ACCEPT — every legitimate key format, unchanged from before this fix.
// ===========================================================================

test("parseKey: a valid chapter key (\"1.3\") parses to book/chapter, no verse field", () => {
  assert.deepEqual(parseKey("1.3"), { book: 1, chapter: 3 });
});

test("parseKey: a valid verse key (\"1.3.15\") parses to book/chapter/verse", () => {
  assert.deepEqual(parseKey("1.3.15"), { book: 1, chapter: 3, verse: 15 });
});

test("parseKey: book 66 (Revelation) is in range; book 67 is not", () => {
  assert.deepEqual(parseKey("66.1"), { book: 66, chapter: 1 });
  assert.equal(parseKey("67.1"), null);
});

test("parseKey: book 0 or chapter 0 or verse 0 are all out of range (1-indexed canon)", () => {
  assert.equal(parseKey("0.1"), null);
  assert.equal(parseKey("1.0"), null);
  assert.equal(parseKey("1.1.0"), null);
});

test("parseKey: a leading-zero segment still parses to its numeric value (\"01.03\" -> book 1, chapter 3)", () => {
  assert.deepEqual(parseKey("01.03"), { book: 1, chapter: 3 });
});

test("parseKey: multi-digit segments parse correctly (\"45.16.25\" -- Romans 16:25)", () => {
  assert.deepEqual(parseKey("45.16.25"), { book: 45, chapter: 16, verse: 25 });
});

test("parseKey: too few or too many segments are rejected", () => {
  assert.equal(parseKey("1"), null);
  assert.equal(parseKey("1.2.3.4"), null);
});
