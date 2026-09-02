"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";

import type { RefKey, VersionId } from "@/lib/contracts";
import { useBibleIndex } from "@/lib/bible/useBibleIndex";
import { loadChapter, ScriptureUnavailableError } from "@/lib/bible/loader";
import { chapterKey, formatRef } from "@/lib/bible/reference";
import { getLastRead } from "@/lib/bible/lastRead";
import { VerseColumn } from "@/components/reader/ChapterReader";
import { splitStageLabel, type StageLabel } from "@/lib/mirror/stagePair";
import { ScrollSyncGuard, mirroredScrollTop, type PaneId } from "@/lib/mirror/scrollSync";
import readerStyles from "@/components/reader/ChapterReader.module.css";
import styles from "./MirrorSplitView.module.css";

/**
 * MIRRORSPLIT-001 — the real reading surface for "read a mirror pair in one
 * view... scroll-locked at their matching beats" (Ken's product strategy
 * doc). Server-resolved data only: `app/(app)/mirror/[stageSlug]/page.tsx`
 * (owned) resolves which two stages, and which opening chapter each one
 * starts on, entirely server-side against the `stages` table — this
 * component never trusts a caller-supplied book/chapter, only the two
 * `MirrorPaneStage` props it's handed.
 *
 * REUSE, NOT REIMPLEMENTATION: verse rendering is the real
 * `VerseColumn` exported from `components/reader/ChapterReader.tsx` — the
 * exact function ChapterReader's own primary/parallel columns use, not a
 * second implementation of "how Scripture text looks." `ChapterReader`
 * itself (the default-exported component) is NOT reused directly: it
 * assumes a single full-page route (`useRouter`-driven prev/next chapter
 * navigation, one global day/night toggle written to
 * `document.documentElement.dataset`, one `getLastRead()`/`setLastRead()`
 * "resume reading" slot, one Study-session toolbar wired to one
 * `workspaceId`) — mounting it twice on one screen would double every one
 * of those, including firing `setLastRead()` twice with two different
 * chapters and silently corrupting "resume where I left off" for ordinary
 * linear reading. This component is the "lighter internal reading view"
 * the task anticipated for exactly that reason: it borrows
 * `VerseColumn` (verse rendering + styling), `loadChapter`
 * (lib/bible/loader.ts — the same cache-then-network path, unchanged), and
 * `ChapterReader.module.css`'s own classes (`.column`, `.columnLabel`,
 * `.hint`, `.error` — literally the same stylesheet, not a copy, matching
 * the precedent `components/reader/StudyEntry.tsx` already set for
 * importing that CSS Module from a sibling file), while owning its own
 * page shell, header, and the scroll-sync behaviour ChapterReader has no
 * reason to know about.
 *
 * ASSERTION-LINE DISCIPLINE (docs/decisions/2026-08-18-teaching-not-
 * theology.md): this view renders each stage's own title (already shown
 * elsewhere in the app, e.g. Mountain's hover tooltip) and a plain
 * structural "Mirror pair: X ↔ Y" label. It deliberately never renders
 * `Stage.summary` — that seed field carries Ken's own curated notes on WHY
 * a pair mirrors ("What enters here is removed there, by name."), which is
 * exactly the app-supplied commentary about the connection's meaning the
 * decision doc's assertion line rules out. The two passages are placed
 * side by side and left to speak for themselves; the reader draws the
 * connection, same as everywhere else in this app.
 */

export interface MirrorPaneStage {
  slug: string;
  title: string;
  book: number;
  chapter: number;
}

export interface MirrorSplitViewProps {
  left: MirrorPaneStage;
  right: MirrorPaneStage;
}

type Loaded =
  | { key: string; ok: true; verses: string[] }
  | { key: string; ok: false; message: string };

