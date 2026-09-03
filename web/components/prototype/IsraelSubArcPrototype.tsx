"use client";

import { useState, type CSSProperties } from "react";

import { Sheet } from "@/components/ui/Sheet";
import { ISRAEL_SUB_ARC_PHASES, phaseBySlug } from "@/lib/prototype/israel-sub-arc";

import { IsraelSubArcDetail } from "./IsraelSubArcDetail";
import { IsraelSubArcRidge } from "./IsraelSubArcRidge";

const wrapStyle: CSSProperties = {
  padding: "0 var(--pad-page) calc(24px + var(--safe-bottom))",
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  fontSize: 22,
  color: "var(--shell-text)",
  margin: "8px 0 4px",
};

const subheadStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--shell-muted-2)",
  margin: "0 0 8px",
};

/**
 * ISRAELPROTO-001 → ISRAELFILTER-001 — the stateful shell for the Israel
 * sub-arc view. Holds exactly one piece of state (which phase, if any, is
 * tapped in) and nothing else — no fetch, no vault write. See
 * `lib/prototype/israel-sub-arc.ts` for the real data this now reads.
 *
 * TWO ENTRY POINTS, ONE COMPONENT: this renders directly on the page at
 * `app/(app)/prototype/israel-sub-arc/page.tsx` (a standalone, type-the-URL
 * QA surface — see that page's own header), AND is embedded inside
 * `Mountain.tsx`'s own `Sheet` as the real production entry point: tapping
 * the Mountain's stage-5 ("Israel") waypoint opens a sheet whose body is
 * this same component, instead of jumping straight to the chapter reader
 * the way every other stage's waypoint still does. Both call sites get
 * identical behavior for free because there is exactly one component, not
 * two copies that could drift.
 *
 * INTERACTION MODEL: tapping (or Enter/Space-activating) a point on the
 * ridge opens `Sheet` — the SAME bottom-sheet component this app already
 * uses for the version switcher and thread picker (`components/ui/Sheet.tsx`)
 * — over the phase's name, real chapter range, and its real chapters (each
 * a working link into the reader). Closing it (the sheet's own × button,
 * Escape, a backdrop click, or the detail's own "Back to the arc" button)
 * returns to the ridge with nothing else changed. This reuses the app's own
 * existing "drill into a small choice, then back out" convention rather
 * than inventing a new modal pattern, and keeps the ridge itself always
 * visible underneath (never replaced by a separate screen) — the thing Ken
 * specifically flagged as the riskiest UX bet in the whole redesign, and
 * has not yet clicked through in its real-data, real-navigation form.
 */
export function IsraelSubArcPrototype() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selectedPhase = selectedSlug ? (phaseBySlug(selectedSlug) ?? null) : null;

  function close() {
    setSelectedSlug(null);
  }

  return (
    <div style={wrapStyle}>
      <h1 style={headingStyle}>Israel — six phases</h1>
      <p style={subheadStyle}>Genesis 12 through Malachi, broken into a sub-arc. Tap a point to read its chapters.</p>
      <IsraelSubArcRidge phases={ISRAEL_SUB_ARC_PHASES} selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
      <Sheet open={selectedPhase !== null} onClose={close} title={selectedPhase?.name ?? "Phase"}>
        <IsraelSubArcDetail phase={selectedPhase} onBack={close} />
      </Sheet>
    </div>
  );
}
