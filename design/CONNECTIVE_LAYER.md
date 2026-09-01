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

## Build sequencing

**Wave 1 — visual language foundation (building now, no new content needed).** The stone/scarlet
token swap and the three component replacements (Button → type-only action row, Chip → square
thread tag, DailyLoop's row → rope of knots) that Ken already scoped as the two structural changes
in `Scarlet Thread App.dc.html`. Everything below assumes this visual language exists first.

**Wave 2 — connection-type visual registers (buildable now, no new content needed).** Differentiate
the already-existing `CONNECTION_TYPES` into Ken's four registers at the rendering layer.
`covenant_development` gets the fixed-rail treatment — ship with confidence, low risk. `motif`
keeps today's scarlet-tag treatment — no change needed. `type_antitype` (directional arrow) and
`promise_fulfillment` (isolatable strand) ship **behind an opt-in "deeper" toggle, off by
default** — per Ken's 2026-09-01 risk read: theologically correct but adds vocabulary (type vs.
thread vs. promise line) a casual daily-loop user doesn't need by default. The seven remaining
types need an explicit mapping decision before this is fully spec'd — reasonable default:
`quotation`/`explicit_reference`/`allusion` join the motif register (textual-echo noticing, same
as today), `parallel`/`contrast_reversal` join the covenant/structural register (both about the
canon's macro-shape, same family as the existing mirror ties), `doctrinal_synthesis`/
`personal_resonance` stay their own thing (closer to the Theology/Conviction claim kinds already
in the workspace than to any of the four).

**Wave 3 — the Israel sub-arc: prototype and test before committing.** The riskiest of the six per
Ken's 2026-09-01 risk read — a real structural win, but it adds a second navigation depth that,
done poorly, turns "climb a mountain" into "drill into a file system." Sequence: build a
clickable prototype (design-only or a feature-flagged real build Ken can try locally) BEFORE
wiring it into the live data model — do not commit to the schema shape until the navigation feel
is tested. The six-phase boundary Ken already gave (Patriarchs/Exodus/Conquest/Kingdom/Exile/
Return with real chapter ranges) is usable as real content, not fabricated — standard,
uncontested Bible structure, not an interpretive claim. Schema decision (self-referencing FK on
`stages`, or a new `subStages` table) comes after the prototype is approved, not before.

**Wave 4 — the timeline rail.** The mechanism is Wave-3-adjacent engineering. The DATA — which
king reigned when, which prophet spoke to which reign — needs real sourcing before it's complete
and defensible; regnal dates for the divided kingdom vary by scholar (a genuine academic
disagreement, not just Ken being careful). Ken's own critique message supplies a few real,
uncontested anchor points (Isaiah/Micah under Ahaz/Hezekiah; Jeremiah/Ezekiel under Zedekiah) —
enough to build and test the mechanism against, not enough to ship a complete rail. Full content
authorship is Ken's call, same as the Genesis 1–12/Matthew 1–7 curriculum content flagged
elsewhere in this project as something not to fabricate.

**Wave 5 — Teach mode toggle.** Bounded engineering, no new schema strictly needed — a client-side
reordering/subset rule over the existing `TEACHING_SECTION_KINDS`, mapped to "for me" vs. "for the
room" per the mockup's two assemblies. Conviction-section content never appears in "for the room"
output unless explicitly promoted — same rule as the existing export/sharing boundary.
