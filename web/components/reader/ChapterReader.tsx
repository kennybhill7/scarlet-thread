"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RefKey, VersionId } from "@/lib/contracts";
import { useBibleIndex } from "@/lib/bible/useBibleIndex";
import { loadChapter, ScriptureUnavailableError } from "@/lib/bible/loader";
import { chapterKey, nextChapter, previousChapter, parseKey, toChapterKey, verseKey } from "@/lib/bible/reference";
import { alignChapter, divergenceNote, VerseMapUnavailableError, type AlignedRow } from "@/lib/bible/versemap";
import { getLastRead, setLastRead } from "@/lib/bible/lastRead";
import { Sheet } from "@/components/ui/Sheet";
import { Chip } from "@/components/ui/Chip";
import { StudySession } from "@/components/notes/StudySession";
import { StudyEntryControl } from "./StudyEntry";
import { CovenantTimelineStrip } from "./CovenantTimelineStrip";
import styles from "./ChapterReader.module.css";

interface ChapterReaderProps {
  book: number;
  chapter: number;
  /**
   * STUDYENTRY-001 — this reader's own workspace id, resolved server-side by
   * `app/(app)/read/[book]/[chapter]/page.tsx` (owned) the same way
   * `app/(app)/study/[sessionId]/page.tsx` resolves it for the composer:
   * from the authenticated session, never from a caller-supplied value. Null
   * when that resolution failed (database unreachable) — `StudyEntryControl`
   * disables itself rather than the whole reader failing.
   */
  workspaceId: string | null;
}

// Each piece of async state carries the request key it resolved for.
// "Loading" is never its own state value — it's derived at render time by
// comparing that key against what's currently requested. Setting a literal
// { status: "loading" } synchronously at the top of an effect body causes a
// cascading render (flagged by react-hooks/set-state-in-effect); comparing
// keys avoids it entirely and is the pattern React's docs recommend.
type Loaded<T> = { key: string; ok: true; value: T } | { key: string; ok: false; message: string };

const SPANISH: VersionId = "SBL";

/**
 * Toggles verse selection. Selecting the already-selected verse again clears
 * it -- selection is optional, chapter-level capture must remain reachable
 * with no verse chosen. Exported so the exact function the reader's onClick
 * invokes is what the test suite exercises, not a reimplementation of it.
 */
export function nextVerseSelection(current: RefKey | null, candidate: RefKey): RefKey | null {
  return current === candidate ? null : candidate;
}

/**
 * CODEX_AUDIT.md A-032 -- the single decision StudySession's `textAvailable`
 * prop is built from: true only once the primary chapter's verses have
 * actually loaded (non-null) and the response was not a genuinely empty
 * array. `null` covers both "still loading" and "load failed" (see the
 * `Loaded<T>` type above -- a failure sets `primary` to an `ok: false`
 * record, so `primaryVerses` itself stays null in that case too). Exported,
 * like nextVerseSelection above, so this exact function is what the test
 * suite exercises.
 */
export function hasLoadedText(verses: string[] | null): boolean {
  return verses !== null && verses.length > 0;
}

/**
 * Resolves one aligned row's Spanish text by its actual mapped reference,
 * never by loop position. Pulled out to a top-level, pure function -- rather
 * than a closure captured over `spanishChapters` state -- for the same
 * testability reason as nextVerseSelection/resolveAlignment above.
 *
 * The returned `text` is `null` ONLY while genuinely still loading (no
 * chapter entry for `toKey`'s chapter yet, or no resolvable verse number).
 * CODEX_AUDIT.md A-028's fix depends on this staying strictly `null`, never
 * `""`: a declared omission (the corpus builder's own convention -- the
 * verse exists but its text is empty/whitespace, see isOmittedVerseText)
 * comes back as `text: ""` once its chapter has actually loaded, so the
 * caller (ChapterReader's parallel-pane render below) can tell "not loaded
 * yet" (`null` -- render nothing, still waiting) apart from "loaded, and
 * this edition declares no text for this verse" (`""` -- render the honest
 * marker). The old code's `if (!text) return null` collapsed both into the
 * same silent nothing.
 */
