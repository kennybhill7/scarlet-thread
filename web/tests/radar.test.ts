/**
 * RADAR-001 — dedicated tests for `lib/db/radar.ts`, the first the thread
 * radar has ever had (CODEX_AUDIT.md A-045: "There is no automated radar
 * test.").
 *
 * Covers the acceptance criteria verbatim:
 *  - repeated words within ONE passage never reach three sightings
 *  - three distinct passages do
 *  - the exact threshold boundary (2 vs 3) is pinned
 *  - multi-word thread titles are handled (the A-045 "additional evidence"
 *    bug: a per-entry title check that compared a single word against a
 *    whole title string, so it could only ever match a one-word title)
 *  - plural/case normalisation works
 *  - the output shape is a motif candidate (label, normalizedKey, passages,
 *    status), never a typed relationship between two passages
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Entry, Thread } from "@/lib/contracts";
import {
  BOOK_NAMES,
  computeMotifCandidates,
  MOTIF_CANDIDATE_MIN_SIGHTINGS,
  normaliseWord,
  STOPWORDS,
} from "@/lib/db/radar";

let idCounter = 0;

function mkEntry(overrides: Partial<Entry> & Pick<Entry, "body" | "chapter">): Entry {
  idCounter += 1;
  return {
    id: `e-${idCounter}`,
    kind: "observation",
    threads: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mkThread(overrides: Partial<Thread> & Pick<Thread, "slug" | "title">): Thread {
  return {
    definition: "",
    seeing: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Third-sighting rule (A-045, half 1)
// ---------------------------------------------------------------------------

test("repeated words within ONE passage do not reach three sightings", () => {
  const entries: Entry[] = [
    mkEntry({ body: "wilderness wilderness wilderness wilderness wilderness", chapter: "1.1" }),
    mkEntry({ body: "the wilderness again, still the wilderness", chapter: "1.1" }),
    mkEntry({ body: "more wilderness notes about the very same wilderness", chapter: "1.1" }),
  ];

  // Five+ raw mentions across three entries, but all anchored to ONE chapter
  // -- must not count as three sightings.
  assert.deepEqual(computeMotifCandidates(entries, []), []);
});

test("three distinct passages promote a word to a candidate", () => {
  const entries: Entry[] = [
    mkEntry({ body: "a covenant renewed here", chapter: "1.1" }),
    mkEntry({ body: "another covenant sighting", chapter: "2.1", kind: "question" }),
    mkEntry({ body: "covenant language a third time", chapter: "3.1" }),
  ];

  const hits = computeMotifCandidates(entries, []);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].label, "covenant");
  assert.deepEqual(hits[0].passages, ["1.1", "2.1", "3.1"]);
});

test("pins the exact threshold boundary: two distinct passages is not enough, three is", () => {
  assert.equal(MOTIF_CANDIDATE_MIN_SIGHTINGS, 3);

  const twoPassages: Entry[] = [
    mkEntry({ body: "covenant renewed here today", chapter: "1.1" }),
    mkEntry({ body: "covenant language again elsewhere", chapter: "2.1" }),
  ];
  assert.deepEqual(
    computeMotifCandidates(twoPassages, []),
    [],
    "two distinct passages must not surface a candidate",
  );

  const threePassages: Entry[] = [
    ...twoPassages,
    mkEntry({ body: "covenant sighting a third distinct time", chapter: "3.1" }),
  ];
  const hits = computeMotifCandidates(threePassages, []);
  assert.equal(hits.length, 1, "the third distinct passage must surface exactly one candidate");
  assert.equal(hits[0].label, "covenant");
});

// ---------------------------------------------------------------------------
// Honest coverage (A-045, half 2) — multi-word thread titles
// ---------------------------------------------------------------------------

test("a word from a multi-word thread title is excluded as a candidate, whether or not the entry links to that thread", () => {
  const threads: Thread[] = [mkThread({ slug: "covenant-faithfulness", title: "Covenant Faithfulness" })];

  // "faithfulness" is the SECOND word of a two-word title. Proven by direct
  // execution against the original algorithm (see lib/db/radar.ts's header
  // comment, A-045 finding 2) that a per-entry "is THIS entry linked to the
  // thread that names it" check never fired even before this fix -- the
  // word-level blocklist built one line earlier already drops every title
  // word globally, so linkage was never the deciding factor. Prove that
  // directly: identical exclusion whether the entry links to the thread...
  const linked: Entry[] = [
    mkEntry({ body: "faithfulness shows up here", chapter: "1.1", threads: ["covenant-faithfulness"] }),
    mkEntry({ body: "faithfulness again in this passage", chapter: "2.1", threads: ["covenant-faithfulness"] }),
    mkEntry({ body: "a third faithfulness sighting", chapter: "3.1", threads: ["covenant-faithfulness"] }),
  ];
  assert.deepEqual(computeMotifCandidates(linked, threads), []);

  // ...or not.
  const unlinked: Entry[] = [
    mkEntry({ body: "faithfulness shows up here", chapter: "1.1" }),
    mkEntry({ body: "faithfulness again in this passage", chapter: "2.1" }),
    mkEntry({ body: "a third faithfulness sighting", chapter: "3.1" }),
  ];
  assert.deepEqual(computeMotifCandidates(unlinked, threads), []);
});

test("a word absent from every thread title still becomes a candidate at the third sighting", () => {
  const threads: Thread[] = [mkThread({ slug: "covenant-faithfulness", title: "Covenant Faithfulness" })];
  const entries: Entry[] = [
    // Positive control: not a substring or token of the one thread title in
    // scope, so nothing should suppress it.
    mkEntry({ body: "steadfastness shows up here", chapter: "1.1" }),
    mkEntry({ body: "steadfastness again in this passage", chapter: "2.1" }),
    mkEntry({ body: "a third steadfastness sighting", chapter: "3.1" }),
  ];

  const hits = computeMotifCandidates(entries, threads);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].label, "steadfastness");
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test("plural and case variants of the same word merge into one candidate", () => {
  const entries: Entry[] = [
    mkEntry({ body: "the NATIONS gathered here", chapter: "1.1" }),
    mkEntry({ body: "one Nation stood apart", chapter: "2.1" }),
    mkEntry({ body: "every nation eventually", chapter: "3.1" }),
  ];

  const hits = computeMotifCandidates(entries, []);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].label, "nation");
  assert.deepEqual(hits[0].passages, ["1.1", "2.1", "3.1"]);
});

test("normaliseWord merges the plural forms the radar relies on", () => {
  assert.equal(normaliseWord("nations"), "nation");
  // Crude plural-merge, not real stemming (see the function's own doc comment)
  // -- "promises" loses its trailing "e" too. Pinning the REAL output of the
  // ported algorithm, not an idealized one; this is faithful-port behavior,
  // not something this task changes.
  assert.equal(normaliseWord("promises"), "promis");
  assert.equal(normaliseWord("witnesses"), "witness");
  assert.equal(normaliseWord("mercies"), "mercy");
  assert.equal(normaliseWord("witness"), "witness"); // ends in "ss" -- must not be stripped to "witnes"
});

test("multi-word thread titles contribute every token to the global blocklist, not just the first word", () => {
  const threads: Thread[] = [mkThread({ slug: "exile-and-return", title: "Exile And Return" })];
  const entries: Entry[] = [
    mkEntry({ body: "return happened again here", chapter: "1.1" }),
    mkEntry({ body: "another return to the land", chapter: "2.1" }),
    mkEntry({ body: "a third return recorded", chapter: "3.1" }),
  ];

  // "return" is the LAST word of a three-word title -- must still be
  // recognised, not just the first token.
  assert.deepEqual(computeMotifCandidates(entries, threads), []);
});

// ---------------------------------------------------------------------------
// Shape — motif candidate, never a typed relationship (acceptance criterion 1)
// ---------------------------------------------------------------------------

test("a candidate is shaped as label / normalizedKey / passages / status, nothing else", () => {
  const entries: Entry[] = [
    mkEntry({ body: "covenant renewed here", chapter: "1.1" }),
    mkEntry({ body: "covenant sighting again", chapter: "2.1" }),
    mkEntry({ body: "covenant a third time", chapter: "3.1" }),
  ];

  const hits = computeMotifCandidates(entries, []);
  assert.equal(hits.length, 1);
  assert.deepEqual(Object.keys(hits[0]).sort(), ["label", "normalizedKey", "passages", "status"]);
  assert.equal(hits[0].normalizedKey, hits[0].label);
  assert.equal(typeof hits[0].status, "string");
  assert.ok(hits[0].status.length > 0);
  // Never a connection: no relationship, no "from"/"to" range, no type.
  assert.equal((hits[0] as Record<string, unknown>).type, undefined);
  assert.equal((hits[0] as Record<string, unknown>).fromRange, undefined);
  assert.equal((hits[0] as Record<string, unknown>).toRange, undefined);
});

// ---------------------------------------------------------------------------
// Filters carried over from the audited seed.ts algorithm
// ---------------------------------------------------------------------------

test("only observation and question entries feed the radar -- notes and teaching do not", () => {
  const entries: Entry[] = [
    mkEntry({ body: "testimony recorded here", chapter: "1.1", kind: "note" }),
    mkEntry({ body: "testimony recorded here too", chapter: "2.1", kind: "teaching" }),
    mkEntry({ body: "testimony a third passage", chapter: "3.1", kind: "note" }),
  ];

  assert.deepEqual(computeMotifCandidates(entries, []), []);
});

test("stopwords and book names never surface as candidates regardless of frequency", () => {
  const entries: Entry[] = [
    mkEntry({ body: "genesis genesis genesis everything through against", chapter: "1.1" }),
    mkEntry({ body: "genesis reads reading chapter chapters verse", chapter: "2.1" }),
    mkEntry({ body: "genesis another another same other", chapter: "3.1" }),
  ];

  assert.deepEqual(computeMotifCandidates(entries, []), []);
  assert.ok(BOOK_NAMES.has("genesis"));
  assert.ok(STOPWORDS.has("everything"));
});

test("words under five characters never surface (matches the seed.ts length filter)", () => {
  const entries: Entry[] = [
    mkEntry({ body: "hope hope hope hope hope", chapter: "1.1" }),
    mkEntry({ body: "hope again and again", chapter: "2.1" }),
    mkEntry({ body: "hope a third passage", chapter: "3.1" }),
  ];

  assert.deepEqual(computeMotifCandidates(entries, []), []);
});
