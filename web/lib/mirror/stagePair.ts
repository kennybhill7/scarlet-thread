/**
 * MIRRORSPLIT-001 — pure helpers for resolving one stage's mirror pair and
 * its display data. No React, no DB, no "use client" — kept free of
 * everything except `lib/contracts` and `lib/bible/reference` so it is
 * trivial to unit test and safe to import from both the server route
 * (app/(app)/mirror/[stageSlug]/page.tsx) and the client view
 * (components/mirror/MirrorSplitView.tsx).
 */
import type { RefKey, Stage } from "@/lib/contracts";
import { parseKey } from "@/lib/bible/reference";

export type MirrorPairResolution =
  | { status: "not-found" }
  | { status: "no-mirror"; stage: Stage }
  | { status: "broken-mirror"; stage: Stage }
  | { status: "ok"; stage: Stage; partner: Stage };

/**
 * Resolves the mirror partner for `slug` against the full stage set. Three
 * honest non-happy-path outcomes, on purpose (see this task's report for
 * the "matching beats" scoping note lib/mirror/scrollSync.ts documents in
 * full):
 *
 *   - "not-found": no stage has this slug at all — the caller 404s.
 *   - "no-mirror": the stage exists but its own `mirror` field is null.
 *     Stage 6 (the Gospels) is the only seeded example — the peak of the
 *     mountain has no pair by design, not a bug — but this branch also
 *     covers any future stage seeded the same way.
 *   - "broken-mirror": `mirror` points at a slug that isn't in the stage
 *     set at all. `lib/vault/seed.ts`'s `getReview()` flags exactly this
 *     condition for the Review screen's "Mirror integrity" section
 *     (`mirrorBreaks`); this route fails just as honestly rather than
 *     rendering half a comparison against a stage that doesn't exist.
 *
 * Deliberately NOT checked here: whether the partner points back
 * reciprocally (`partner.mirror === stage.slug`). A one-directional mirror
 * is still enough real data to render two real panes — Review's mirror
 * integrity check is the right place to flag "doesn't point back" as a
 * content problem to fix, not a reason for this reading route to refuse to
 * show what data does exist.
 */
export function resolveMirrorPair(stages: Stage[], slug: string): MirrorPairResolution {
  const stage = stages.find((s) => s.slug === slug);
  if (!stage) return { status: "not-found" };
  if (!stage.mirror) return { status: "no-mirror", stage };
  const partner = stages.find((s) => s.slug === stage.mirror);
  if (!partner) return { status: "broken-mirror", stage };
  return { status: "ok", stage, partner };
}

export interface OpeningChapterRef {
  book: number;
  chapter: number;
}

/**
 * The book/chapter a stage opens on, from its `chapters[0]` RefKey (e.g.
 * "1.3" = Genesis 3 — see lib/bible/reference.ts's own header for the
 * RefKey format). Null when the stage has no chapters seeded, or the first
 * one doesn't parse — both are data problems the caller must show
 * honestly, never a reason to crash or silently render chapter 1.
 */
export function resolveOpeningChapter(stage: Stage): OpeningChapterRef | null {
  const first: RefKey | undefined = stage.chapters[0];
  if (!first) return null;
  const parsed = parseKey(first);
  if (!parsed) return null;
  return { book: parsed.book, chapter: parsed.chapter };
}

export interface StageLabel {
  reference: string;
  short: string;
}

/**
 * Splits a stage title formatted "Reference — Short label" (e.g. "Genesis
 * 3–5 — Satan and Sin Enter") into its two halves. Same three dash variants
 * and same fallback (no dash found -> the whole title is the reference, an
 * empty short label) as `lib/vault/seed.ts`'s private `splitLabel` and
 * `app/(app)/page.tsx`'s own duplicate of it. A third copy here rather than
 * an import, matching that second file's own documented reason: the
 * original is unexported, and both existing copies live outside this
 * task's owned/read-only paths. Keep in sync if the title format ever
 * changes.
 */
export function splitStageLabel(title: string): StageLabel {
  for (const dash of [" — ", " – ", " - "]) {
    const idx = title.indexOf(dash);
    if (idx !== -1) {
      return { reference: title.slice(0, idx).trim(), short: title.slice(idx + dash.length).trim() };
    }
  }
  return { reference: title, short: "" };
}
