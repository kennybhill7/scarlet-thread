import type { EpistemicBasis } from "@/lib/contracts/study-v2";
import { covenantsForRef, type CovenantFact, type StageCovenantEntry } from "@/lib/bible/covenants";
import { getTimeline, type ProphetTimelineEntry } from "@/lib/bible/prophetsTimeline";
import styles from "./CovenantTimelineStrip.module.css";

/**
 * COVENANTTIMELINE-001 — Part 3: the covenant rail + timeline rail strip.
 *
 * Hookless — props (or, for the composed `CovenantTimelineStrip`, book and
 * chapter) in, markup out — matching `TeachSection.tsx`'s `TeachOutlinePanel`
 * / `IsraelSubArcRidge`/`IsraelSubArcDetail` precedent, so the whole thing
 * renders and is testable with `react-dom/server`'s `renderToStaticMarkup`
 * with no CSS Module stub needed beyond this file's own.
 *
 * ASSERTION-LINE CHECK (docs/decisions/2026-08-18-teaching-not-theology.md):
 * every string rendered here comes verbatim from `lib/bible/covenants.ts` /
 * `lib/bible/prophetsTimeline.ts`, which are themselves transcriptions of
 * `design/COVENANT_TIMELINE_RESEARCH.md`. Nothing composed in this file
 * asserts what a covenant or a prophet's message MEANS, and neither Obadiah
 * nor Joel's disputed windows are collapsed to a single date. This is cited
 * fact / named-position content (category 2/3 of the assertion line), not
 * adjudicated doctrine (category 4).
 */

// ---------------------------------------------------------------------------
// Confidence display
// ---------------------------------------------------------------------------

const CONFIDENCE_LABELS: Record<EpistemicBasis, string> = {
  text_explicit: "stated directly in the text",
  historical_context: "historical reconstruction",
  inference: "inferred, not directly stated",
  canonical_synthesis: "synthesized across passages",
  tradition: "tradition-dependent",
  prudential_judgment: "prudential judgment",
  personal_reflection: "personal reflection",
};

/** Exported so tests exercise the exact label text the UI renders, not a reimplementation. */
export function confidenceLabel(basis: EpistemicBasis): string {
  return CONFIDENCE_LABELS[basis] ?? basis;
}

const STATUS_LABELS: Record<CovenantFact["status"], string> = {
  instituted: "instituted here",
  in_force: "in force",
  announced_not_instituted: "announced, not yet instituted",
  consummated: "consummated",
};

// ---------------------------------------------------------------------------
// Covenant badge — Part 1
// ---------------------------------------------------------------------------

export interface CovenantBadgeProps {
  entry: StageCovenantEntry;
}

/**
 * Renders the covenant(s) relevant to the current stage. Stage 5 (Israel)
 * carries four facts in real sequence — rendered as an ordered row, never
 * flattened to one badge, per the research doc's own instruction.
 */
export function CovenantBadge({ entry }: CovenantBadgeProps) {
  return (
    <div className={styles.covenantBadge} data-testid="covenant-badge">
      <p className={styles.railLabel}>Covenant</p>
      {entry.stageNote ? <p className={styles.stageNote}>{entry.stageNote}</p> : null}
      {entry.covenants.length > 0 ? (
        <ol className={styles.covenantSequence}>
          {entry.covenants.map((fact, i) => (
            <li key={`${fact.covenant}-${i}`} className={styles.covenantFact}>
              <span className={styles.covenantName}>{fact.covenant}</span>
              <span className={styles.covenantStatus}>{STATUS_LABELS[fact.status]}</span>
              <span className={styles.covenantNote}>{fact.note}</span>
              <span className={styles.confidenceTag}>{confidenceLabel(fact.confidence)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline card — Part 2
// ---------------------------------------------------------------------------

export interface TimelineCardProps {
  entry: ProphetTimelineEntry;
}

export function TimelineCard({ entry }: TimelineCardProps) {
  return (
    <div className={styles.timelineCard} data-testid="timeline-card">
      <p className={styles.railLabel}>Timeline — {entry.bookName}</p>
      <p className={styles.kingdom}>{entry.kingdom}</p>

      {entry.kings.length > 0 ? (
        <p className={styles.kings}>
          <span className={styles.kingsLabel}>King(s):</span> {entry.kings.join("; ")}{" "}
          <span className={styles.confidenceTag}>({confidenceLabel(entry.kingListConfidence)})</span>
        </p>
      ) : null}

      {entry.dateRange ? (
        <p className={styles.dateRange}>
          {entry.dateRange.label}{" "}
          <span className={styles.confidenceTag}>({confidenceLabel(entry.dateRange.confidence)})</span>
        </p>
      ) : null}

      {entry.disputedWindows ? (
        <div className={styles.disputed} data-testid="disputed-windows">
          <p className={styles.disputedHeading}>Genuinely disputed among scholars — no single date is settled:</p>
          <ul className={styles.disputedList}>
            {entry.disputedWindows.map((window) => (
              <li key={window.label} className={styles.disputedWindow}>
                <span className={styles.disputedLabel}>{window.label}</span>
                <span className={styles.disputedRange}>{window.range}</span>
                <span className={styles.disputedBasis}>{window.basis}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={styles.notes}>{entry.notes}</p>
      <p className={styles.attribution}>{entry.attribution}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composed strip — what ChapterReader.tsx actually renders.
// ---------------------------------------------------------------------------

export interface CovenantTimelineStripProps {
  book: number;
  chapter: number;
}

/**
 * Resolves both rails for the given book/chapter and renders whichever
 * apply. Renders nothing at all when neither applies (most of the canon,
 * honestly — see lib/bible/prophetsTimeline.ts's scope boundary) so it never
 * leaves a visible gap in the reader. Stage 6 (the Gospels) is the one stage
 * with covenant data that is deliberately never shown here — see
 * `lib/bible/covenants.ts`'s `hideInReader` flag and its doc comment.
 */
export function CovenantTimelineStrip({ book, chapter }: CovenantTimelineStripProps) {
  const stageEntry = covenantsForRef(book, chapter);
  const showCovenant = stageEntry && !stageEntry.hideInReader;
  const timelineEntry = getTimeline(book);

  if (!showCovenant && !timelineEntry) return null;

  return (
    <div className={styles.strip} data-testid="covenant-timeline-strip">
      {showCovenant ? <CovenantBadge entry={stageEntry} /> : null}
      {timelineEntry ? <TimelineCard entry={timelineEntry} /> : null}
    </div>
  );
}
