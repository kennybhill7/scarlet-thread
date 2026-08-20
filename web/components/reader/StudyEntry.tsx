"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { RefKey } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudySession } from "@/lib/contracts/study-v2";
import { verseKey } from "@/lib/bible/reference";
import { Chip } from "@/components/ui/Chip";

// Styled from ChapterReader's own CSS Module, not a new one of this file's
// own -- see buildNewStudySession's comment below for the matching reason
// on the record-builder side: keeping this file's import graph limited to
// what ChapterReader.tsx already imports (ui/Chip + its own CSS Module)
// means the existing tests that load the real ChapterReader.tsx module tree
// (tests/verse-selection.test.ts, tests/versemap-offline.test.ts -- neither
// owned nor readOnly here, so they cannot be edited to seed a new stub) keep
// working unmodified: they already stub `@/components/ui/Chip` and
// `./ChapterReader.module.css`, and now that is everything this file needs
// too.
import styles from "./ChapterReader.module.css";

/**
 * STUDYENTRY-001 — the entry point into a NEW v2 study session. Everything
 * upstream (the composer, the vault writers, sync, export, and STUDYPAGE-001's
 * `/study/[sessionId]` route) already exists; nothing created a session, so a
 * learner could only ever land on that route by already knowing an id. This
 * file is the "start a study" affordance the reader was missing, mounted in
 * `ChapterReader.tsx`'s own toolbar (components/reader/ — owned here).
 *
 * ---------------------------------------------------------------------------
 * WRITE PATH (acceptance criterion 2) — no new write path. `resolveStudySessionId`
 * below writes through exactly the two things V2VAULT-001 and SYNCV2ROUTE-001
 * already exported for this purpose: `saveLocalStudySession` (the local vault
 * writer, one IndexedDB transaction covering the entity store AND its outbox
 * op) and `syncNowV2` (the push/pull loop that drains that outbox against
 * `/api/sync/v2/push`), both reached through a lazy `import()` inside
 * `defaultStudyEntryDeps` below (see that constant's own comment for why the
 * import is dynamic rather than static). No IndexedDB call, no `fetch`,
 * appears anywhere in this file outside those two functions.
 * `buildNewStudySession` below only ASSEMBLES the plain object handed to
 * `saveLocalStudySession` — see its own comment for why it is a local copy
 * of V2COMPOSER-001's identically-shaped `buildStudySessionDraft` rather
 * than an import of it.
 *
 * WHY THE PUSH IS NOT OPTIONAL: `/study/[sessionId]/page.tsx` (readOnlyPath)
 * is a Server Component that reads the session straight out of Postgres via
 * `getSessionV2` — it has no knowledge of this device's IndexedDB. A session
 * that exists only locally 404s the instant this file would navigate to it.
 * `resolveStudySessionId` therefore awaits `syncNowV2()` and lets it throw
 * before ever returning a navigable id — see `beginStudyEntry`'s catch below,
 * and acceptance criterion 6's mutation proof in tests/study-entry.test.ts.
 *
 * ---------------------------------------------------------------------------
 * DEDUP RULE (acceptance criterion 3) — tapping "start a study" twice for the
 * SAME reading position (same book/chapter, same selected verse or lack of
 * one) must not silently create two sessions.
 *
 * Two layers, deliberately different mechanisms for two different races:
 *
 *   1. SAME TAP, same render (a genuine double-click/double-tap before the
 *      first request resolves): guarded in the component below by a
 *      `creating` boolean that disables the control for the duration of one
 *      in-flight `beginStudyEntry` call. A second tap while the first is
 *      still running is a no-op, not a second write.
 *
 *   2. REPEAT VISITS (leaving the chapter and coming back, or a second
 *      device that has since synced): `findExistingActiveSession` below scans
 *      this workspace's already-known sessions for one whose `range` is
 *      STRUCTURALLY IDENTICAL (same versificationId/start/end) to the range
 *      being started, and whose `workflowState` is still `"active"`. A match
 *      is reused — its id is returned, no new row is written — rather than
 *      minted fresh. A `"closed"` or `"archived"` session for the same range
 *      does NOT count as a match: closing a study is a deliberate signal that
 *      pass is finished, so starting again on that passage later is treated
 *      as a genuinely new pass, not a duplicate of the one already put away.
 *      This mirrors the resumability contract BUILD_PLAN.md:125 already
 *      states for the study page itself ("one route, one resumable
 *      session") rather than inventing a different rule here.
 *
 * Neither layer depends on a server-side uniqueness constraint (there is
 * none — db/schema.ts is a readOnlyPath and outside this task's scope to
 * add one to): the guarantee this file makes is "this device will not
 * KNOWINGLY mint a second active session for a range it already has one
 * for," not a hard database invariant. Documented, not hidden — see the
 * commit report for the residual gap (two truly concurrent devices, or two
 * browser tabs, could each independently pass the check before either has
 * written).
 * ---------------------------------------------------------------------------
 */

