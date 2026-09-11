import type { StoryMapBaseline } from "@/lib/map/storyMapLayout";
import { chapterQueryValue } from "@/lib/map/storyMapLayout";
import styles from "./StoryMap.module.css";

export interface ChapterBaselineProps {
  baseline: StoryMapBaseline;
  /** The y-coordinate the baseline itself sits on — same SVG units StoryMap.tsx used to build the arcs. */
  baselineY: number;
  selected: { book: number; chapter: number } | null;
}

/**
 * STORYMAP-001 — the horizontal line itself: all 66 books, all 1,189
 * chapters, real chapter-navigation built in. HOOKLESS ("props in, markup
 * out"), same discipline `components/climb/MountainPlates.tsx` already
 * established — no state of its own, so it renders straight through
 * `react-dom/server`'s `renderToStaticMarkup` for both the app's real tests
 * and this task's own static-harness screenshot verification.
 *
 * Every chapter segment is wrapped in a real SVG `<a>` (valid SVG2, focusable
 * and Enter-activatable in every evergreen browser) pointing at
 * `/map?c=<book>.<chapter>` — real navigation with ZERO client JavaScript:
 * clicking or Enter-ing a segment is an ordinary link click, which
 * `app/(app)/map/page.tsx` (a Server Component) answers by re-querying only
 * that one chapter's real edges (`listGraphEdgesForChapter`), never the
 * 341,223-row overview set. Precise tapping at this density (up to ~176
 * verse-units wide for Psalm 119, down to 2 for Psalm 117) is a genuine,
 * known limitation on a phone screen — StoryMap.tsx's own "Jump to chapter"
 * `<select>` is the primary accessible/mobile path for exact selection; these
 * SVG links are the visual, larger-pointer affordance on top of it, not the
 * only way in.
 */
export function ChapterBaseline({ baseline, baselineY, selected }: ChapterBaselineProps) {
  return (
    <g className={styles.baseline}>
      <line
        x1={0}
        y1={baselineY}
        x2={baseline.totalWidth}
        y2={baselineY}
        className={styles.baselineLine}
        aria-hidden="true"
      />

      {baseline.books.map((book, index) => (
        <rect
          key={`book-${book.book}`}
          x={book.x}
          y={baselineY - 7}
          width={Math.max(book.width, 0.5)}
          height={14}
          className={index % 2 === 0 ? styles.bookTick : `${styles.bookTick} ${styles.bookTickAlt}`}
          aria-hidden="true"
        />
      ))}

      {baseline.chapters.map((chapter) => {
        const isSelected = selected?.book === chapter.book && selected?.chapter === chapter.chapter;
        const book = baseline.books.find((b) => b.book === chapter.book);
        const label = `${book?.name ?? `Book ${chapter.book}`} ${chapter.chapter} — ${chapter.verseCount} verse${chapter.verseCount === 1 ? "" : "s"}`;
        return (
          <a
            key={`${chapter.book}.${chapter.chapter}`}
            href={`/map?c=${chapterQueryValue(chapter.book, chapter.chapter)}`}
            aria-label={label}
            aria-current={isSelected ? "true" : undefined}
          >
            <rect
              x={chapter.x}
              y={baselineY - 3}
              width={Math.max(chapter.width, 0.4)}
              height={6}
              className={isSelected ? `${styles.chapterTick} ${styles.chapterTickSelected}` : styles.chapterTick}
            />
          </a>
        );
      })}
    </g>
  );
}
