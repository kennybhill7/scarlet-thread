import type { CSSProperties } from "react";

/**
 * CLAIMPANES-001 — shared inline-style constants for every Passage Workspace
 * section file (`components/workspace/*.tsx`). Extracted out of
 * `WorkspaceShell.tsx` (which previously defined all eight sections inline)
 * so the shell and each section file share ONE copy of each style object
 * rather than each new section file re-declaring its own.
 *
 * Still no `.module.css` import, for the exact reason `WorkspaceShell.tsx`'s
 * own header comment already documents: `tests/study-page.test.ts` (frozen,
 * read-only) stubs a fixed, exhaustive list of CSS Modules, and this plain
 * `.ts` file (not a module the bundler needs a loader for) never adds to
 * that list. Values reference this app's existing GLOBAL CSS custom
 * properties (`app/globals.css`), unchanged from what WorkspaceShell.tsx
 * used before this refactor.
 */

export const sectionStyle: CSSProperties = {
  border: "1px solid var(--shell-border)",
  borderRadius: 8,
  marginBottom: 12,
  padding: "4px 14px",
  background: "var(--shell-bg)",
  color: "var(--shell-text)",
};

export const summaryStyle: CSSProperties = {
  cursor: "pointer",
  padding: "10px 0",
  fontFamily: "var(--font-label)",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

export const productNameStyle: CSSProperties = {
  color: "var(--shell-muted-2)",
  fontWeight: 400,
};

export const lockBadgeStyle: CSSProperties = {
  marginLeft: 8,
  color: "var(--gold)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

export const noticeStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--shell-muted-2)",
  borderLeft: "2px solid var(--gold)",
  padding: "4px 10px",
  margin: "0 0 12px",
};

export const placeholderStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--shell-muted)",
  padding: "4px 0 14px",
};

export const bodyStyle: CSSProperties = {
  padding: "0 0 14px",
};
