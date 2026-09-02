/**
 * COVENANTTIMELINE-001 — lib/bible/covenants.ts.
 *
 * Proves: (a) the data matches the app's real 11 stage slugs
 * (web/data/seed/stages.json, read-only) exactly, (b) stage 5 ("Israel")
 * carries a real four-covenant sequence rather than one flattened badge,
 * (c) stage 6 is flagged hideInReader per the research doc's own carried-
 * forward instruction, (d) the book/chapter -> stage resolver's boundaries,
 * including the documented Revelation tie-break.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE_COVENANTS,
  covenantsForRef,
  covenantsForStage,
  stageSlugForRef,
} from "@/lib/bible/covenants";

// The app's real 11 stage slugs, transcribed from web/data/seed/stages.json
// (gitignored, read directly during this task -- not importable from a test
// run in a fresh worktree, so the expected slug list is pinned here instead
// of read from the file at test time).
const REAL_STAGE_SLUGS = [
  "gen-01-02-creation",
  "gen-03-05-sin-enters",
  "gen-06-09-the-flood",
  "gen-10-11-babel",
  "gen-12-malachi-israel",
  "gospels-jesus-christ",
  "acts-jude-the-church",
  "rev-01-18-babylon",
  "rev-06-19-the-world-judged",
  "rev-20-satan-cast-out",
  "rev-20-22-paradise-restored",
];

test("STAGE_COVENANTS: exactly the app's 11 real stage slugs, each exactly once", () => {
  assert.equal(STAGE_COVENANTS.length, 11);
  const slugs = STAGE_COVENANTS.map((s) => s.stageSlug).sort();
  assert.deepEqual(slugs, [...REAL_STAGE_SLUGS].sort());
});

test("covenantsForStage: stage 5 (Israel) carries a real 4-fact sequence, not a single badge", () => {
  const entry = covenantsForStage("gen-12-malachi-israel");
  assert.ok(entry);
  assert.deepEqual(
    entry!.covenants.map((c) => c.covenant),
    ["Abrahamic", "Mosaic", "Davidic", "New"],
  );
  assert.deepEqual(
    entry!.covenants.map((c) => c.status),
    ["instituted", "instituted", "instituted", "announced_not_instituted"],
  );
  // Every fact in this table is text_explicit per the research doc's 1.3 row.
  assert.ok(entry!.covenants.every((c) => c.confidence === "text_explicit"));
});

test("covenantsForStage: stages 1 and 2 carry no covenant yet, honestly (empty array + stage note, not omitted)", () => {
  const creation = covenantsForStage("gen-01-02-creation");
  const sinEnters = covenantsForStage("gen-03-05-sin-enters");
  assert.deepEqual(creation!.covenants, []);
  assert.deepEqual(sinEnters!.covenants, []);
  assert.match(creation!.stageNote ?? "", /not.*instituted|none of the five/i);
  assert.match(sinEnters!.stageNote ?? "", /not.*instituted|none of the five/i);
});

test("covenantsForStage: stage 3 (the Flood) institutes the Noahic covenant; stage 4 (Babel) carries it in force with no new text", () => {
  const flood = covenantsForStage("gen-06-09-the-flood");
  assert.equal(flood!.covenants.length, 1);
  assert.equal(flood!.covenants[0].covenant, "Noahic");
  assert.equal(flood!.covenants[0].status, "instituted");

  const babel = covenantsForStage("gen-10-11-babel");
  assert.equal(babel!.covenants.length, 1);
  assert.equal(babel!.covenants[0].covenant, "Noahic");
  assert.equal(babel!.covenants[0].status, "in_force");
});

test("covenantsForStage: stage 6 (Gospels) is flagged hideInReader -- data retained, UI must not render it", () => {
  const gospels = covenantsForStage("gospels-jesus-christ");
  assert.ok(gospels);
  assert.equal(gospels!.hideInReader, true);
  assert.equal(gospels!.covenants[0].covenant, "New");
  assert.equal(gospels!.covenants[0].status, "instituted");
});

test("covenantsForStage: stage 11 (Paradise Restored) never asserts Abrahamic/Davidic fulfillment as fact -- only flags it as tradition-dependent", () => {
  const paradise = covenantsForStage("rev-20-22-paradise-restored");
  assert.ok(paradise!.stageNote);
  assert.match(paradise!.stageNote!, /tradition-dependent/i);
  assert.doesNotMatch(paradise!.stageNote!, /is fulfilled/i);
  assert.equal(paradise!.covenants[0].status, "consummated");
});

// ---------------------------------------------------------------------------
// stageSlugForRef / covenantsForRef -- book/chapter resolution.
// ---------------------------------------------------------------------------

test("stageSlugForRef: Genesis 1-2 / 3-5 / 6-9 / 10-11 boundaries", () => {
  assert.equal(stageSlugForRef(1, 1), "gen-01-02-creation");
  assert.equal(stageSlugForRef(1, 2), "gen-01-02-creation");
  assert.equal(stageSlugForRef(1, 3), "gen-03-05-sin-enters");
  assert.equal(stageSlugForRef(1, 5), "gen-03-05-sin-enters");
  assert.equal(stageSlugForRef(1, 6), "gen-06-09-the-flood");
  assert.equal(stageSlugForRef(1, 9), "gen-06-09-the-flood");
  assert.equal(stageSlugForRef(1, 10), "gen-10-11-babel");
  assert.equal(stageSlugForRef(1, 11), "gen-10-11-babel");
  assert.equal(stageSlugForRef(1, 12), "gen-12-malachi-israel");
  assert.equal(stageSlugForRef(1, 50), "gen-12-malachi-israel"); // Genesis's last chapter
});

test("stageSlugForRef: every other Old Testament book (Exodus..Malachi) is the Israel stage", () => {
  assert.equal(stageSlugForRef(2, 1), "gen-12-malachi-israel"); // Exodus
  assert.equal(stageSlugForRef(19, 23), "gen-12-malachi-israel"); // Psalms
  assert.equal(stageSlugForRef(39, 4), "gen-12-malachi-israel"); // Malachi's last chapter
});

test("stageSlugForRef: the Gospels (Matthew-John, books 40-43) resolve to the Gospels stage", () => {
  assert.equal(stageSlugForRef(40, 1), "gospels-jesus-christ");
  assert.equal(stageSlugForRef(43, 21), "gospels-jesus-christ"); // John's last chapter
});

test("stageSlugForRef: Acts-Jude (books 44-65) resolve to the Church stage", () => {
  assert.equal(stageSlugForRef(44, 1), "acts-jude-the-church");
  assert.equal(stageSlugForRef(58, 1), "acts-jude-the-church"); // Hebrews
  assert.equal(stageSlugForRef(65, 1), "acts-jude-the-church"); // Jude
});

test("stageSlugForRef: Revelation's documented first-match-wins tie-break -- 1-18 Babylon, 19 World Judged, 20 Satan Cast Out, 21-22 Paradise Restored", () => {
  assert.equal(stageSlugForRef(66, 1), "rev-01-18-babylon");
  assert.equal(stageSlugForRef(66, 6), "rev-01-18-babylon"); // inside both 1-18 and 6-19; Babylon wins
  assert.equal(stageSlugForRef(66, 18), "rev-01-18-babylon");
  assert.equal(stageSlugForRef(66, 19), "rev-06-19-the-world-judged"); // only World Judged covers 19
  assert.equal(stageSlugForRef(66, 20), "rev-20-satan-cast-out"); // inside both 20 and 20-22; Satan Cast Out wins
  assert.equal(stageSlugForRef(66, 21), "rev-20-22-paradise-restored");
  assert.equal(stageSlugForRef(66, 22), "rev-20-22-paradise-restored");
});

test("stageSlugForRef: out-of-range book/chapter returns undefined, never a guess", () => {
  assert.equal(stageSlugForRef(0, 1), undefined);
  assert.equal(stageSlugForRef(67, 1), undefined);
  assert.equal(stageSlugForRef(1, 0), undefined);
  assert.equal(stageSlugForRef(1, -1), undefined);
});

test("covenantsForRef: resolves the same entry stageSlugForRef + covenantsForStage would, for a real reference", () => {
  const direct = covenantsForRef(1, 15); // Genesis 15 -- inside the Israel stage
  const viaSlug = covenantsForStage(stageSlugForRef(1, 15)!);
  assert.deepEqual(direct, viaSlug);
  assert.equal(direct!.stageSlug, "gen-12-malachi-israel");
});

test("covenantsForRef: undefined for an out-of-range reference, not a fallback guess", () => {
  assert.equal(covenantsForRef(0, 1), undefined);
});
