# MOUNTAINPLATES-001 — built against your section 15 spec, status back to you

**Date:** 2026-09-02
**For:** Claude Design, re: `Scarlet Thread App.dc.html` section 15, "Answering
MOUNTAIN_IMPLEMENTATION_GAP.md"

---

## What's built and merged

The plate-stack + drawn-rope architecture from section 15 is real code now, merged to `master`
(`7d6507d`). Not a mockup — `web/lib/climb/plateGeometry.ts` + `web/components/climb/MountainPlates.tsx`
replace the old procedural SVG terrain entirely (`MountainScene.tsx` is deleted).

**Built exactly to spec, verified against your own numbers, not approximated:**

- Five plates stacked vertically, contiguous, in your order (summit → upper → mid → lower →
  foothills). Each plate's rendered height is now the reflow unit — it scales with the real
  combined `chapterCount` of its member stages, reusing this app's existing chapter-proportional
  spacing formula rather than a new one.
- Read `route.json` directly and cross-checked your own worked example rather than trusting it
  blindly: plate-3-mid's `pts` y-values do land inside that plate's real pixel-height boundary
  (computed from the five JPGs' own committed dimensions — 240/85/85/86/149px at 1531px wide), and
  the stages that fall there are genuinely stage 3 (Flood) and stage 9 (World Judged). Confirmed,
  not assumed. The full band-to-stage mapping this produced: plate-1-summit = stages 5/6/7,
  plate-2-upper = 4/8, plate-3-mid = 3/9, plate-4-lower = 2/10, plate-5-foothills = 1/11 —
  matching the mirror-pair structure already in this app's data model exactly.
- The rope: one SVG spanning the full stacked column, three strokes in your exact order/spec
  (`#4a0c10` shadow at width 11/opacity 0.55/offset (0,3); gradient face at width 8,
  `#f2635c → #e5352f → #a8161c`; `#f7877f` highlight at width 1.5/opacity 0.5/offset (-1,-2)).
  Path isn't your raw `route.json` `d` string used verbatim — it's a Catmull-Rom spline refit
  through your 11 `pts`, remapped so the curve still reflows correctly when a plate's height
  changes (waypoint y stays proportionally placed within its own plate).
- 11 waypoints at your three sizes/states (12px dormant, 15px begun, 22px current + ring + glow),
  each with a real ≥44px tap target, positioned by the same route-derived coordinates, not
  hand-placed pixels.
- `prefers-reduced-motion`: full rope drawn immediately, no reveal animation — same two-guarantee
  pattern (JS never attaches the scroll listener, CSS independently pins the resting state) this
  app already used elsewhere.

**Verified for real before merging** (re-run myself, not just trusted from the builder): clean
typecheck, clean lint, successful production build, and the full test suite —
**1164/1164 passing**, including new tests that mutation-prove the reflow behavior (grow one
stage's chapter count, assert the exact algebraic delta in its plate's height and its waypoint's
position — not a loose "it moved" check).

**Actually looked at it rendered**, not just trusted a description of a screenshot — attached at
`design/scarlet-thread-app/uploads/mountainplates-001-static-harness-screenshot.png`. That's a
static-harness render (`renderToStaticMarkup` + this app's real CSS + a headless, no-popup
screenshot capture — not the live dev server in a real browser), so treat it as a structural proof,
not a final look. What it shows: real photographic mountain terrain (snow, rock texture,
greenery), a rope with genuine dimensional depth (shadow + gradient + highlight, not a flat
line), and waypoint markers in visibly distinct states. The gold "6" numeral badge and the orange
banner visible near the peak are the stand-in art's own old baked-in elements, not anything this
build added.

## What's still open — yours, not this app's code

1. **The terrain-only plate re-render.** Everything above is running on the disclosed stand-in
   crops, which still carry the old baked-in rope/pins from a prior draft (visible in the
   attached screenshot). Your own art brief (section 15, six points) is unchanged and still the
   spec — no code changes needed on this end when the real plates land, since the app reads
   `route.json`, never plate pixels, exactly as you designed it to.
2. **Desktop (≥1100px) composed-panorama assembly wasn't built this pass.** This task was scoped
   to the mobile vertical stack only. Same plate set, same waypoint coordinates, horizontal-drag
   composition per your spec — still to do, whenever it's next in the queue.
3. **Ken hasn't looked at the real running app yet** — only my own static-harness verification so
   far. That's the actual final check, not this document.

Everything else in section 15 — the reflow model, the one-way path-to-waypoint dependency, the
mirror-pair-per-plate reasoning — is built and holding up under real test coverage. If anything
above reads as a misreading of your spec, say so; the source document stays authoritative over
this summary.
