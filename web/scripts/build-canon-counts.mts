#!/usr/bin/env -S npx tsx
/**
 * PICKERCANON-001 — builds `public/bible/canon.json`, the compact per-book,
 * per-chapter verse-count table the PassagePicker / range validation need.
 *
 *   npm run bible:canon        (from web/)
 *
 * Why it exists: the counts used to be derived in the browser by fetching all
 * 66 BSB book files (~4 MB). They are pure functions of the shipped corpus, so
 * they are computed here once, at build time, and shipped as a few KB:
 *
 *   { "versificationId": <CANONICAL_VERSIFICATION_ID>,
 *     "generatedFrom": "BSB",
 *     "books": { "<bookNumber>": [versesInCh1, versesInCh2, ...] } }
 *
 * Output is minified JSON with NO trailing newline and is deterministic (book
 * keys ascend numerically), so `tests/canon-counts-drift.test.ts` can assert
 * the committed file is byte-for-byte what this script emits. If it is not,
 * the corpus changed without this script being re-run and CI fails.
 *
 * The real logic lives in `scripts/lib/buildCanonCounts.ts` (this repo's own
 * logic-vs-IO split, e.g. `scripts/lib/importCrossReferences.ts`) so the
 * drift test imports the REAL function, never a reimplementation — this file
 * is just the CLI entrypoint that writes the output.
 *
 * MAINTAINER NOTE: `tools/build_bible.py` generates public/bible/BSB/*.json
 * and index.json. It should run `npm run bible:canon` (from web/) after it
 * finishes, so canon.json is regenerated in the same step as the corpus. Until
 * it does, the drift test is what catches a forgotten regeneration.
 *
 * Fails closed: a missing book, a chapter-count disagreement with index.json,
 * or a chapter with no verses aborts with a non-zero exit and writes nothing.
 *
 * Author: Kenneth Hill
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderCanonJson } from "./lib/buildCanonCounts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");

function main(): void {
  const out = path.join(WEB_ROOT, "public", "bible", "canon.json");
  const text = renderCanonJson(WEB_ROOT);
  writeFileSync(out, text, "utf8");
  console.log(`wrote ${out} (${Buffer.byteLength(text, "utf8")} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
