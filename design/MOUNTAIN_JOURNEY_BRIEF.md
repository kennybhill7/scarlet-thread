# The Mountain, reimagined — creative brief

**Date:** 2026-08-28
**Status:** Direction-setting only. Nothing here is built. Handed to Claude Design for real visual development.

---

## The vision (Ken, 2026-08-28)

> I want the app to feel as if we're traveling in time from Genesis to Revelation with real
> cinematic feel as we travel through the story, and I want the scarlet thread to take us on our
> journey — like the great yellow brick road feel, but with the scarlet thread.

Three things, distinct from each other and all three real requirements, not one:

1. **A realistic-looking mountain.** Not the abstract line-and-node diagram that exists today
   (see "What exists today" below). Real terrain, depth, atmosphere, light — something that reads
   as an actual mountain a person could imagine climbing, not a chart.
2. **A cinematic sense of time-travel through Scripture.** The journey from Genesis to Revelation
   should *feel* like traveling through the story as it unfolds — not a static infographic glanced
   at once, but something with a sense of motion, distance, and passage as the reader moves through
   it.
3. **The scarlet thread as the road itself.** Not a set of separate lines connecting dots on a
   chart — a single, continuous, visible PATH winding across the terrain, in the spirit of the
   Yellow Brick Road: something the reader is unmistakably *following*. The thread carries the
   reader through the whole story, not just marking individual connections between two points.

These three together are a real reframing of what "the Mountain" is in this app — from a data
visualization into a place.

---

## What exists today (the actual, current implementation)

`web/components/climb/Mountain.tsx` + `Mountain.module.css` — an abstract SVG line chart:

- An 11-stage ridge line (ascent stages 1–6 climbing to a peak, descent stages 6–11 back down),
  each stage a circle sized by how much the learner has written there, positioned by a fixed
  `elevationOf(stage, peak)` formula.
- A translucent gold fill under the ridge line.
- Thin gray dashed lines ("ties") connecting each ascent stage to its structural mirror on the
  descent side (Creation mirrors the Incarnation, etc. — this pairing is real, curated data, not
  invented for the mockup).
- Hovering or focusing a node shows a tooltip; clicking navigates to that stage's first chapter.

This is honest, functional, and entirely built from live data (`db/schema.ts`'s `stages` table:
`slug`, `title`, `stage` number, `side` (ascent/descent), `mirror` (the paired stage's slug),
`chapters` (which book/chapter keys belong to this stage)). **Whatever the new design becomes, it
still needs to be driven by this same real data** — 11 real stages, each with a real title,
chapter range, and (for most) a real mirror pairing. The redesign is a visual and experiential
reframing of the SAME structure, not a replacement of the underlying data model.

Four small direction sketches exploring only ONE piece of this — how a LEARNER'S OWN typed
connection (a `UserConnection` row, separate from the structural mirror-ties above) might render
as a crimson accent — are in this same `design/` folder (`Main.dc.html`, `SoftGlow.dc.html`,
`WovenRibbon.dc.html`, `TravelingPath.dc.html`, `canvas.json`). They're worth a look for the
existing token palette and geometry, but they do NOT reflect the vision above — they're a much
smaller, earlier exploration of a single accent color, built before this brief existed. Superseded
in ambition by everything above; kept for reference, not as a starting point to iterate FROM.

---

## Design system to extend, not replace

Real tokens from `web/app/globals.css`, current as of 2026-08-26 (THEMESYSTEM-001):

- **The shell** ("The Climb" — where the Mountain lives) is **always dark**, regardless of the
  reading-theme preference: `--shell-bg: #0d1420`, `--shell-surface: #131d2e`,
  `--shell-border-hi: #33405a`, `--shell-text: #e8e6e0`, `--shell-muted-2: #8b97ab`.
- `--gold: #e8b465` / `--gold-deep: #d99a58` — currently used for filled/active stage nodes.
- `--crimson` — added by THEMESYSTEM-001 specifically for "crimson marks active thread
  connections" (BUILD_PLAN section 4), but **defined under the PAGE token layer, which follows the
  reading-theme preference (parchment `#a13333` / midnight `#d9615f`), not the shell.** The shell
  is always dark independent of that preference. **This is a real, unresolved bug waiting to
  happen**: using `var(--crimson)` directly in a shell-context component (the Mountain) would make
  the thread's color silently shift whenever the reader changes their READING preference, which is
  supposed to only affect the page/reading surface, never the shell. Whoever builds the real
  version needs to either give the shell its own fixed crimson value, or restructure the token so
  shell consumers get a stable one regardless of reading preference. Flag this to Claude Design
  explicitly — it should not inherit this bug by using `var(--crimson)` as-is.
- Fonts: `--font-display` (Fraunces, serif, headings), `--font-narrow` (Archivo Narrow, labels),
  `--font-ui` (Inter, body/UI).
- Both real themes (parchment and midnight — the reading surface, not the shell) currently pass
  WCAG AA contrast for real body text after THEMESYSTEM-001's fixes. Any new UI text needs to hold
  that same bar; check contrast for real, don't eyeball it (a real WCAG relative-luminance
  calculation, not an approximation — this bit us once already this build).

---

## The real data shape (for whoever builds the final version)

- 11 `stages` rows: `slug`, `title`, `stage` (1–11), `side` (`ascent` | `descent`), `mirror`
  (nullable — the paired stage's slug), `chapters` (array of `book.chapter` keys).
- Per-stage learner activity today: `observationCount`, `questionCount`, `threadCount` (how much
  the learner has actually written there — this is what currently sizes/fills each node, and
  should probably still drive SOME visual weight in the new design, even if the visual language
  changes completely).
- Separately, real `UserConnection` rows (`fromRange`, `toRange`, `type`, `evidenceLabel`,
  `rationale`) are things a learner explicitly typed while comparing two passages — these are
  NOT the same as the structural stage-mirror pairing above. Whether/how these individual learner
  connections should also appear on the new cinematic mountain (as offshoots from the main thread?
  left for a separate, smaller view? something else?) is an open question for Claude Design to
  propose, not something already decided.

---

## Constraints that still apply, whatever the visual direction

- **Curated content is not learner content, ever** (BUILD_PLAN tenet 3). The 11-stage structure
  and its mirror pairings are curated, fixed, the same for every learner. A learner's own
  connections are personal and theirs alone. The visual language should make that distinction
  legible if both ever appear together — they must never look like the same kind of thing.
- **The app teaches method, not doctrine** (`docs/decisions/2026-08-18-teaching-not-theology.md`).
  Nothing in the visual design — captions, labels, any text that ships with it — should assert
  what a passage means. "Cinematic journey through the story" is about pacing and feeling, not
  about the app supplying theological conclusions.
- Real device performance matters — this needs to work on a phone, including a slow one. "Cinematic"
  should not mean "requires a powerful GPU to scroll smoothly."
- Whatever ships still needs to be an SVG/CSS (or comparably lightweight) implementation a
  React/Next.js codebase can actually render — not a video file or a asset pipeline this app's
  stack doesn't have.

---

## What this brief is asking Claude Design for

Not a finished implementation — a real creative direction: what does "realistic mountain, cinematic
Genesis-to-Revelation journey, scarlet thread as the road" actually look like, concretely enough
that an engineer could build toward it. Terrain treatment, how the thread visually behaves as a
path (does it curve, widen, glow, have texture?), how the 11 stages sit on/along it, how "cinematic"
translates to an actual interaction model (scroll-driven? parallax? something else?) — all open,
all real design work, not yet decided by anyone.
