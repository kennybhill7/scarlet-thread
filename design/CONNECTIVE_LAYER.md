# The connective layer — Ken's teacher critique, and what's buildable now

**Date:** 2026-09-01
**Status:** Direction confirmed for Wave 1 (visual language). Waves 2+ scoped below, sequenced by
what needs new curated content vs. what's pure engineering on data that already exists.

---

## What's working (Ken, 2026-09-01)

> The eleven-stage arc is a real theological structure, not decoration — ascent/descent/summit
> with mirror pairs is a genuine reading of Scripture's shape, and thread-linking as a discipline
> (not a feature) is the right habit to build. Read-before-you-write and the third-sighting rule
> are both correct pedagogy.

## What's missing, as a teacher (Ken's critique, verbatim)

1. **The middle is hollow.** Stage 5 ("Israel") is one pin covering Genesis 12 through Malachi —
   39 books, most of the Bible's actual content, collapsed into the same visual weight as a
   two-chapter stage like Babel. That stretch needs its own sub-arc: Patriarchs → Exodus →
   Conquest → Kingdom → Exile → Return — each a mini-mountain with its own mirror logic, nested
   inside stage 5 rather than flattened by it. Same problem, smaller, in stage 7 (Acts–Jude).

2. **"Thread" is doing too many jobs.** Every kind of connection — a repeated word, a covenant, a
   type-and-fulfillment pair, the promise line to Christ — gets tagged the same way today. Four
   distinct registers:
   - **Covenant spine** (Noahic → Abrahamic → Mosaic → Davidic → New) is the skeleton. Fixed,
     always-visible rail, not a thread you discover.
   - **Typology** (Passover lamb → Christ, bronze serpent → the cross) is directional — shadow
     points to fulfillment, it doesn't mirror both ways like Genesis/Revelation does. Treating it
     as a symmetric "thread" flattens the logic.
   - **The promise line** (Genesis 3:15's seed, through the genealogies, to Christ) is a single
     continuous strand a reader should be able to pull and see light up — not buried at the same
     weight as fifty other threads.
   - **Motifs** (what the app does well today) are the fine-grained noticing layer — real, the
     smallest of the four.

3. **No historical vs. canonical timeline.** Kings and prophets are interleaved in real history
   but scattered across separate books canonically — a reader hits Isaiah with no sense of which
   king he's rebuking. A thin timeline rail, even just on the Israel sub-arc, solves this cheaply.

4. **Teaching mode doesn't exist yet beyond the outline generator.** A teacher needs the room's
   context first (covenant location, one tension, one image) before the personal conviction line.
   A toggle on the Teach pack: "for me" (current) vs. "for the room" (leads with context, saves or
   cuts the personal line).

> If I were building the connective tissue from scratch, the mountain stays as the spine — it's
> the right macro-shape — but every passage would carry four separate, distinguishable answers,
> always visible, never something the user has to notice on their own to unlock: which covenant is
> in force here, what does this typologically anticipate or fulfill, where does this sit in real
> history, and what motif have I personally noticed. Only the fourth one is yours to fill in. The
> first three are the app teaching you the map before asking you to draw on it.

---

## What's already true in the codebase (checked before writing this, not assumed)

The good news: most of Ken's four-register taxonomy **already exists as data**, just not as
distinct visual treatment.

- `web/lib/contracts/study-v2.ts:125-137` — `CONNECTION_TYPES` already has
  `covenant_development`, `type_antitype`, `promise_fulfillment`, and `motif` as four of its
  eleven values (the other seven — `quotation`, `explicit_reference`, `allusion`,
  `contrast_reversal`, `parallel`, `doctrinal_synthesis`, `personal_resonance` — need a mapping
  decision onto Ken's four registers, or a fifth "other" register; not yet decided).
- **But every type renders identically today.** `ThreadDetail.tsx:368-389` maps every
  `CONNECTION_TYPES` entry to an identical `<Chip>` (only `active` state differs — no per-type
  color, icon, or shape). `ThreadDetail.tsx:429` — the type is a plain text span, styled exactly
  like the `evidenceLabel` next to it. `ConnectSection.tsx:479-487` — the type-selection chips in
  the composer are the same generic `Chip` for every option. So this is genuinely a **rendering
  gap, not a data-model gap** — the taxonomy the theology needs is already ratified in the
  contract; the UI just never differentiated it.
- **No sub-stage/hierarchy concept exists.** `stages` table (`web/db/schema.ts:243-255`) has no
  `parentSlug`/self-referencing FK; `web/data/seed/stages.json` stage 5 is one flat record.
  `Mountain.tsx` renders one point per flat stage with no drill-down. The Israel sub-arc is a real
  new feature, not a rendering fix.
- **No timeline/chronological concept exists anywhere** — confirmed by a repo-wide grep. This is
  new, both mechanism and data.
- **No self-vs-audience field on `TeachingDraft`/`TeachingSection`.** `TeachingDraft.audience` is
  free text, not a mode flag; `TEACHING_SECTION_KINDS` (`outline, context, connection, theology,
  illustration, objection, application, not_justified, discussion, prayer`) are content
  categories, not personal-vs-room modes. The toggle needs either a client-side reordering rule
  over existing kinds, or a small additive schema field — leaning toward the former since it needs
  no migration.

---

## Claude Design's response — Section 14, "The connective layer"

Built into `design/scarlet-thread-app/Scarlet Thread App.dc.html` (section 14, added
2026-09-01T19:31Z sync) in direct response to the critique above. Concretely mocks:

1. **The covenant rail** — a fixed horizontal band (Noahic → Abrahamic → Mosaic → Davidic → New),
   color deepening toward scarlet as covenants approach the New Covenant, collapsing to one line
   on a passage screen ("Under: the Mosaic covenant, given at Sinai, ~500 years before David").
2. **The Israel sub-arc** — stage 5 becomes a nested mini-mountain: Patriarchs (Gen 12–50) →
   Exodus (Ex–Deut) → Conquest (Josh–Judg) → **Kingdom** (Sam–Kings · Psalms, the sub-peak — the
   Davidic covenant is cut here) → Exile (Kings–Prophets) → Return (Ezra–Malachi). Same
   rope-and-knot visual language as the main climb.
3. **Typology as a directional arrow** — a mirror pair (Creation ↔ New City) draws as a two-way
   tie; a type→fulfillment pair (Passover lamb → Christ) draws as one-directional, reading "shadow
   of ↦" or "fulfills ↤" depending which side you're on.
4. **The promise line as an isolatable strand** — a toggle ("Show only the promise line") that
   dims every other thread to 20% opacity while the promise line (Gen 3:15 → Gen 12:3 → Gen 49:10
   → 2 Sam 7:12 → Isa 7:14 → Matt 1:1 → Luke 3) holds full color, turned gold rather than scarlet
   since "it's the line, not a thread — it earns its own colour."
5. **A timeline rail** — prophet names above the rail, reigning kings below it, example shown for
   the divided-kingdom/Assyrian-threat/exile period (Isaiah/Micah under Ahaz/Hezekiah; Jeremiah/
   Ezekiel under Zedekiah).
6. **Teach mode toggle** — "For me" (current: your points in discovery order) vs. "For the room"
   (Where / Tension / Image, personal line optional and last). Built as a real interactive
   prototype in the `.dc.html` (`pickTeach`, `teachMe`/`teachRoom` state).

---

## Risk-weighted priority (Ken, 2026-09-01)

The six additions aren't equally load-bearing:

- **Clear wins, low risk — ship with confidence:** the timeline rail and covenant rail cost the
  user almost nothing (no new interaction, no new screen to learn) and answer real confusion
  every reader silently struggles with. Teach mode is the same category — it's just a reordering
  of data already captured, no new concept for the person writing.
- **Real win, real cost — prototype and user-test before committing:** the Israel sub-arc fixes a
  genuine structural imbalance, but adds a second level of navigation depth. Done poorly, "tap
  Israel → tap a phase → tap a chapter" starts to feel like drilling into a file system instead of
  climbing a mountain. The riskiest of the six; deserves the most scrutiny before it's wired into
  the live data model.
- **Depends on the person — make it opt-in, not default:** typology-as-arrow and the promise-line
  toggle are correct theologically and will delight someone who already thinks this way, but they
  add vocabulary a casual user has to learn (type vs. thread vs. promise line — three connective
  concepts where they currently have one). For the target user doing the daily loop, not writing a
  commentary, this is a power feature, not a default. Ship it behind an opt-in "deeper" toggle;
  watch usage data before promoting it to always-on.

This reorders the waves below: covenant rail, timeline rail, and Teach mode build with confidence.
The Israel sub-arc gets a prototype-and-test step before full commitment. Typology/promise-line
build as opt-in, off by default.

## Market strategy constraint (2026-09-01, `design/MARKET_STRATEGY.md`)

A separate strategy document lands the same instinct as Ken's risk-weighted priority above, at
product-architecture scale: a three-rung progressive-disclosure ladder (Orientation → Pattern →
Synthesis), where typology/promise-line/Israel-sub-arc/Mirror-Split are Rung-3 "go deeper"
features, never front-loaded — this directly confirms the opt-in-toggle decision above rather than
adding a new one. **Standing constraint for every future wave:** understanding itself is never
paywalled — the mountain, all 11 stages, threads, the covenant/timeline rails, typology, the
promise line, and the Israel sub-arc are free forever, no account required to start. Monetization
(when it's ever built — not scoped yet) lives only in the Teach/export layer, group/church
licensing, and physical goods (the woven-year poster). No feature-gating decision in this project
should silently contradict that without Ken explicitly revisiting it.

New build items the strategy doc surfaces, not yet scoped into a wave: **rope-thickens-with-use
rendering** (the Mountain's thread visually thickens/saturates per-stage based on real
`observationCount`/`threadCount` — reuses data already driving pin size today, just needs applying
to line weight once a real terrain redesign exists), a **session-end "watch the mountain change"
moment** (after the daily loop, show the mountain zoomed to the stage just worked, with the new
thread visibly added — replaces a streak-counter reward), and **Mirror Split** (Genesis 3 beside
Revelation 20, scroll-locked at matching beats — first proposed in Section 13 of
`design/scarlet-thread-app/Scarlet Thread App.dc.html`, item 1).

## Build sequencing

**Wave 1 — visual language foundation. DONE (2026-09-01, `8c5475c`).** Stone/scarlet token swap
(`--shell-bg`/`--shell-surface`/`--shell-border` family repointed from navy to stone; new
`--shell-crimson`/`--shell-crimson-text` declared inside the shell block, never reachable by
`[data-reading]`) and the three component replacements (Button's new `actionRow` variant, Chip's
square 2px-radius geometry, DailyLoop's rope-of-knots). Verified independently before merge:
every contrast ratio in the builder's report was recomputed from scratch (not trusted), one
mutation proof re-run by the orchestrator (the `[data-reading]` isolation guard — confirmed a
shell-crimson leak into the midnight block fails exactly the dedicated test), full suite green
(1006 tests) after cherry-picking onto current master alongside TEACHMODE-001. Two things to
know: `--shell-crimson` (3.71:1) is icon/glyph-only (the trailing action-row arrow) — never body
text; `Mountain.tsx` was left untouched but automatically inherits the new stone palette through
`--shell-*`, so it now sits on the new background without being redesigned itself. Everything
below assumes this visual language exists first.

**Wave 2 — connection-type visual registers. DONE (2026-09-02, `a541fed`).** All eleven
`CONNECTION_TYPES` now map through one pure taxonomy, `web/lib/workspace/connectionRegisters.ts`
(`registerForType`), consumed by both `ThreadDetail.tsx`'s browse/filter list and
`ConnectSection.tsx`'s composer picker so the two surfaces can never disagree. `covenant_development`
+ `parallel` + `contrast_reversal` (structural register) render a gold-deep badge always, no
toggle. `motif` + `quotation` + `explicit_reference` + `allusion` keep today's plain scarlet-tag
rendering unchanged. `type_antitype` (typology, directional "Shadow of ↦" / "Fulfills ↤") and
`promise_fulfillment` (its own gold-toned badge) render plainly by default and only pick up their
distinct treatment behind a new "Show deeper connections" toggle, off by default — exactly Ken's
2026-09-01 risk read. `doctrinal_synthesis`/`personal_resonance` stay unregistered, unchanged.
Verified independently before merge: every contrast ratio recomputed from scratch (structural and
promise badges both clear AA on their own `--gold-dim-bg` background; bare gold text on the page's
parchment surface was confirmed to FAIL, which is why every badge carries its own background
rather than colored inline text), one mutation proof re-run by the orchestrator (breaking the
structural-register list correctly failed the partition/mapping/render tests and nothing else),
full suite green (1032 tests) after merging behind ISRAELPROTO-001. One documented judgment call:
typology direction is inferred from canonical (66-book) order, since `UserConnection` has no
chronological field — correct for every OT-type→NT-antitype example in the design doc, but could
mislabel a same-testament pair; getting it wrong only swaps the label, never hides the connection.

**Wave 3 — the Israel sub-arc prototype. BUILT, awaiting Ken's test (2026-09-02, `fa36b03`).** A
real, isolated, clickable prototype at `/prototype/israel-sub-arc` — linked from nowhere in the
real nav, no schema/data-model change, verified (typecheck/lint/build/1021 tests green) and
merged to master, but explicitly NOT a shipped feature. Ken needs to actually click through it —
tap a phase, judge whether backing out feels like climbing or like drilling into a menu — before
any schema decision (self-referencing FK on `stages` vs. a new `subStages` table) gets made. Uses
the app's own `Sheet` component (the existing bottom-sheet convention) for the tap-in/tap-out
interaction rather than inventing a new modal pattern, so the ridge stays visible underneath.
Kingdom (Samuel–Kings, Psalms) renders as the sub-arc's own peak. The six-phase boundary Ken
supplied (Patriarchs/Exodus/Conquest/Kingdom/Exile/Return with real chapter ranges) is the only
content used — standard, uncontested Bible structure, not fabricated.

**Wave 4 — the timeline rail.** The mechanism is Wave-3-adjacent engineering. The DATA — which
king reigned when, which prophet spoke to which reign — needs real sourcing before it's complete
and defensible; regnal dates for the divided kingdom vary by scholar (a genuine academic
disagreement, not just Ken being careful). Ken's own critique message supplies a few real,
uncontested anchor points (Isaiah/Micah under Ahaz/Hezekiah; Jeremiah/Ezekiel under Zedekiah) —
enough to build and test the mechanism against, not enough to ship a complete rail. Full content
authorship is Ken's call, same as the Genesis 1–12/Matthew 1–7 curriculum content flagged
elsewhere in this project as something not to fabricate.

**Wave 5 — Teach mode toggle. DONE (2026-09-01, `f4c8b5c`).** Shipped as a pure, presentation-only
reorder of the existing `TeachingSection` rows (`reorderForRoom`/`FOR_ROOM_KIND_ORDER` in
`web/components/workspace/TeachSection.tsx`) — no schema change, `sortOrder` never touched.
Verified independently (typecheck/lint/build/992 tests green, one mutation proof re-run by the
orchestrator, not just the builder) before merge. **Real gap surfaced, not yet resolved:** the
mockup's "For the room" view relabels sections as Where/Tension/Image, which has no
correspondence to `TEACHING_SECTION_KINDS` — this wave deliberately shipped the reordering-only
version and left that relabeling as an open product question. Deciding whether the section-kind
vocabulary itself should change is Ken's call, not scoped into any wave yet.
