import type { CSSProperties } from "react";

import { ISRAEL_SUB_ARC_PLACEHOLDER_NOTE, type IsraelSubArcPhase } from "@/lib/prototype/israel-sub-arc";

const kickerStyle: CSSProperties = {
  fontFamily: "var(--font-narrow)",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  fontSize: 11,
  color: "var(--gold)",
  marginBottom: 4,
};

const nameStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  fontSize: 20,
  color: "var(--shell-text)",
  margin: "0 0 4px",
};

const rangeStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--shell-text-2)",
  margin: "0 0 14px",
};

const noteStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--shell-muted-2)",
  borderLeft: "2px solid var(--shell-border-hi)",
  padding: "4px 10px",
  margin: "0 0 18px",
};

const backButtonStyle: CSSProperties = {
  fontFamily: "var(--font-label)",
  fontWeight: 600,
  fontSize: 13,
  color: "var(--shell-text-2)",
  border: "1px solid var(--shell-border-hi)",
  borderRadius: "var(--r-md)",
  padding: "10px 16px",
  background: "transparent",
};

export interface IsraelSubArcDetailProps {
  phase: IsraelSubArcPhase | null;
  onBack: () => void;
}

/**
 * The content of one tapped-in phase — name, real chapter range, and an
 * honest placeholder note (never fabricated verse content). Hookless
 * ("props in, markup out"), same discipline as `IsraelSubArcRidge` and
 * `TeachSection.tsx`'s `TeachOutlinePanel`: rendered directly with
 * controlled props in `tests/israel-sub-arc.test.ts`.
 *
 * `onBack` renders as a second, always-visible "Back to the arc" button —
 * on top of the enclosing `Sheet`'s own × / Escape / backdrop-click close
 * (this app's existing convention for "close a drilled-in small choice,"
 * see `components/ui/Sheet.tsx`) — because this task's spec calls for a
 * CLEAR, OBVIOUS way back out, and a lone corner × is easy to miss on a
 * first click-through. `phase === null` renders nothing: the enclosing
 * `Sheet` is only ever open when a phase is selected, so this is the inert
 * default, not a reachable empty state.
 */
export function IsraelSubArcDetail({ phase, onBack }: IsraelSubArcDetailProps) {
  if (!phase) return null;

  return (
    <div data-testid="israel-sub-arc-detail">
      <p style={kickerStyle}>{phase.peak ? "Peak of the sub-arc" : `Phase ${phase.order} of 6`}</p>
      <h2 style={nameStyle}>{phase.name}</h2>
      <p style={rangeStyle}>{phase.range}</p>
      <p style={noteStyle}>{ISRAEL_SUB_ARC_PLACEHOLDER_NOTE}</p>
      <button type="button" style={backButtonStyle} onClick={onBack} aria-label="Back to the arc">
        ← Back to the arc
      </button>
    </div>
  );
}
