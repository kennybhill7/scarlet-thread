import type { GraphEdgeRow } from "@/lib/db/graphEdges";
import { buildArcsForEdges, chapterQueryValue, type StoryMapBaseline } from "@/lib/map/storyMapLayout";
import { ChapterBaseline } from "./ChapterBaseline";
import styles from "./StoryMap.module.css";

export interface StoryMapSelection {
  book: number;
  chapter: number;
  label: string;
}

export interface StoryMapOverviewMeta {
  minVotes: number;
  limit: number;
  shown: number;
}

export interface StoryMapProps {
  baseline: StoryMapBaseline;
  edges: readonly GraphEdgeRow[];
  mode: "overview" | "chapter";
  selected: StoryMapSelection | null;
  overviewMeta: StoryMapOverviewMeta | null;
  /** True when `?c=` was present but did not resolve to a real chapter — a
   * stale bookmark or a hand-edited URL, not a genuine chapter choice. */
  invalidSelection: boolean;
}

/** Where the baseline itself sits, and how much headroom above it the tallest
 * arc gets — both in the same "verse unit" x-axis the baseline uses, kept
 * here (not in the pure lib) because this is a rendering choice, not layout
 * math: `lib/map/storyMapLayout.ts`'s `ARC_MAX_HEIGHT` is tuned against this
 * exact value so the tallest possible arc (Genesis 1 <-> Revelation 22) still
 * fits inside the viewBox with real headroom to spare. */
export const BASELINE_Y = 280;
const BOTTOM_PADDING = 40;
export const VIEW_HEIGHT = BASELINE_Y + BOTTOM_PADDING;

/**
 * STORYMAP-001 — the Story Map: a full-canon cross-reference arc diagram,
 * same idea as the classic Chris Harrison/Christoph Romhild Bible
 * visualization, entirely this app's own rendering of its own
 * GRAPHEDGES-001 data (341,223 real, CC BY 4.0 cross-references) — see
 * `app/(app)/map/page.tsx`'s header for why Harrison's actual copyrighted
 * image is never copied here.
 *
 * HOOKLESS, ZERO CLIENT JAVASCRIPT: both views below — the OVERVIEW (only
 * the highest-confidence edges, vote-ordered, real LIMIT) and CHAPTER FOCUS
 * (one chapter's real ~287-edge average, no vote filter) — run through this
 * exact same component. There is no client/server fork in the rendering
 * logic: `mode` only changes which real, already-server-filtered `edges`
 * this component was handed and what copy/back-link it shows around them,
 * never how an arc or a chapter segment is drawn. Chapter selection
 * (ChapterBaseline's SVG `<a>` links, and the "Jump to chapter" `<select>`
 * below) is ordinary navigation to `/map?c=<book>.<chapter>` — a real GET
 * request the Server Component page answers with a fresh, small,
 * chapter-scoped query, never a client-side re-filter of a blob already sent
 * down. The "Jump to chapter" control below is a plain native `<form
 * method="get">` + `<select>` + a visible "Go" button — real, working
 * navigation with JavaScript fully disabled, no `onChange` auto-submit or any
 * other client-side enhancement layered on top.
 *
 * MOTION: this component adds no JavaScript-driven animation anywhere (no
 * scroll listener, no rAF, no client component boundary at all) — unlike
 * Mountain.tsx/OpeningSequence.tsx, there is no motion here for a
 * `prefers-reduced-motion` JS guard to gate. The one purely-decorative CSS
 * transition this file's own module.css adds (arc hover opacity) is already
 * fully covered by `app/globals.css`'s existing blanket
 * `@media (prefers-reduced-motion: reduce)` rule (forces every
 * `transition-duration`/`animation-duration` to near-zero, `*`-scoped) — see
 * StoryMap.module.css's own comment at that rule for why a second, bespoke
 * two-guarantee JS pattern (Mountain.module.css's `--mountain-progress`
 * pattern) would be pure duplication with nothing to guard here.
 *
 * MOBILE: the SVG below is one responsive `viewBox` (real, not approximate —
 * `baseline.totalWidth` verse-units wide) rather than a second, differently
 * laid-out mobile assembly the way Mountain.tsx's plates/desktop split is.
 * The reasoning (see this task's own build report for the fuller version):
 * unlike the Mountain's 11-stage climb, which genuinely reflows into a
 * different SHAPE on a narrow screen (a scrolling vertical column instead of
 * a wide panorama, `lib/climb/plateGeometry.ts`'s own header), the Story
 * Map's one real idea — "all 66 books, one line, arcs across it" — has no
 * honest narrower re-composition: splitting it into a stack would just be a
 * different, un-Harrison-like diagram. So `.scroller`'s CSS gives the SVG a
 * real minimum pixel width on narrow viewports and lets the wrapper scroll
 * horizontally instead of squeezing 1,189 chapters into 400px of
 * unreadable slivers — a genuine, considered choice, not an afterthought
 * (see StoryMap.module.css's `.scroller`/`.svg` rules).
 */
