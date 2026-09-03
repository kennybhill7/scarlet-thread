# The opening sequence — globe to Eden

**Date:** 2026-09-02
**Status:** Ken's vision, captured raw. Not yet speced, not yet built. For Claude Design to weigh
in on sequencing/feasibility, and for whoever builds it once a direction is chosen.

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

## Open questions

1. **What is the globe, visually?** A literal rotating 3D Earth (photoreal or stylized)? A painted
   globe matching Style B's parchment hand? Something else? Ken's "kid playing with a globe" image
   suggests something tactile/handleable, not a passive establishing shot. Still open.
2. **How much is one-time vs. re-enterable?** A first-run-only cinematic, or something a returning
   reader can re-trigger (e.g. from a "world" tab) to jump to any of the 25 regions later, once
   they exist? Still open.
3. **Where does the zoom actually end? — REOPENED, 2026-09-03.** Briefly answered "an immersive
   scene" on 2026-09-02 after the Red Sea Fable prototype (Ken: "works great"). That's since been
   walked back — after seeing a second Fable scene (Eden), Ken: "im not crazy about the quality.
   lets continue working on the regular version with the pictures." See
   `IMMERSIVE_SCENES_ROADMAP.md`, now paused after Phase 1. Back to open: the zoom most likely
   lands on a static photoreal image (the same track this doc's own §2 already ties the world map
   to) rather than a Fable scene, unless that decision changes again later.
4. **Cost/scope, honestly.** A real 3D or richly-animated globe, a full painted world map, and a
   scripted zoom transition between them is a substantial build on top of everything else already
   in flight (Mountain plates, the 35-chapter Story Spine, 12-79 commissioned images, and now
   potentially multiple Fable-built immersive scenes). Worth being explicit that this is additive
   scope, not a small addition, before committing to it. Still open, and now bigger than when this
   doc was first written — the validated immersive-scene technique makes the *end* of the sequence
   more ambitious, not less.

## What this doc is NOT

Not a spec. Not a commitment to build. Ken described a vision; this records it faithfully with its
real connections to existing work, so the decision (build it, and in what form) can be made with
full context rather than the idea evaporating into chat history.