export function resolveSpanishVerse(
  spanishChapters: Record<string, Loaded<string[]>>,
  toKey: string | null,
): { text: string | null; error: string | null } {
  if (!toKey) return { text: null, error: null };
  const parsedVerse = parseKey(toKey);
  const chapterRef = toChapterKey(toKey);
  const entry = spanishChapters[chapterRef];
  if (!entry) return { text: null, error: null }; // still loading
  if (!entry.ok) return { text: null, error: entry.message };
  const verseNumber = parsedVerse && "verse" in parsedVerse ? parsedVerse.verse : undefined;
  const value = verseNumber ? entry.value[verseNumber - 1] : undefined;
  return { text: value ?? null, error: null };
}

export type AlignmentResult =
  | { ok: true; rows: AlignedRow[] }
  | { ok: false; message: string };

/**
 * Wraps alignChapter() so it can never reject. lib/bible/versemap.ts throws
 * VerseMapUnavailableError on purpose (fail-closed: an identity zip here
 * would silently mispair a genuinely divergent chapter) but ChapterReader's
 * effect used to call alignChapter().then() with no .catch() at all, so that
 * intentional throw became an unhandled promise rejection and the Spanish
 * column hung on "Cargando…" forever instead of the pane being disabled
 * with a reason (VMCACHE-001). Exported so the exact function the reader's
 * effect awaits is what the test suite exercises, not a reimplementation of
 * it -- same pattern as nextVerseSelection above.
 */
export async function resolveAlignment(
  fromVersion: VersionId,
  toVersion: VersionId,
  chapterKeyValue: RefKey,
  fromVerseCount: number,
): Promise<AlignmentResult> {
  try {
    const rows = await alignChapter(fromVersion, toVersion, chapterKeyValue, fromVerseCount);
    return { ok: true, rows };
  } catch (error) {
    const message =
      error instanceof VerseMapUnavailableError
        ? "Parallel Spanish view is unavailable right now — alignment data couldn't be loaded. Try again once you're back online."
        : "Parallel Spanish view is unavailable right now.";
    return { ok: false, message };
  }
}

type VerseRow = { verse: number; text: string };

type VerseColumnProps = {
  book: number;
  chapter: number;
  rows: VerseRow[];
  selectedVerse: RefKey | null;
  onSelectVerse: (next: RefKey | null) => void;
};

/**
 * CODEX_AUDIT.md A-028 -- the corpus builder's own established convention
 * (tools/build_bible.py, proved by tests/corpus.test.ts's `empty` fixture)
 * for "this verse number exists but this edition has no text for it" (known
 * textual omissions like Matthew 17:21, Acts 8:37, or the relocated Romans
 * 16:25-27 doxology's blank Spanish slot) is an empty/whitespace-only string
 * -- never a missing array element. That is DIFFERENT from "not loaded yet",
 * which is represented as the whole verses array (or, in the parallel pane,
 * the whole chapter entry) being absent/null. Exported so both VerseColumn
 * and the parallel pane below share one definition instead of two regexes
 * drifting apart.
 */