export function StoryMap({ baseline, edges, mode, selected, overviewMeta, invalidSelection }: StoryMapProps) {
  const arcs = buildArcsForEdges(edges, baseline, { baselineY: BASELINE_Y });
  const viewWidth = baseline.totalWidth;

  const subhead =
    mode === "chapter" && selected
      ? `${selected.label} — all ${edges.length.toLocaleString()} of its real cross-references, unfiltered by vote count.`
      : overviewMeta
        ? `Showing the ${overviewMeta.shown.toLocaleString()} highest-confidence connections (≥${overviewMeta.minVotes} community votes), out of 341,223 real, CC BY 4.0 cross-references.`
        : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Scarlet Thread</p>
        <h1 className={styles.title}>The Story Map</h1>
        {subhead ? <p className={styles.sub}>{subhead}</p> : null}
        {invalidSelection ? (
          <p className={styles.notice} role="status">
            That chapter link didn&apos;t resolve to a real chapter — showing the overview instead.
          </p>
        ) : null}
      </div>

      <div className={styles.controls}>
        {mode === "chapter" ? (
          <a href="/map" className={styles.backLink} data-tap>
            ← Back to overview
          </a>
        ) : null}

        <form action="/map" method="get" className={styles.jumpForm}>
          <label htmlFor="story-map-jump" className={styles.jumpLabel}>
            Jump to chapter
          </label>
          <select
            id="story-map-jump"
            name="c"
            defaultValue={selected ? chapterQueryValue(selected.book, selected.chapter) : ""}
            className={styles.jumpSelect}
          >
            <option value="">— overview —</option>
            {baseline.books.map((book) => (
              <optgroup key={book.book} label={book.name}>
                {baseline.chapters
                  .filter((c) => c.book === book.book)
                  .map((c) => (
                    <option key={`${c.book}.${c.chapter}`} value={chapterQueryValue(c.book, c.chapter)}>
                      {book.name} {c.chapter}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button type="submit" className={styles.jumpButton} data-tap>
            Go
          </button>
        </form>
      </div>

      <div className={styles.scroller}>
        <svg
          viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className={styles.svg}
          role="img"
          aria-label={
            mode === "chapter" && selected
              ? `Cross-reference arcs for ${selected.label}`
              : "Cross-reference arcs across the whole canon, Genesis to Revelation"
          }
        >
          <g className={styles.arcs}>
            {arcs.map((arc) => (
              <path
                key={arc.id}
                d={arc.d}
                className={arc.evidenceLabel === "strong" ? `${styles.arc} ${styles.arcStrong}` : styles.arc}
              />
            ))}
          </g>
          <ChapterBaseline baseline={baseline} baselineY={BASELINE_Y} selected={selected} />
        </svg>
      </div>

      <p className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchStrong}`} aria-hidden="true" /> strong (≥50
          votes)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} aria-hidden="true" /> plausible (1-49 votes)
        </span>
      </p>
    </div>
  );
}
