# The opening sequence — globe to Eden

**Date:** 2026-09-02, decided 2026-09-07.
**Status:** SPEC'D, being built. Ken: "build the opening sequence... go in order based on what u
see needs to be done" (2026-09-07) -- explicit delegation to make the remaining open-question
calls directly rather than wait for each one. Decisions below, made accordingly.

---

## The idea, as Ken described it

Start with a globe — something a viewer can turn/handle, not a static image (Ken's own words:
"like a kids body playing with a globe"). Then the camera zooms in: globe → a world map → a
specific place. The place is the Garden of Eden. As the zoom lands, the story begins, with visuals
carrying the reader forward from there — the scarlet thread as the thing the reader "catches" to
connect everything that follows.

The stated goal above the mechanics: connect all the dots of the Bible as one continuous story.
The opening sequence's job is to make that claim felt in thirty seconds, before a single word of
Genesis 1 is read — the whole world, narrowing to one place, one thread, one story, rather than
asserting "it's all connected" as a tagline.

## Why this isn't a random new idea — it reframes something already in motion

`design/scarlet-thread-app/Scarlet Thread - Image Commission.md` (imported today, `79a9779`)
already commissions a hand-drawn pictorial world map (Style B, "the Narnia endpaper look") plus 25
region sheets, originally framed as a navigation layer competing with the photoreal vistas for
attention and budget. This vision gives that same map commission a clear, sequenced JOB instead:
it's the middle beat of the opening zoom (globe -> **this map** -> Eden), not a parallel feature.
That resolves the open scope question from earlier today about whether to build Style B at all —
if the opening sequence is real, the world map earns its place as the second beat of it, not an
optional extra.

## A real technical precedent already exists in Ken's own workspace

`C:\Users\kenny\OneDrive\Apps\Accountrix_JobMap.html` (unrelated project — a Leaflet job-site map
for Ken's construction-CFO work) is a working, real example of exactly the "globe/map you can zoom
into" interaction pattern, built and running today. Different library, different aesthetic
entirely (satellite tiles vs. hand-painted parchment), but it proves the zoom-through-scales
interaction Ken is describing is not a hypothetical — it's a pattern that already exists and works
in a browser.

## Decisions, 2026-09-07

1. **What is the globe, visually? — DECIDED: an interactive stone/parchment-toned sphere, CSS/SVG,
   not WebGL.** No new 3D asset pipeline exists and none is worth standing up for one sequence —
   the app has zero other WebGL surfaces since the immersive-scenes track paused. A draggable
   sphere built from CSS 3D transforms (rotateX/rotateY on drag, inertia on release) wrapped with a
   texture in the app's own established palette (`--shell-*` stone tones, not a photoreal Earth
   texture, which would fight the hand-drawn-map aesthetic it zooms into next) satisfies "something
   a viewer can turn/handle" without a rendering-technology mismatch between beat 1 (globe) and
   beat 2 (the hand-painted world map). Cheap, real, in-palette.
2. **One-time vs. re-enterable? — DECIDED: first-run, with a manual replay.** Shown automatically
   the first time a user reaches the home screen (gated on a local flag, not account-level — a
   fresh device should see it again), never forced on a returning user. A "Replay the Journey"
   entry in Settings lets anyone (Ken included, for review) re-trigger it on demand. No
   region-jump/re-enterable-per-region mechanic yet — that's real added scope tied to the 25 region
   sheets, which are themselves not commissioned yet (Image Commission phase 2, not started).
3. **Where does the zoom actually end? — DECIDED: the real Mountain, via the real Eden scene
   image.** REOPENED 2026-09-03 after the immersive-scenes pause; now closed the other direction on
   purpose. Sequence: globe -> world map (`design/scarlet-thread-app/assets/map-world.png`,
   Ken-approved) -> zoom into the Eden region of that map -> cut to the real, approved
   `01-creation.png` stage-scene image (full-bleed) -> fade into the real Mountain home page
   (`/`, already showing stage 1 at the same visual position). This is a real app entry point that
   hands off to the real product, not a dead-end cinematic — avoids building and maintaining a
   whole separate static landing experience for one sequence.
4. **Cost/scope — grounded now, not speculative.** With decision 1 (CSS, not WebGL) this is a real
   but bounded build: one new client component with a drag-interaction globe, a scripted zoom
   sequence over two already-approved static images (the world map, scene-01), and a fade into the
   existing home page. No new image commissions needed for this specific sequence — the world map
   and Eden scene both already exist and are approved.

## What this doc is NOT

Not a spec for the 25 region sheets or a re-enterable per-region map browser — that's real,
larger, separate scope (Image Commission phase 2), not part of this build. This doc's decisions
cover the first-run opening sequence only: globe, world map, Eden, home page.