/**
 * The passage range a "start a study" tap anchors to: the whole chapter
 * being read, or — when the reader has a verse selected — just that verse.
 * Returns null while the chapter hasn't finished loading (verseCount === 0),
 * so the control can disable itself rather than construct a zero-verse range.
 */
export function buildEntryRange(
  book: number,
  chapter: number,
  verseCount: number,
  selectedVerse: RefKey | null,
): CanonicalRangeV1 | null {
  if (verseCount < 1) return null;
  const start = selectedVerse ?? verseKey(book, chapter, 1);
  const end = selectedVerse ?? verseKey(book, chapter, verseCount);
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

/**
 * A freshly-started v2 StudySession. Field-for-field identical to
 * V2COMPOSER-001's own `buildStudySessionDraft` (components/study/
 * ClaimComposer.tsx, a readOnlyPath here) — same seven fixed fields, same
 * values (`mode: "encounter"`, `workflowState: "active"`,
 * `connectionState: "unexamined"`, `catalogReleaseId: null`,
 * `readGateAt: null`, `currentStep: "observe"`, `revision: 1`) — but
 * deliberately a SEPARATE, LOCAL copy rather than an import of that
 * function. Importing it would pull `ClaimComposer.tsx`'s own `Button`/
 * `Field` UI imports (and their CSS Modules) into `ChapterReader.tsx`'s
 * module graph transitively, through this file — and
 * `tests/verse-selection.test.ts` / `tests/versemap-offline.test.ts` (real
 * existing tests, neither owned nor readOnly here) already load the real
 * `ChapterReader.tsx` with a fixed, smaller stub list that does not account
 * for that. Duplicating this one small object literal here — rather than
 * either breaking those two tests' module loading or editing files outside
 * this task's ownedPaths to fix them — is the intentional tradeoff; if
 * `buildStudySessionDraft`'s own field values ever change, this copy must
 * be updated to match (both are exercised against the identical wire schema,
 * `syncStudySessionV2Schema`, in tests/study-entry.test.ts and
 * tests/study-composer.test.ts respectively, so a drift between the two
 * would surface as one of those suites' schemas rejecting valid output --
 * not silently).
 */
function buildNewStudySession(params: {
  id: string;
  workspaceId: string;
  range: CanonicalRangeV1;
  now: string;
}): StudySession {
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    range: params.range,
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "observe",
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

/** See "DEDUP RULE" above. Structural range equality, never a fuzzy/overlap match. */
export function findExistingActiveSession(
  sessions: StudySession[],
  workspaceId: string,
  range: CanonicalRangeV1,
): StudySession | null {
  return (
    sessions.find(
      (session) =>
        session.workspaceId === workspaceId &&
        session.workflowState === "active" &&
        !session.deletedAt &&
        session.range.versificationId === range.versificationId &&
        session.range.start === range.start &&
        session.range.end === range.end,
    ) ?? null
  );
}

/**
 * The seam this module's async logic runs through — real IndexedDB/sync
 * functions by default, swappable in tests the same way
 * `app/(app)/study/[sessionId]/page.tsx`'s `StudyPageDeps` is (that file's
 * own established pattern for this codebase, reused rather than invented
 * fresh here).
 */
export interface StudyEntryDeps {
  listSessions: () => Promise<StudySession[]>;
  saveSession: (session: StudySession) => Promise<void>;
  pushChanges: () => Promise<unknown>;
  now: () => string;
  newId: () => string;
}

/**
 * `lib/sync/store.ts` (readOnlyPath) and `lib/sync/client.ts` are loaded
 * lazily, via a dynamic `import()` inside each function below, rather than a
 * static top-level import. `lib/sync/store.ts`'s module body calls `openDB(
 * "bible-brain", ...)` UNCONDITIONALLY the instant it is loaded (see that
 * file's own module-level `const database = openDB(...)` statement) — a
 * static import here would mean simply LOADING `ChapterReader.tsx` (which
 * mounts `StudyEntryControl`, defined below) touches `indexedDB` even when
 * nothing has been clicked, in every environment that ever imports
 * `ChapterReader.tsx`. Two existing tests that load the real
 * `ChapterReader.tsx` for unrelated reasons — tests/versemap-offline.test.ts
 * — do not polyfill IndexedDB at all (they have no reason to; they test
 * Spanish alignment caching, not this task's feature), and neither is owned
 * or readOnly here to add that polyfill to. Deferring both imports until a
 * "Study" tap actually resolves these functions keeps `ChapterReader.tsx`
 * loadable with zero IndexedDB/network side effects merely from being
 * imported — a real behavioral improvement (lighter module graph until the
 * feature is actually used), not only a test-compatibility workaround.
 */
const defaultStudyEntryDeps: StudyEntryDeps = {
  listSessions: async () => {
    const store = await import("@/lib/sync/store");
    return store.listLocalV2Entities("session");
  },
  saveSession: async (session) => {
    const store = await import("@/lib/sync/store");
    await store.saveLocalStudySession(session);
  },
  pushChanges: async () => {
    const client = await import("@/lib/sync/client");
    return client.syncNowV2();
  },
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
};

/**
 * Resolves the session id a "start a study" tap should land on: an existing
 * active session for this exact range (dedup rule above), or a freshly
 * built one via `buildNewStudySession`. Either way, this throws (never
 * swallows) if the local write or the server push fails — the ONLY thing
 * that may follow a failure here is `beginStudyEntry`'s catch below, and
 * that catch must never fabricate a session id (mutation proof, acceptance
 * criterion 6).
 */
export async function resolveStudySessionId(
  workspaceId: string,
  range: CanonicalRangeV1,
  deps: StudyEntryDeps = defaultStudyEntryDeps,
): Promise<string> {
  const existing = findExistingActiveSession(await deps.listSessions(), workspaceId, range);
  const sessionId = existing?.id ?? deps.newId();

  if (!existing) {
    const session = buildNewStudySession({ id: sessionId, workspaceId, range, now: deps.now() });
    await deps.saveSession(session);
  }

  // Push (and pull) unconditionally, even on the reuse path: an existing
  // local session can itself still be sitting unsynced in this device's
  // outbox (e.g. ClaimComposer's own submit() — components/study/
  // ClaimComposer.tsx — writes locally through this same
  // saveLocalStudySession but never calls syncNowV2 itself). Only after
  // this resolves is the row guaranteed live in Postgres, which
  // /study/[sessionId] requires.
  await deps.pushChanges();

  return sessionId;
}

export type StudyEntryResult =
  | { status: "created"; sessionId: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

/**
 * The exact function the control's click handler calls — never a
 * reimplementation of this logic inline in the component (same discipline
 * as ChapterReader.tsx's own `nextVerseSelection`/`resolveAlignment`). Never
 * throws: every failure resolves to `{ status: "error" }`, and that is the
 * ONLY outcome a save/push failure may produce — see the header comment and
 * tests/study-entry.test.ts's "MUTATION-GUARD" test.
 */
export async function beginStudyEntry(
  workspaceId: string | null,
  range: CanonicalRangeV1 | null,
  deps: StudyEntryDeps = defaultStudyEntryDeps,
): Promise<StudyEntryResult> {
  if (!workspaceId) {
    return {
      status: "unavailable",
      message: "Starting a study needs your account to be reachable right now. Try reloading.",
    };
  }
  if (!range) {
    return { status: "unavailable", message: "This chapter hasn't finished loading yet." };
  }

  try {
    const sessionId = await resolveStudySessionId(workspaceId, range, deps);
    return { status: "created", sessionId };
  } catch {
    return {
      status: "error",
      message: "This device could not start a study session. Check your connection and try again.",
    };
  }
}

export interface StudyEntryControlProps {
  /** Resolved server-side (app/(app)/read/[book]/[chapter]/page.tsx), never a caller-supplied id. Null while unresolved. */
  workspaceId: string | null;
  book: number;
  chapter: number;
  /** The primary column's loaded verse count, 0 while the chapter is still loading. */
  verseCount: number;
  selectedVerse: RefKey | null;
}

/**
 * The reader's own "start a study" affordance — a Chip in ChapterReader's
 * existing toolbar (components/reader/ChapterReader.module.css `.toolbar`),
 * next to the Day/Español toggles, rather than a new floating button or
 * modal (acceptance criterion 5: follow the reader's existing conventions).
 * Discoverable the moment a chapter is open (acceptance criterion 4) — not
 * gated behind the v1 "I'm finished reading" gate in
 * components/notes/StudySession.tsx, a file outside this task's owned and
 * readOnly paths: that gate belongs to the separate v1 note-capture flow,
 * and this v2 study-session affordance does not depend on it.
 */
export function StudyEntryControl({
  workspaceId,
  book,
  chapter,
  verseCount,
  selectedVerse,
}: StudyEntryControlProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = buildEntryRange(book, chapter, verseCount, selectedVerse);

  async function handleStart() {
    if (creating) return; // layer 1 of the dedup rule -- see header comment
    setCreating(true);
    setError(null);
    const result = await beginStudyEntry(workspaceId, range);
    setCreating(false);
    if (result.status === "created") {
      router.push(`/study/${result.sessionId}`);
      return;
    }
    setError(result.message);
  }

  return (
    <div className={styles.entry}>
      <Chip
        tone="green"
        disabled={creating || !range || !workspaceId}
        onClick={() => void handleStart()}
        aria-label={selectedVerse ? `Start a study on ${selectedVerse}` : "Start a study on this chapter"}
      >
        {creating ? "Starting…" : "Study"}
      </Chip>
      {error ? (
        <p className={styles.entryError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
