# The Story spine — decisions

**Date:** 2026-09-02
**Answers:** `design/scarlet-thread-app/Scarlet Thread - Story Spine.md`, section 6's four open
decisions. Ken confirmed all four; recorded here so it's real project state, not a chat answer.

---

1. **31 or 35 chapters — 35.** Adopting the unmodified 31 skips Babel (Genesis 10–11) and most of
   Revelation 6–18 entirely, which breaks two of the five mirror pairs (Babel↔Babylon,
   Flood↔World Judged) that are structural to the Mountain, not decorative. The four additions
   (1b, 31a, 31b, 31c) restore both without disturbing The Story's own 1–31 numbering, so a reader
   following along in the physical book stays in sync.

2. **Zondervan's chapter titles or renamed — renamed.** Costs nothing and removes any dependency
   on their editorial wording, including the judgment call of whether a given title has drifted
   from "structural fact" into their voice. Use the `altTitle` field the data shape already has
   for this; ship written-fresh titles as the primary `title`, keep Zondervan's original only as
   an internal cross-reference if useful for QA, never rendered.

3. **Reading days per chapter — 4.** A middle default: 35 chapters × 4 days ≈ 20 weeks. Not a
   locked-in constant — make it a single configurable number, not hardcoded per-chapter, so it can
   move without a data migration if it's wrong in practice once real users hit it.

4. **Sub-arc as its own route or a filter — a filter on the existing stage view.** Matches how
   `ISRAELPROTO-001` (the Israel sub-arc prototype already in the repo, `web/app/(app)/prototype/
   israel-sub-arc/page.tsx`) already approaches stage 5 — cheaper to build, and there's no
   evidence yet that a dedicated `/stage/5/phase/kingdom`-style route is actually needed until the
   filter version has been used for real. If usage later shows the filter is insufficient
   (deep-linking to a specific phase, browser back/forward expectations, etc.), promote it to a
   route then — that's a mechanical follow-up, not a redesign.

---

## What this unblocks

The 35-chapter data (§4 of the Story Spine doc, the `{id, n, label, title, altTitle, stage,
phase, passages, source, chapterCount}` shape) can now be finalized as real committed data —
book codes matching `web/public/bible/BSB/`'s scheme per that section's own note, `chapterCount`
summed from `passages` (the same input `MOUNTAINPLATES-001`'s reflow math already consumes, so
no new spacing logic is needed on the build side).
