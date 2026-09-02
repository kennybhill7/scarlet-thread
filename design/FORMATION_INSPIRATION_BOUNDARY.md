# "The Story" and "A Leader's Heart" — what's real inspiration vs. what's not usable

**Date:** 2026-09-02
**Status:** Direction confirmed. Read both source books directly before writing this, not just a
secondhand summary of them — see "What's actually in each book" below.

---

## The ask

Ken shared two published, copyrighted books and asked that they be treated as "authoritative for
connecting this app": *The Story, NIV* (Zondervan) and *A Leader's Heart* (John C. Maxwell, Thomas
Nelson). A relayed analysis (from another assistant Ken consulted) proposed six new product
features inspired by them, while itself flagging the real risk: "I would not build a Zondervan +
Maxwell remix app."

That instinct is correct. This doc makes the boundary concrete, and — more importantly — shows
that most of what was proposed as new is already built.

---

## What's actually in each book (read directly, not summarized secondhand)

**`The Story, NIV`** — 31 chapters, large near-verbatim NIV Scripture excerpts connected by
Zondervan's own original transition paragraphs, in strict chronological (not canonical) order,
with a real BC-dated timeline chart at the front. Copyrighted on two layers: the NIV translation
(Biblica) and Zondervan's specific selection/arrangement/transition prose. **One genuinely useful
fact fell out of reading it**, not as inspiration but as corroboration: its timeline's BC dates
(Amos 760–750, Isaiah 740–681, the 930 BC kingdom division, etc.) line up closely with the
Thiele-based chronology already sourced and shipped in `COVENANTTIMELINE-001`
(`design/COVENANT_TIMELINE_RESEARCH.md`) — independent confirmation of already-completed work,
not a new source to draw content from.

**`A Leader's Heart`** — explicit "All rights reserved... except for brief quotations" (Thomas
Nelson, 2003/2010). A 365-day devotional: date header, a Scripture epigraph, a short reflection
built on Maxwell's own ministry/leadership-consulting anecdotes (e.g., a real story about Skyline
Wesleyan Church's attendance plateau), a citation to one of his other books, then one closing
open-ended reflective question. The FORMAT — short reading, real illustration, one closing
question — is a generic, decades-old devotional convention, not something proprietary to Maxwell.
The specific anecdotes and questions are his own copyrighted writing.

---

## The boundary

**Safe, real inspiration:** the shape/pacing/rhythm of a devotional or narrative-overview format —
question-at-the-end, chronological retelling, short-reading-then-reflection. Structural and
pedagogical patterns like this are not proprietary; countless devotionals and Bible-overview
products share them.

**Not usable:** transcribing, closely paraphrasing, or deriving any of these books' actual prose
— Zondervan's transition paragraphs, Maxwell's anecdotes, either book's specific reflection
questions — into anything the app ships. This isn't only a copyright concern (both works are
explicitly "all rights reserved," and the NIV text carries its own separate licensing terms this
project already treats carefully elsewhere, per the KJV UK licensing gate already on record). It
also cuts against something this app already decided on purpose: `ClaimComposer` exists
specifically to make a learner write their OWN observation before anything else happens
(BUILD_PLAN's tenet 1, "read before you write," and the whole "teaching not theology" assertion
line). Feeding a learner someone else's pre-written formation question would be the app doing the
noticing for them — the opposite of its own stated discipline.

**What this means practically:** these two books inform TONE and PACING decisions Ken and I make
together going forward (e.g., "should the Formation Question feel more like Maxwell's closing
prompts, punchy and personal, or more like the app's existing Conviction-section language?") —
never a text to pull from.

---

## The six proposed features, checked against what's actually built

Most of this is not a gap. It's already shipped, or already a deliberate, on-record decision to
wait.

| Proposed feature | Real status |
|---|---|
| "Where am I in the Story?" panel | **Already built.** The covenant rail + timeline rail (`COVENANTTIMELINE-001`, shipped 2026-09-02) plus the Mountain's mirror-pair structure already answer "what came before, what does this point to, where does this sit." |
| "Connection Confidence" system | **Already built.** `CONNREGISTERS-001` (motif/structural/typology/promise registers) plus `EVIDENCE_LABELS`, both already in the schema and UI. |
| "Don't Force It" button | **Already built, and old.** `no_warrant_yet` has been a first-class `StudyClaim` status since this project's very first week (mid-August theology-doc reconciliation) — one of the earliest decided things in this build, not a gap. |
| "Teach It Like a Preacher" mode | **Already built.** The Teach section's outline builder plus `TEACHMODE-001`'s "for me / for the room" toggle, shipped 2026-09-02. |
| "Modern Life Lab" | **Already named and scoped — deliberately deferred.** `BUILD_PLAN.md`/`THEOLOGY_PRODUCT_AUDIT.md` already name Modern Life Labs and place them post-founding-cohort, a decision already made, not a discovered gap. |
| "Formation Question" | **The one genuinely new idea.** `Conviction` and `Apply` claim kinds exist; a sharper, more consistently-asked question at the end of a study session is real, worthwhile, and not yet built — but needs to be written in this app's own voice, not adapted from Maxwell's. |

---

## The actual next step

Not six new features. One real, small, worth-doing refinement: a consistently-asked closing
question in the Apply/Conviction flow, written fresh for this app rather than adapted from either
source book — plus keeping the product-identity sentence Ken landed on ("helps you study the
Bible as one story, see how every passage connects, and turn understanding into faithful action")
as the north star for how existing features get framed and named, not as a brief for rebuilding
things that already exist.
