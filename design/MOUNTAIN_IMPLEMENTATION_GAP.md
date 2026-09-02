# The built Mountain doesn't match what Claude Design showed Ken — here's the real gap

**Date:** 2026-09-02
**Status:** Real, confirmed problem. Not a polish pass — a medium mismatch that needs a design
decision before anyone writes more code.

---

## What Ken said

> looks like crap. doesnt look like what claude design created.

Confirmed by actually rendering the shipped component and looking at it (not just trusting the
code or a text description of it) — a real screenshot, described plainly below. He's right, and
the reason is structural, not a bug to fix with more polish on the current approach.

---

## What Claude Design actually produced

Real, photographic/painterly, AI-generated mountain imagery — a full aerial dawn shot with
snow-capped peaks, layered atmospheric haze, a rising sun, dramatic directional light, real
terrain texture, a thick woven-rope road laid physically onto that terrain. See
`design/scarlet-thread-app/assets/climb-vista.png` (the full 11-stage panorama) and
`design/reference/mood/stills/*.jpg` (the original mood reference — real cinematic AI video
stills). This is what Ken has been looking at throughout this whole design process and the
standard he's judging the app against.

## What actually got built (`MOUNTAINSWITCHBACK-001`, `web/components/climb/MountainScene.tsx`)

A flat, minimalist, hand-coded SVG vector diagram: solid-color polygon shapes for "ridges" (three
flat depth layers, `--shell-surface-hi`/`--shell-border`/`--shell-border-hi` — real shell tokens,
but they're plain flat fills, not a rendered landscape), a bold flat-red sine-wave path for the
road, plain circles for waypoints. Rendered and screenshotted for real just now to confirm — it
looks like a clean, competently-built line diagram. It does not look like a mountain in any
photographic or painterly sense. No amount of tuning opacity/color values on this approach closes
that gap — vector shapes drawn from geometry math and photographic/painterly AI-rendered imagery
are two different mediums, and the code did exactly what its own task brief asked for ("no image
assets, no canvas, no video... gradients, not photos").

**That constraint was mine, not Ken's, and it was wrong for what he actually wanted.** He was
never shown a vector-diagram mockup and asked to approve it — he was shown Claude Design's
photorealistic panorama and asked which CAMERA ANGLE he liked (1a, the Switchback). The camera
angle got built faithfully. The visual medium underneath it did not match what he'd actually seen
and approved.

---

## The real options, so Design can propose against real constraints instead of a blank page

This app is a Next.js/React web app with no canvas/WebGL pipeline and no video asset pipeline
today (`web/app/globals.css` is the whole styling system; the reader/workspace/shell all run on
plain CSS + SVG). Whatever ships has to be one of:

1. **Real static image assets.** Claude Design already generated `climb-vista.png` and 11
   individual scene images for the stage-scene concept in `The Climb.dc.html` (see
   `design/scarlet-thread-app/assets/`) — those ARE the photographic quality Ken wants, already
   made, already sitting in this repo. The open question is whether the SAME kind of asset can
   work for the interactive, scroll-driven, proportionally-spaced Switchback view specifically
   (not just a static panorama) — e.g., one tall, wide background image the switchback road and
   waypoints are laid on top of, rather than everything hand-drawn in SVG. Real image assets have
   a real cost (page weight; can't be procedurally reflowed if a waypoint's real chapter count
   changes the layout without breaking the art) that needs a real answer, not an assumption.
   **This is the direction I'd bet on**, but it's not mine to decide.
2. **CSS/SVG filters and textures that approximate a painted look** instead of flat fills — real
   effort, no guarantee it closes the gap between "competent vector illustration" and "the thing
   Claude Design showed you," and no one on the code side has evaluated whether that's even
   achievable in this stack before building it.
3. **Accept the vector-diagram medium and redesign it as its own honest visual language** (like a
   good wayfinding map or a stylized game-world map) rather than trying to approximate photographic
   mountains — a real, legitimate direction, just a different one than what Ken has been shown and
   has said yes to so far.

None of these is picked. That's the actual ask below.

---

## What's needed from Claude Design

A real answer to: **given this is a live Next.js/React/SVG web app with no canvas or video
pipeline, and given the interactive requirements already locked in — proportional switchback
spacing from real chapter-count data, waypoints that move/resize based on real study data, mirror
pairs, scroll-driven reveal, a `prefers-reduced-motion` fallback — what does "the Switchback" (1a)
actually look like well enough to be built, and in which of the three directions above (or a
fourth)?**

Concretely useful outputs, in order of how directly they unblock real building:

- A mockup of the Switchback camera angle specifically (not the static panorama — the actual
  scroll-through, ascend-then-descend interaction) at whatever fidelity actually answers the
  medium question above. If it's real static imagery, real exported assets scoped for a phone-sane
  page weight, not just a preview render.
- If real images are the answer: are they meant to be a small number of large background plates
  (e.g., one per elevation band) with the road/waypoints drawn on top, or something else? The code
  needs to know what it's laying interactive elements ONTO.
- Explicit sign-off (or correction) on which of the three directions above Claude Design thinks is
  actually achievable and worth building, given the real constraints in this section — not a
  fourth beautiful direction that assumes a rendering pipeline this app doesn't have.

## What's NOT being asked for

Not a request to redo the whole Mountain concept from scratch — the structure (11 real stages,
proportional switchback spacing, mirror-pair altitude matching, the peak as midpoint, motion
gated behind reduced-motion) is sound, tested, and stays. This is specifically about the visual
medium/fidelity gap between what was shown and approved versus what a plain SVG implementation of
that same structure can actually achieve.
