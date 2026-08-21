import { placeholderStyle } from "./styles";

/**
 * CLAIMPANES-001 — the shared "why locked" body treatment for any section
 * whose REAL, write-capable surface must not mount before its own gate is
 * met (as opposed to the six-then-three placeholder sections' permanent
 * "not built yet" copy, which is unrelated to gating). Generalized out of
 * WORKSPACESHELL-001/READGATE-001's `ObserveLocked` (now `ObserveSection.tsx`
 * calls this with its own message) so Context and Theology can reuse the
 * exact same honest-disclosure shape instead of three near-identical
 * components. Never a bare disabled control with no explanation (BUILD_PLAN
 * tenet 1, "enforced in UI state, not honor system").
 */
export function LockedNotice({ testId, message }: { testId: string; message: string }) {
  return (
    <p style={placeholderStyle} data-testid={testId}>
      {message}
    </p>
  );
}