export function MirrorSplitView({ left, right }: MirrorSplitViewProps) {
  const { index } = useBibleIndex();

  // Read once, at mount, never written back. getLastRead()/setLastRead()
  // (lib/bible/lastRead.ts) is "resume where I left off reading" for the
  // ordinary linear reading flow — a Mirror Split visit borrows the
  // reader's last-picked VERSION so both panes look like the rest of the
  // app, but must never overwrite book/chapter/parallel with either of
  // this screen's two stages, and never calls setLastRead at all. See this
  // component's header comment for why ChapterReader itself (which DOES
  // call setLastRead on every book/chapter change) isn't mounted here.
  const [version] = useState<VersionId>(() => getLastRead().version);

  const leftLabel = splitStageLabel(left.title);
  const rightLabel = splitStageLabel(right.title);
  const leftRef = index ? formatRef(chapterKey(left.book, left.chapter), index.books) : leftLabel.reference;
  const rightRef = index
    ? formatRef(chapterKey(right.book, right.chapter), index.books)
    : rightLabel.reference;

  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const guardRef = useRef<ScrollSyncGuard | null>(null);
  if (guardRef.current == null) {
    guardRef.current = new ScrollSyncGuard();
  }

  // The one place the scroll-sync math (lib/mirror/scrollSync.ts) meets the
  // real DOM. `handleScroll` reads the two panes' live metrics off the
  // refs (not React state — a `scroll` event fires far too often to route
  // through setState/re-render without visible jank) and writes the
  // mirrored position straight onto the other pane's `scrollTop`. The
  // guard is what stops that write's own synthetic `scroll` event from
  // bouncing straight back — see ScrollSyncGuard's own header for the full
  // mechanism.
  function handleScroll(source: PaneId) {
    const guard = guardRef.current;
    if (!guard || guard.shouldIgnore(source)) return;

    const sourceEl = (source === "left" ? leftScrollRef : rightScrollRef).current;
    const targetEl = (source === "left" ? rightScrollRef : leftScrollRef).current;
    if (!sourceEl || !targetEl) return;

    const targetTop = mirroredScrollTop(
      { scrollTop: sourceEl.scrollTop, scrollHeight: sourceEl.scrollHeight, clientHeight: sourceEl.clientHeight },
      { scrollHeight: targetEl.scrollHeight, clientHeight: targetEl.clientHeight },
    );

    guard.arm(source === "left" ? "right" : "left");
    targetEl.scrollTop = targetTop;
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link href="/" className={styles.backLink}>
          ‹ Climb
        </Link>
        <p className={styles.pairLabel}>
          Mirror pair: {leftRef} ↔ {rightRef}
          <span className={styles.versionTag}>{version}</span>
        </p>
      </header>

      <div className={styles.split}>
        <MirrorPane
          book={left.book}
          chapter={left.chapter}
          version={version}
          reference={leftRef}
          label={leftLabel}
          scrollRef={leftScrollRef}
          onScroll={() => handleScroll("left")}
        />
        <MirrorPane
          book={right.book}
          chapter={right.chapter}
          version={version}
          reference={rightRef}
          label={rightLabel}
          scrollRef={rightScrollRef}
          onScroll={() => handleScroll("right")}
        />
      </div>

      <p className={styles.honesty}>
        Scroll position stays in sync as a percentage through each passage — not a verse-for-verse
        match. The text speaks for itself.
      </p>
    </div>
  );
}

interface MirrorPaneProps {
  book: number;
  chapter: number;
  version: VersionId;
  reference: string;
  label: StageLabel;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

function MirrorPane({ book, chapter, version, reference, label, scrollRef, onScroll }: MirrorPaneProps) {
  const key = `${version}:${chapterKey(book, chapter)}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selectedVerse, setSelectedVerse] = useState<RefKey | null>(null);

  // Same load-once-per-key effect shape as ChapterReader.tsx's own primary
  // column (loader.ts, cache-then-network, typed offline error) — not
  // reimplemented differently here on purpose.
  useEffect(() => {
    let cancelled = false;
    loadChapter(version, book, chapter)
      .then((verses) => {
        if (!cancelled) setLoaded({ key, ok: true, verses });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ScriptureUnavailableError
            ? "This chapter isn't downloaded and you're offline."
            : "Couldn't load this chapter.";
        setLoaded({ key, ok: false, message });
      });
    return () => {
      cancelled = true;
    };
  }, [version, book, chapter, key]);

  const verses = loaded?.key === key && loaded.ok ? loaded.verses : null;
  const error = loaded?.key === key && !loaded.ok ? loaded.message : null;
  const isLoading = loaded?.key !== key;
  const rows = useMemo(() => (verses ?? []).map((text, i) => ({ verse: i + 1, text })), [verses]);

  return (
    <div className={readerStyles.column}>
      <p className={readerStyles.columnLabel}>
        {reference}
        {label.short ? ` — ${label.short}` : ""}
      </p>
      <div ref={scrollRef} className={styles.paneScroll} onScroll={onScroll}>
        {isLoading && <p className={readerStyles.hint}>Loading…</p>}
        {error && <p className={readerStyles.error}>{error}</p>}
        {verses && (
          <VerseColumn
            book={book}
            chapter={chapter}
            rows={rows}
            selectedVerse={selectedVerse}
            onSelectVerse={setSelectedVerse}
          />
        )}
      </div>
    </div>
  );
}
