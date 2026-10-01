/**
 * PICKERCANON-001 — proves `public/bible/canon.json` (the compact verse-count
 * table `lib/bible/passageCanonClient.ts` fetches instead of all 66 BSB book
 * files) is byte-for-byte what `npm run bible:canon`
 * (`scripts/build-canon-counts.mts`) would emit from the REAL shipped corpus
 * right now.
 *
 * This is the guard the script's own header promises: if the corpus changes
 * (a new verse, a renumbered chapter, a book added) without someone re-running
 * `npm run bible:canon`, the committed file goes stale and the picker would
 * silently validate against the wrong verse counts. This test makes that
 * drift a hard CI failure instead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { renderCanonJson } from "../scripts/lib/buildCanonCounts";

// web/ root, same computation build-canon-counts.mts's own WEB_ROOT makes (tests/.. = web/).
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANON_PATH = path.join(WEB_ROOT, "public", "bible", "canon.json");

test("canon.json is byte-for-byte what build-canon-counts.mts emits from the real shipped BSB corpus right now", () => {
  const committed = readFileSync(CANON_PATH, "utf8");
  const fresh = renderCanonJson(WEB_ROOT);
  assert.equal(
    committed,
    fresh,
    "public/bible/canon.json has drifted from the real corpus -- run `npm run bible:canon` from web/ and commit the result",
  );
});

test("canon.json is valid JSON with the expected top-level shape (versificationId, generatedFrom, books)", () => {
  const parsed = JSON.parse(readFileSync(CANON_PATH, "utf8")) as Record<string, unknown>;
  assert.equal(typeof parsed.versificationId, "string");
  assert.equal(parsed.generatedFrom, "BSB");
  assert.equal(typeof parsed.books, "object");
  assert.ok(parsed.books !== null && !Array.isArray(parsed.books));
});

test("canon.json has exactly 66 books, each a non-empty array of positive integers", () => {
  const parsed = JSON.parse(readFileSync(CANON_PATH, "utf8")) as { books: Record<string, number[]> };
  const keys = Object.keys(parsed.books);
  assert.equal(keys.length, 66);
  for (const key of keys) {
    const counts = parsed.books[key];
    assert.ok(Array.isArray(counts) && counts.length > 0, `book ${key} has no chapters`);
    for (const count of counts) {
      assert.ok(Number.isInteger(count) && count > 0, `book ${key} has a non-positive-integer verse count: ${count}`);
    }
  }
});

test("canon.json is genuinely small (the whole point of this task): well under the old ~4 MB footprint", () => {
  const bytes = Buffer.byteLength(readFileSync(CANON_PATH, "utf8"), "utf8");
  assert.ok(bytes < 15_000, `canon.json is ${bytes} bytes, expected well under 15 KB`);
});

test("MUTATION-PROVING: a corrupted canon.json (one verse count changed) is caught by the drift test, not silently accepted", () => {
  const fresh = renderCanonJson(WEB_ROOT);
  const mutated = fresh.replace('"1":[', '"1":[999,');
  assert.notEqual(mutated, fresh, "sanity: the mutation actually changed the string");
  // This directly exercises the same comparison the first test makes, proving
  // a real drift is not silently equal.
  assert.notEqual(readFileSync(CANON_PATH, "utf8"), mutated);
});