export function isOmittedVerseText(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * The visible marker rendered in place of a declared omission's blank text.
 * Deliberately plain, declarative language matching this file's own existing
 * status copy ("This chapter isn't downloaded and you're offline.", "Couldn't
 * load this chapter.") rather than bracketed placeholder-style text -- never
 * invents wording that pretends to be the verse itself.
 */
export const OMITTED_VERSE_TEXT = "Not present in this translation.";

/**
 * Renders one column's verses as selectable controls. Each verse is a real
 * <button>, not a hand-rolled div+role+keydown combo, so Enter/Space
 * activation is guaranteed by the HTML platform itself -- mouse and keyboard
 * both invoke the identical onClick, eliminating an entire class of "works
 * with a mouse but not a keyboard" bug by construction. Selection always
 * keys off the canonical book.chapter.verse RefKey computed from the row's
 * own verse number, never the array position, so it stays correct even where
 * a parallel pane's alignment diverges (this column never renders that pane).
 *
 * CODEX_AUDIT.md A-028 -- a row whose text is a declared omission (see
 * isOmittedVerseText above) renders OMITTED_VERSE_TEXT instead of raw
 * {row.text}, so the verse number is never left with silently nothing after
 * it.
 */
export function VerseColumn({ book, chapter, rows, selectedVerse, onSelectVerse }: VerseColumnProps) {
  return (
    <>
      {rows.map((row) => {
        const refKey = verseKey(book, chapter, row.verse);
        const selected = refKey === selectedVerse;
        const omitted = isOmittedVerseText(row.text);
        return (
          <button
            key={row.verse}
            type="button"
            className={styles.verse}
            aria-pressed={selected}
            data-verse-key={refKey}
            onClick={() => onSelectVerse(nextVerseSelection(selectedVerse, refKey))}
          >
            <sup className={styles.vnum}>{row.verse}</sup>
            {omitted ? <span className={styles.omitted}>{OMITTED_VERSE_TEXT}</span> : row.text}
          </button>
        );
      })}
    </>
  );
}

export function ChapterReader({ book, chapter, workspaceId }: ChapterReaderProps) {
  const router = useRouter();
  const { index } = useBibleIndex();
  const [version, setVersion] = useState<VersionId>(() => getLastRead().version);
  const [parallel, setParallel] = useState(() => getLastRead().parallel);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [night, setNight] = useState(false);

  const [primary, setPrimary] = useState<Loaded<string[]> | null>(null);
  // Keyed by Spanish CHAPTER RefKey, not by the English chapter being viewed.
  // Romans 14/16 aligns some verses across a chapter boundary (see
  // lib/bible/versemap.ts) -- rendering by loop index into a single fetched
  // chapter silently ignored that boundary (CODEX_AUDIT.md A-006). Every
  // chapter an aligned row's `toKey` points into gets loaded here.
  const [spanishChapters, setSpanishChapters] = useState<Record<string, Loaded<string[]>>>({});
  const [aligned, setAligned] = useState<{ key: string; rows: AlignedRow[] } | null>(null);
  // Set only when resolveAlignment() fails closed (VerseMapUnavailableError
  // or otherwise) -- carries the request key it resolved for, same pattern
  // as the other async state here, so a failure from a chapter the reader
  // has since navigated away from can never paint the wrong chapter's pane.
  const [alignmentError, setAlignmentError] = useState<{ key: string; message: string } | null>(null);
  const [note, setNote] = useState<{ key: string; text: string | null } | null>(null);
  // Carries the chapter key it was picked in, same pattern as the async
  // state above -- a verse chosen in one chapter must never leak into a
  // capture for a different one once the reader navigates away, and
  // deriving that at render time (rather than clearing it with a synchronous
  // setState-in-effect) avoids the cascading-render footgun those states are
  // already written to avoid.
  const [verseSelection, setVerseSelection] = useState<{ key: string; verse: RefKey } | null>(null);

  const bookMeta = index?.books.find((b) => b.n === book) ?? null;
  const spanishName = index?.spanishNames?.[String(book)];
  // Screen readers and speech tools need the real language per column, not
  // just the document default -- especially for Spanish, where the whole
  // point of the parallel view is correct pronunciation (CODEX_AUDIT.md A-033).
  const versionLanguage = index?.versions.find((v) => v.id === version)?.language ?? "en";
  const key = chapterKey(book, chapter);
  const primaryKey = `${version}:${key}`;

  useEffect(() => {
    document.documentElement.dataset.reading = night ? "night" : "parchment";
  }, [night]);

  useEffect(() => {
    setLastRead({ book, chapter, version, parallel });
  }, [book, chapter, version, parallel]);

  useEffect(() => {
    let cancelled = false;
    loadChapter(version, book, chapter)
      .then((verses) => !cancelled && setPrimary({ key: primaryKey, ok: true, value: verses }))
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ScriptureUnavailableError
            ? "This chapter isn't downloaded and you're offline."
            : "Couldn't load this chapter.";
        setPrimary({ key: primaryKey, ok: false, message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primaryKey is derived from these same deps
  }, [version, book, chapter]);

  useEffect(() => {
    if (!parallel) return;
    let cancelled = false;
    divergenceNote(key).then((text) => !cancelled && setNote({ key, text }));
    return () => {
      cancelled = true;
    };
  }, [parallel, key]);

  const primaryVerses = primary?.key === primaryKey && primary.ok ? primary.value : null;
  const primaryError = primary?.key === primaryKey && !primary.ok ? primary.message : null;
  const primaryLoading = primary?.key !== primaryKey;
  const noteText = note?.key === key ? note.text : null;
  const selectedVerse = verseSelection?.key === key ? verseSelection.verse : null;
  const selectVerse = (next: RefKey | null) =>
    setVerseSelection(next === null ? null : { key, verse: next });

  useEffect(() => {
    if (!parallel || !primaryVerses) return;
    let cancelled = false;
    resolveAlignment(version, SPANISH, key, primaryVerses.length).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setAligned({ key: primaryKey, rows: result.rows });
        setAlignmentError(null);
      } else {
        setAligned(null);
        setAlignmentError({ key: primaryKey, message: result.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [parallel, primaryVerses, version, key, primaryKey]);

  const alignedRows = aligned?.key === primaryKey ? aligned.rows : null;
  const alignmentErrorText = alignmentError?.key === primaryKey ? alignmentError.message : null;

  // Every chapter referenced by an aligned row's toKey gets fetched -- almost
  // always just `key` itself (Spanish numbering matches English 1:1), plus
  // the divergence target on the two Romans chapters that don't.
  // loadChapter()/loadBook() already memoize per book number, so re-running
  // this on every alignedRows change is cheap, not a re-fetch storm.
  useEffect(() => {
    if (!parallel || !alignedRows) return;
    const needed = new Set<string>([key]);
    for (const row of alignedRows) {
      if (row.toKey) needed.add(toChapterKey(row.toKey));
    }
    let cancelled = false;
    needed.forEach((chapterRef) => {
      const parsed = parseKey(chapterRef);
      if (!parsed) return;
      loadChapter(SPANISH, parsed.book, parsed.chapter)
        .then((verses) => {
          if (cancelled) return;
          setSpanishChapters((prev) => ({ ...prev, [chapterRef]: { key: chapterRef, ok: true, value: verses } }));
        })
        .catch(() => {
          if (cancelled) return;
          setSpanishChapters((prev) => ({
            ...prev,
            [chapterRef]: { key: chapterRef, ok: false, message: "Spanish text unavailable offline." },
          }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [parallel, alignedRows, key]);

  const resolveSpanish = (toKey: string | null) => resolveSpanishVerse(spanishChapters, toKey);

  const spanishNaturalChapter = spanishChapters[key];
  // alignmentErrorText excluded here on purpose: once resolveAlignment() has
  // settled with a failure, alignedRows will never arrive for this chapter,
  // so without this the pane would show "Cargando…" forever instead of the
  // explicit notice below (VMCACHE-001).
  const spanishLoading = parallel && !alignmentErrorText && (!alignedRows || !spanishNaturalChapter);
  const spanishError = spanishNaturalChapter && !spanishNaturalChapter.ok ? spanishNaturalChapter.message : null;

  // CODEX_AUDIT.md A-032 -- true only once the primary chapter has actually
  // loaded at least one verse. Passed to StudySession so "I'm finished
  // reading" cannot unlock the composer for a chapter that failed to load,
  // is still loading, or (defensively) resolved to a genuinely empty array.
  const textAvailable = hasLoadedText(primaryVerses);

  const goNext = () => {
    if (!index) return;
    const next = nextChapter({ book, chapter }, index.books);
    if (next) router.push(`/read/${next.book}/${next.chapter}`);
  };
  const goPrevious = () => {
    if (!index) return;
    const previous = previousChapter({ book, chapter }, index.books);
    if (previous) router.push(`/read/${previous.book}/${previous.chapter}`);
  };

  const rows = useMemo(
    () => (primaryVerses ?? []).map((text, i) => ({ verse: i + 1, text })),
    [primaryVerses],
  );

  return (
    <StudySession chapter={key} selectedVerse={selectedVerse} textAvailable={textAvailable}>
    <div className={styles.page}>
      <header className={styles.top}>
        <button className={styles.navBtn} onClick={goPrevious} aria-label="Previous chapter">
          ‹
        </button>
        <button className={styles.titleBtn} onClick={() => setPickerOpen(true)}>
          <span className={styles.titleRef}>{bookMeta ? `${bookMeta.name} ${chapter}` : "…"}</span>
          <span className={styles.titleVersion}>{version} ▾</span>
        </button>
        <button className={styles.navBtn} onClick={goNext} aria-label="Next chapter">
          ›
        </button>
      </header>

      {/*
        COVENANTTIMELINE-001 — covenant rail + timeline rail. Placed right
        under the sticky chapter header (book/chapter/version), above the
        Spanish-divergence note and the verse text, so it's the first
        context a reader sees for this chapter before they start reading --
        matching the header's own "here's what chapter you're on" role
        rather than competing with the toolbar below. Purely a function of
        book/chapter (both already resolved props), so it needs no loading
        state of its own the way the async panes above/below it do.
      */}
      <CovenantTimelineStrip book={book} chapter={chapter} />

      {noteText ? <p className={styles.note}>{noteText}</p> : null}

      <main className={styles.body}>
        {primaryLoading && <p className={styles.hint}>Loading…</p>}
        {primaryError && <p className={styles.error}>{primaryError}</p>}

        {!parallel && primaryVerses && (
          <div lang={versionLanguage}>
            <VerseColumn
              book={book}
              chapter={chapter}
              rows={rows}
              selectedVerse={selectedVerse}
              onSelectVerse={selectVerse}
            />
          </div>
        )}

        {parallel && primaryVerses && (
          <div className={styles.split}>
            <div className={styles.column} lang={versionLanguage}>
              <p className={styles.columnLabel}>{version}</p>
              <VerseColumn
                book={book}
                chapter={chapter}
                rows={rows}
                selectedVerse={selectedVerse}
                onSelectVerse={selectVerse}
              />
            </div>
            <div className={styles.column} lang="es">
              <p className={styles.columnLabel}>{spanishName ?? "Español"}</p>
              {alignmentErrorText && <p className={styles.error}>{alignmentErrorText}</p>}
              {!alignmentErrorText && spanishLoading && <p className={styles.hint}>Cargando…</p>}
              {!alignmentErrorText && spanishError && <p className={styles.error}>{spanishError}</p>}
              {!alignmentErrorText &&
                !spanishLoading &&
                !spanishError &&
                alignedRows?.map((row, i) => {
                  const { text, error } = resolveSpanish(row.toKey);
                  if (error) return null; // a secondary (divergence-target) chapter failed to load; skip that row only
                  if (text === null) return null; // still loading that specific target chapter -- genuinely nothing to show yet
                  // CODEX_AUDIT.md A-028 -- text === "" is a DECLARED omission
                  // (the corpus's own convention), not "still loading" (that
                  // case already returned above via text === null). Render
                  // the same honest marker VerseColumn uses rather than
                  // silently dropping the row.
                  const omitted = isOmittedVerseText(text);
                  return (
                    <p key={`${row.toKey ?? "gap"}-${i}`} className={styles.verse}>
                      <sup className={styles.vnum}>{row.fromVerse ?? "—"}</sup>
                      {omitted ? <span className={styles.omitted}>{OMITTED_VERSE_TEXT}</span> : text}
                    </p>
                  );
                })}
            </div>
          </div>
        )}
      </main>

      <div className={styles.toolbar}>
        <StudyEntryControl
          book={book}
          chapter={chapter}
          selectedVerse={selectedVerse}
          verseCount={rows.length}
          workspaceId={workspaceId}
        />
        <Chip active={night} tone="green" onClick={() => setNight((n) => !n)}>
          {night ? "☾ Night" : "☀ Day"}
        </Chip>
        <Chip active={parallel} tone="green" onClick={() => setParallel((p) => !p)}>
          {parallel ? "Español ✓" : "Español"}
        </Chip>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Version">
        <div className={styles.versionList}>
          {index?.versions
            .filter((v) => v.language === "en")
            .map((v) => (
              <button
                key={v.id}
                className={styles.versionRow}
                onClick={() => {
                  setVersion(v.id);
                  setPickerOpen(false);
                }}
                aria-current={v.id === version}
              >
                <span className={styles.versionShort}>{v.short}</span>
                <span className={styles.versionNote}>{v.note}</span>
              </button>
            ))}
        </div>
      </Sheet>
    </div>
    </StudySession>
  );
}
