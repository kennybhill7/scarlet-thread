"use client";

import { useState, type CSSProperties } from "react";

import { Sheet } from "@/components/ui/Sheet";
import { ISRAEL_SUB_ARC_BANNER, ISRAEL_SUB_ARC_PHASES, phaseBySlug } from "@/lib/prototype/israel-sub-arc";

import { IsraelSubArcDetail } from "./IsraelSubArcDetail";
import { IsraelSubArcRidge } from "./IsraelSubArcRidge";

const wrapStyle: CSSProperties = {
  padding: "0 var(--pad-page) calc(24px + var(--safe-bottom))",
};

const bannerStyle: CSSProperties = {
  margin: "16px 0 20px",
  padding: "12px 14px",
  background: "var(--shell-surface)",
  border: "1px solid var(--shell-crimson)",
  borderRadius: "var(--r-lg)",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--shell-crimson-text)",
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
 * ISRAELPROTO-001 — the stateful shell for the prototype. Holds exactly one
 * piece of state (which phase, if any, is tapped in) and nothing else — no
 * fetch, no vault write, no navigation. See `lib/prototype/israel-sub-arc.ts`
 * for why this exists and what it must not touch.
 *
 * INTERACTION MODEL: tapping (or Enter/Space-activating) a point on the
 * ridge opens `Sheet` — the SAME bottom-sheet component this app already
 * uses for the version switcher and thread picker (`components/ui/Sheet.tsx`)
 * — over the phase's name, real chapter range, and placeholder note. Closing
 * it (the sheet's own × button, Escape, a backdrop click, or the detail's
 * own "Back to the arc" button) returns to the ridge with nothing else
 * changed. This reuses the app's own existing "drill into a small choice,
 * then back out" convention rather than inventing a new modal pattern, and
 * keeps the ridge itself always visible underneath (never replaced by a
 * separate screen) — the thing Ken specifically asked to be able to judge.
 */
export function IsraelSubArcPrototype() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selectedPhase = selectedSlug ? (phaseBySlug(selectedSlug) ?? null) : null;

  function close() {
    setSelectedSlug(null);
  }

  return (
    <div style={wrapStyle}>
      <p role="note" style={bannerStyle} data-testid="israel-sub-arc-banner">
        {ISRAEL_SUB_ARC_BANNER}
      </p>
      <h1 style={headingStyle}>Israel — six phases</h1>
      <p style={subheadStyle}>
        Genesis 12 through Malachi, broken into a sub-arc. Tap a point to see what would live there.
      </p>
      <IsraelSubArcRidge phases={ISRAEL_SUB_ARC_PHASES} selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
      <Sheet open={selectedPhase !== null} onClose={close} title={selectedPhase?.name ?? "Phase"}>
        <IsraelSubArcDetail phase={selectedPhase} onBack={close} />
      </Sheet>
    </div>
  );
}
