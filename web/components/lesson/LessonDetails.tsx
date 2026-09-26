import type { CSSProperties } from "react";

import { LessonProse } from "./LessonProse";

/**
 * LESSONRENDER-001 — a COLLAPSED-by-default disclosure ("go deeper") around
 * one lesson section's prose. Native `<details>`: no state, no effects, works
 * without JavaScript and under `renderToStaticMarkup`. The summary row sits on
 * the app's dark SHELL surface like every other workspace row; the prose card
 * inside it uses the reading (PAGE) surface via {@link LessonProse}.
 */

const detailsStyle: CSSProperties = {
  border: "1px solid var(--shell-border)",
  borderRadius: 8,
  margin: "0 0 12px",
  background: "var(--shell-surface)",
  color: "var(--shell-text)",
};

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  minHeight: 44,
  display: "list-item",
  listStylePosition: "inside",
  padding: "12px",
  lineHeight: "20px",
  fontFamily: "var(--font-label)",
  fontWeight: 600,
  fontSize: 14,
  letterSpacing: "0.02em",
};

const bodyStyle: CSSProperties = { padding: "0 8px 8px" };

export interface LessonDetailsProps {
  /** The always-visible summary line (learner-voice, e.g. "How this passage is built"). */
  summary: string;
  /** The lesson section's Markdown, rendered inside via `LessonProse`. */
  markdown: string;
  testId?: string;
}

/** Renders nothing when `markdown` has no content. */
export function LessonDetails({ summary, markdown, testId }: LessonDetailsProps) {
  if (markdown.trim().length === 0) return null;
  return (
    <details data-testid={testId} style={detailsStyle}>
      <summary style={summaryStyle}>{summary}</summary>
      <div style={bodyStyle}>
        <LessonProse markdown={markdown} />
      </div>
    </details>
  );
}
