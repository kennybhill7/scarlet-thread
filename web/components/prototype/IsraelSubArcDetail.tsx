import Link from "next/link";
import type { CSSProperties } from "react";

import { passageHref, passageLabel, type IsraelSubArcPhase } from "@/lib/prototype/israel-sub-arc";

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
  margin: "0 0 16px",
};

const chapterListStyle: CSSProperties = {
  margin: "0 0 18px",
  padding: 0,
  listStyle: "none",
};

const chapterItemStyle: CSSProperties = {
  margin: "0 0 14px",
};

const chapterTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--shell-text)",
  margin: "0 0 6px",
};

const passageRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px 8px",
};

const passageLinkStyle: CSSProperties = {
  fontSize: 12.5,
  fontFamily: "var(--font-narrow)",
  color: "var(--shell-crimson-text)",
  textDecoration: "none",
  border: "1px solid var(--shell-border-hi)",
  borderRadius: "var(--r-md)",
  padding: "4px 8px",
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
 * The content of one tapped-in phase — name, real chapter range, and every
 * real STORY_SPINE chapter in the phase (title + its passages, each passage
 * a real, working link into the chapter reader via `passageHref`). Replaces
 * ISRAELPROTO-001's static "would live here" placeholder now that
 * ISRAELFILTER-001 wires this to STORY_SPINE's real data.
 *
 * Still HOOKLESS ("props in, markup out" — same discipline
 * `IsraelSubArcRidge` and `TeachSection.tsx`'s `TeachOutlinePanel` follow):
 * `next/link`'s `Link` renders a plain `<a>` here, no router hook of its
 * own, so this still renders straight through `react-dom/server`'s
 * `renderToStaticMarkup` in tests/israel-sub-arc.test.ts with no client-only
 * state to work around.
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
      <ol style={chapterListStyle} data-testid="israel-sub-arc-chapters">
        {phase.chapters.map((chapter) => (
          <li key={chapter.id} style={chapterItemStyle}>
            <p style={chapterTitleStyle}>{chapter.title}</p>
            <div style={passageRowStyle}>
              {chapter.passages.map((passage, index) => (
                <Link
                  key={`${chapter.id}-${index}`}
                  href={passageHref(passage)}
                  style={passageLinkStyle}
                  aria-label={`Read ${passageLabel(passage)}, from "${chapter.title}"`}
                >
                  {passageLabel(passage)}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <button type="button" style={backButtonStyle} onClick={onBack} aria-label="Back to the arc">
        ← Back to the arc
      </button>
    </div>
  );
}
