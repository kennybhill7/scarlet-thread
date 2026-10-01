/**
 * MOUNTAINWHY-001 — tests for lib/climb/stageOrder.ts: the canonical-order
 * toggle's two real orderings of the 11 mountain stages.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { stageSlugForRef } from "@/lib/bible/covenants";
import { CANONICAL_STARTS, canonicalOrder, lensOrder, ordersDiffer, type OrderableStage } from "@/lib/climb/stageOrder";

// The app's real 11 stages' slug + lens stage number, independent of title
// text (title text is out of scope for this module -- see its own header).
const REAL_STAGES: OrderableStage[] = [
  { slug: "gen-01-02-creation", stage: 1 },
  { slug: "gen-03-05-sin-enters", stage: 2 },
  { slug: "gen-06-09-the-flood", stage: 3 },
  { slug: "gen-10-11-babel", stage: 4 },
  { slug: "gen-12-malachi-israel", stage: 5 },
  { slug: "gospels-jesus-christ", stage: 6 },
  { slug: "acts-jude-the-church", stage: 7 },
  { slug: "rev-01-18-babylon", stage: 8 },
  { slug: "rev-06-19-the-world-judged", stage: 9 },
  { slug: "rev-20-satan-cast-out", stage: 10 },
  { slug: "rev-20-22-paradise-restored", stage: 11 },
];

test("CANONICAL_STARTS: exactly the 11 real stage slugs, each once", () => {
  assert.equal(CANONICAL_STARTS.length, 11);
  const slugs = new Set(CANONICAL_STARTS.map((s) => s.slug));
  assert.equal(slugs.size, 11);
  for (const stage of REAL_STAGES) assert.ok(slugs.has(stage.slug), `missing ${stage.slug}`);
});

test("CANONICAL_STARTS cross-checked against lib/bible/covenants.ts's own stageSlugForRef (so the two tables cannot silently drift)", () => {
  // Two of covenants.ts's own documented ties (module header: "Revelation
  // ... does not [partition cleanly]: stage 8 'Revelation 1-18'/Babylon and
  // stage 9 'Revelation 6-19'/The World Judged are two thematic lenses over
  // the same chapters") mean `stageSlugForRef` cannot be probed at this
  // table's own `chapter` value for the LATER stage of each overlapping
  // pair -- its first-match-wins rule always resolves the shared chapter to
  // the EARLIER stage. Both ties are asserted directly here (matching
  // covenants.test.ts's own "Revelation's documented first-match-wins
  // tie-break" test) rather than silently worked around, and each later
  // stage is instead cross-checked at a chapter exclusively its own.
  const KNOWN_TIES: Record<string, { sharesChapterWith: string; exclusiveProbeChapter: number }> = {
    "rev-06-19-the-world-judged": { sharesChapterWith: "rev-01-18-babylon", exclusiveProbeChapter: 19 },
    "rev-20-22-paradise-restored": { sharesChapterWith: "rev-20-satan-cast-out", exclusiveProbeChapter: 21 },
  };

  for (const start of CANONICAL_STARTS) {
    const tie = KNOWN_TIES[start.slug];
    if (tie) {
      assert.equal(stageSlugForRef(start.book, start.chapter), tie.sharesChapterWith);
      assert.equal(stageSlugForRef(start.book, tie.exclusiveProbeChapter), start.slug);
      continue;
    }
    const resolved = stageSlugForRef(start.book, start.chapter);
    assert.equal(resolved, start.slug, `CANONICAL_STARTS has ${start.slug} at book ${start.book} ch ${start.chapter}, but stageSlugForRef resolves that to ${resolved}`);
  }
});

test("lensOrder: sorts ascending by stage number, regardless of input order", () => {
  const shuffled = [...REAL_STAGES].reverse();
  assert.deepEqual(
    lensOrder(shuffled).map((s) => s.slug),
    REAL_STAGES.map((s) => s.slug),
  );
});

test("lensOrder: does not mutate its input", () => {
  const input = [...REAL_STAGES].reverse();
  const copy = [...input];
  lensOrder(input);
  assert.deepEqual(input, copy);
});

test("canonicalOrder: every real stage resolves to a real position (no silent drop)", () => {
  const ordered = canonicalOrder(REAL_STAGES);
  assert.equal(ordered.length, 11);
  assert.deepEqual(
    new Set(ordered.map((s) => s.slug)),
    new Set(REAL_STAGES.map((s) => s.slug)),
  );
});

test("canonicalOrder: for the app's real 11 stages, matches lensOrder exactly -- an honest, tested finding, not an assumption (see stageOrder.ts's own header)", () => {
  assert.deepEqual(
    canonicalOrder(REAL_STAGES).map((s) => s.slug),
    lensOrder(REAL_STAGES).map((s) => s.slug),
  );
  assert.equal(ordersDiffer(REAL_STAGES), false);
});

test("canonicalOrder: a stage slug with no CANONICAL_STARTS entry sorts last, by its own stage number, rather than throwing", () => {
  const withUnknown: OrderableStage[] = [...REAL_STAGES, { slug: "made-up-stage", stage: 99 }];
  const ordered = canonicalOrder(withUnknown);
  assert.equal(ordered[ordered.length - 1].slug, "made-up-stage");
});

test("ordersDiffer: true for a genuinely reordered data set (a synthetic case, proving the function itself is not hardcoded to false)", () => {
  // Swap two stages' canonical books so the lens order and canonical order
  // of this SYNTHETIC set genuinely disagree -- a real exercise of the
  // comparison logic, independent of whether the real app data happens to
  // agree (the test above already covers that real-data case).
  const reordered: OrderableStage[] = [
    { slug: "rev-01-18-babylon", stage: 1 }, // lens says this is first...
    { slug: "gen-01-02-creation", stage: 2 }, // ...but canonically Genesis 1 comes first.
  ];
  assert.equal(ordersDiffer(reordered), true);
  assert.deepEqual(
    canonicalOrder(reordered).map((s) => s.slug),
    ["gen-01-02-creation", "rev-01-18-babylon"],
  );
});
