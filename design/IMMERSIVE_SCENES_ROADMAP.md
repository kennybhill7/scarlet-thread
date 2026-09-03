# Immersive scenes — how many, which ones, in what order

**Date:** 2026-09-02
**Status:** Decided. Ken: "go with what u believe is best for us. eventually id like for all of it
to be immersive but baby steps first."

---

## The real cost, stated plainly

One Fable-built immersive scene (the Red Sea crossing — a real WebGL scene: raycast water walls
and fire, a depth-sorted crowd, full 360° drag-to-look, ambient sound) took roughly 1M tokens and
~16 minutes of build time. That's a serious, real cost per scene, not a small add-on — building
all 11 mountain stages this way immediately would be a large, undifferentiated commitment before
a second data point even exists to confirm the cost holds steady or the quality stays high.

## The decision: curated first, full coverage later

**Not all 11 at once. Not a one-off pair either.** A deliberate staged rollout, so immersive scenes
stay special (this project's own `design/scarlet-thread-app/Scarlet Thread - Strategy.md` already
commits to restraint over spectacle elsewhere — no streaks, no badges, things earned rather than
uniform) while still moving toward Ken's real long-term goal: eventually, everything.

### Phase 1 — proof of concept (done)
1. **The Red Sea crossing** (Exodus 14) — built, published, confirmed by Ken live: "works great."
   https://claude.ai/code/artifact/1a330b93-f0c0-4c87-8a64-8b58610417c8
2. **Eden / Creation** — "Eden at First Light," built and published, 2026-09-03.
   https://claude.ai/code/artifact/1b3c323d-83c2-49cd-8ebc-aed9cde85743 — WebGL2, raymarched
   terrain/water/mist, a river forking into four (Gen 2:10), no human figures (matches the
   Image Commission doc's existing Creation scene brief), real animal life (deer, herons, birds)
   moving without fear, synthesized soundscape. Claude verified directly (not just the build
   report): the scene genuinely renders — real terrain/water/tree detail visible even under
   software rendering in a local check — and the two central trees read as visibly different
   without either looking ominous, matching the "before the Fall, no foreshadowing" brief. One
   minor finding from that check: a text-encoding glitch (a stray "Â" before "·" in the entry
   veil) in the raw source file, traced to a missing charset declaration — likely not present in
   the actual published page (Claude's publish pipeline adds this automatically) but not
   independently confirmed on the live URL; worth Ken checking directly.

Phase 1 complete. Both pieces of the "narrative skeleton" pair Phase 2 was meant to extend
(beginning + deliverance) are now real and Ken-reachable. Decide when ready whether to proceed to
Phase 2 (Sinai, the empty tomb at dawn).

### Phase 2 — the next two, forming a four-point skeleton of the whole story
3. **Sinai** — the mountain wrapped in cloud, smoke and fire, the camp below. Already described in
   the Image Commission's site-vista list (#7, "Horeb · Sinai"). Dramatic, iconic, and safe to
   render fully — no depiction of any figure's face required, no sensitive content.
4. **The empty tomb at dawn** — not the crucifixion itself. This project already avoids depicting
   the crucifixion literally (the existing "06 Gospels — the summit" scene brief deliberately shows
   no figures, no cross, no symbols — light breaking through at the peak instead) and separately
   commits to never depicting Jesus's face. The Resurrection morning — the stone rolled away, dawn
   light, the garden — is the true climax of the whole mountain ("the only one where the light
   fully wins," per that same brief) and can be built immersively without crossing either of those
   lines: an empty, quiet garden at first light is not a depiction of a person at all.

With these four (Eden, Red Sea, Sinai, the empty tomb), the whole arc has a real skeleton:
beginning, deliverance, covenant, resurrection — before any decision is made about filling in the
rest.

### Phase 3 — the closing pair, once Phase 2 confirms the cost/quality holds
5. **Babylon burning** (Revelation 17-18) — already vividly described in the Image Commission
   (fire, smoke, a burning city) and in the Grok reference images Ken shared directly. No figures
   needed at the scale this reads at.
6. **The New Jerusalem** — the actual ending bookend, mirroring Eden. The Image Commission's own
   Style B section already flags this as special ("the last thing a reader unlocks... worth
   spending real effort on") — worth being the SAME kind of special in the immersive register, not
   just a static gold-leaf map illustration.

### Phase 4 and beyond — the rest, over time
Everything else (Babel, the Church's spreading roads, Satan Cast Out, Paradise Restored's full
scene, and eventually the 40 site vistas too) moves to immersive treatment gradually, phase by
phase, as budget and validated quality allow — not committed to a fixed order yet. This is the
literal path to Ken's stated "eventually id like for all of it to be immersive."

## What stays static in the meantime

Every stage and site vista not yet in an immersive phase still gets the photoreal Style A image
already commissioned (`design/scarlet-thread-app/Scarlet Thread - Image Commission.md`) — nothing
is blocked waiting on the immersive rollout. The two tracks run in parallel: images ship on their
own timeline (ChatGPT/Codex generating now), immersive scenes ship in the phased order above.

## Why this order and not another

Mirror pairs (Babel/Babylon, Flood/World Judged, Sin Enters/Satan Cast Out) were the structural
reason the Mountain got rebuilt as stacked plates in the first place — same altitude, same plate,
by construction. It would be reasonable to eventually pair-build immersive mirror scenes together
the way `MOUNTAINPLATES-001` paired their art. That's a Phase 4+ decision, not made here — Phase
1-3 above prioritizes narrative skeleton (beginning / deliverance / covenant / resurrection / final
judgment / restoration) over mirror-pair symmetry, because that skeleton is what proves the
technique across the widest possible emotional range (calm wonder, crisis, awe, reverence, dread,
hope) before deciding how the remaining pairs get sequenced.
