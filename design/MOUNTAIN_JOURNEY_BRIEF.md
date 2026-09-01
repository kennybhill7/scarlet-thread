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

## Mood reference (Ken, 2026-09-01)

Two AI-generated reference clips are in `design/reference/mood/` (`journey-canyon-variant.mp4`,
`journey-desert-crosses-variant.mp4`, ~10 s / 1280×720 each), with compressed key-frame stills
from both in `design/reference/mood/stills/`. **These are the actual visual target for "realistic
mountain" and "cinematic journey"** — treat them as closer to ground truth than any word in this
brief. Both share the same opening and closing beat and differ in the middle:

1. **Opening (both clips)** — an aerial dawn shot over a real mountain range: snow-capped peaks,
   a rising sun, layered clouds, mist in the valley. The scarlet thread runs through the valley
   floor as a glowing red river/road, winding past a lake and tree line toward the peaks.
   (`stills/01-dawn-valley-thread-as-river.jpg`)
2. **Middle, canyon variant** — flying low along a canyon rim in stormy light; the thread runs
   along the cliff edge as a woven red rope/road, canyon dropping away on one side.
   (`stills/02-canyon-cliff-thread-as-road.jpg`)
3. **Middle, desert/crosses variant** — a robed figure at a lit tent under a night sky thick with
   stars, the thread as a thick woven rope leading out across the dunes from his feet.
   (`stills/03-desert-tent-thread-as-rope.jpg`) Then a rocky peak under a dark, breaking sky with
   three crosses at the summit, the thread winding up the rock face to meet them.
   (`stills/04-three-crosses-thread-ascending.jpg`)
4. **Closing (both clips)** — a lone robed figure stands on a rock outcropping above a sea of
   clouds, the thread continuing from their feet up into the sky to a glowing golden city on the
   clouds — towers, spires, light pouring from within. (`stills/05-heavenly-city-journeys-end.jpg`)

Notice what stays constant across every shot: **the thread is never a thin drawn line.** It's
always a thick, dimensional, woven/braided rope with real material presence — texture, shadow,
sheen — laid ONTO the terrain like a physical road, not overlaid on top of it like a chart
annotation. That's the single most important visual takeaway for translating this to the
Mountain: whatever ships needs that same sense of the thread as a real object resting on real
ground, at every one of the 11 stages, not just in establishing shots.

These are mood/tone reference, not a literal storyboard to reproduce beat-for-beat — there's no
video pipeline in this app's stack (see "Constraints" below), and the app's real structure is 11
fixed stages with mirror pairings, not an open-ended cinematic flythrough. The job for Claude
Design is translating this FEELING (realistic terrain, the thread as a physical road, dramatic
directional light, a sense of real distance and elevation) into something that can render as
SVG/CSS at 11 fixed waypoints.

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

## Status (2026-09-01) — first Claude Design round-trip, decisions ratified

Claude Design's first pass is in `design/scarlet-thread-app/` — `The Climb.dc.html` (a working
11-stage interactive prototype), `Scarlet Thread App.dc.html` (a full 14-section app-wide redesign
proposal), `Mountain Journey Directions.dc.html` (three camera concepts for the terrain redesign),
and `github.md` (its own sync manifest — it already treats this repo as its read/write target).

**Three open questions it asked, now ratified by Ken:**

1. **Peak placement — settled, no change needed.** Gospels stays the peak (stage 6), Creation
   stays the ascent's foot (stage 1). This matches the live `elevationOf()` build already, so
   there's nothing to change in code. See `PROGRESS.md`'s "Decisions locked" table.
2. **Daily vs. weekly surface.** The redesigned Mountain stays the **daily navigation surface** —
   how a learner gets to today's passage every time they open the app, not an occasional overview.
3. **Learner connections on the Mountain.** A learner's own `UserConnection` rows **do** appear on
   this surface, but as a visually distinct layer from the curated thread-as-road — e.g. a thin
   stitched filament in the air above the terrain (the earlier Stitched Thread sketch's ticks),
   never merged into or rendered the same way as the curated road itself. Curated structure is the
   ground everyone walks; a learner's own connection is never ground.

**A real defect found in this round, not yet fixed:** every `.dc.html` scene slot carries a
`placeholder` attribute describing what SHOULD render there. Five of the 11 stage images (01, 05,
06, 09, 11) are the mood-reference stills and fit their captions well. The other six — 02, 03, 04,
07, 08, 10 — do NOT match their own placeholder captions. Worst case: stage 8's placeholder reads
"a merchant city on the water, smoke rising over the harbour" (Babylon, Revelation 1–18) but the
actual image is the identical golden heavenly-city render used for stage 11 (Paradise Restored) —
so the judged false empire and the true eternal city currently look like the same place, which
undercuts the exact contrast the mirror-pair structure exists to teach. **Regenerate all six
mismatched scene images before any of this ships** — 02 (Sin Enters — needs fig leaves/flaming
sword, not a dark ridge), 03 (The Flood — needs an ark/dove/rainbow, not a calm valley), 04 (Babel
— needs a brick tower/scaffolding, not a desert tent), 07 (The Church — needs lamplit houses/a
ship, not a dawn valley), 08 (Babylon — needs a merchant city/smoke, not the paradise city), 10
(Satan Cast Out — needs a key/chain/throne, not a bare ridge).

**Camera direction — not yet picked.** Three options in `Mountain Journey Directions.dc.html`: 1a
The Switchback (valley view, thread as a switchback cut into the face, peak-as-midpoint made
physical), 1b The Traverse (side-on panorama, thread as a horizontal road, both mirror faces
visible at once — cheapest to build, safest), 1c On the Road (first-person, standing on the
thread — most literal "Yellow Brick Road" reading, highest risk). Claude Design's own
recommendation is 1a as the strongest match to the brief, 1b as the fastest to ship. Still open.

---

## What this brief is asking Claude Design for

Not a finished implementation — a real creative direction: what does "realistic mountain, cinematic
Genesis-to-Revelation journey, scarlet thread as the road" actually look like, concretely enough
that an engineer could build toward it. Terrain treatment, how the thread visually behaves as a
path (does it curve, widen, glow, have texture?), how the 11 stages sit on/along it, how "cinematic"
translates to an actual interaction model (scroll-driven? parallax? something else?) — all open,
all real design work, not yet decided by anyone.
