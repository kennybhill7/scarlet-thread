/**
 * Thread radar — Phase 1 (RADAR-001, BUILD_PLAN.md §3.5).
 *
 * "You've noticed X in three passages, is this becoming a thread?" per the
 * guide's own rule (make a thread on the THIRD sighting, not the first).
 * Deliberately NOT an AI feature: no model, no summarizing, no
 * interpretation — word frequency across entries, at the scale of "read your
 * own writing back."
 *
 * SCOPE (read this before touching the shape below): `computeMotifCandidates`
 * below is, and remains, a PURE FUNCTION over already-fetched
 * entries/threads that returns motif-candidate-SHAPED values; it never reads
 * or writes a table. RADAR-001 built and tested it before `motif_candidates`/
 * `motif_sightings` (THEOLOGY_MASTER_BUILD_PLAN.md §12.3) existed on this
 * branch.
 *
 * RADARPERSIST-001 EXTENDED the file with the persistence half RADAR-001
 * deliberately deferred, now that those tables exist (SCHEMAV2-001):
 * `persistMotifCandidates` writes computed candidates and their sightings;
 * `dismissMotifCandidate` marks a candidate dismissed without touching the
 * underlying entries; `promoteMotifCandidate` is the BUILD_PLAN §3.3/§3.5
 * promotion transaction — "Promotion on the third genuine sighting creates
 * the thread and links earlier sightings transactionally" — gated on an
 * explicit learner confirmation the caller must supply; reaching three
 * sightings alone never promotes anything.
 *
 * MOTIFTHREAD-001 closed the one schema gap RADARPERSIST-001 reported and
 * worked around: `motif_candidates` now has a real, additive, nullable
 * `thread_slug` column (`db/schema.ts`, migration `0009`), and
 * `promoteMotifCandidate` writes it in the same atomic batch as the rest of
 * the promotion instead of forcing the created thread's slug to equal the
 * candidate's `normalizedKey`. See the "Persistence" section near the
 * bottom of this file for the full design notes, including the slug-
 * collision retry `promoteMotifCandidate` now does instead of erroring the
 * first time a learner already happens to have a same-named thread.
 *
 * BUILD_PLAN.md §3.3: "`user_connections` ... radar output lives in
 * `motif_candidates` — the three provenances never share a table." This
 * function's return value therefore never asserts a typed relationship
 * between two passages (no `ConnectionType`, no `fromRange`/`toRange` pair)
 * — only a label, a normalized key, the distinct passages a word was seen
 * in, and a status. A theological edge is the learner's own work, made after
 * comparing both texts and writing a rationale (Connect step, §3.5).
 *
 * CODEX_AUDIT.md A-045 — two findings, both addressed here:
 *
 *  1. Third-sighting rule: gate on `chapters.size >= 3` (distinct PASSAGES),
 *     never raw entry/mention count. A word said twice in notes about the
 *     SAME passage is one sighting, not two. Preserved exactly from the
 *     already-audited fix in `lib/vault/seed.ts` (see its own history for
 *     the two verified examples — "humanity" at 6 entries/2 chapters,
 *     "curse"/"flood"/"israel"/"language" likewise — that motivated it).
 *
 *  2. Honest coverage ("lexical-coverage half remains open" per the
 *     ledger): the old UI copy asserted "no thread covers this word." The
 *     audit's own evidence pointed at a per-entry check
 *     (`entryThreadTitleWords.has(word)`) that compared a single lowercased
 *     WORD against each linked thread's WHOLE lowercased TITLE STRING (e.g.
 *     "covenant faithfulness", never {"covenant","faithfulness"}), so it
 *     "cannot match multi-word thread titles."
 *
 *     Verified by direct execution against the ORIGINAL (unmodified)
 *     algorithm before changing anything here: that per-entry check was
 *     actually unreachable dead code, independent of the type mismatch, for
 *     every input tried, and provably so by construction. The candidate
 *     word set built one line earlier ALREADY drops any word present in
 *     `threadTitleWords` — every word tokenized out of EVERY thread's title,
 *     not just the entry's own linked ones — before the per-entry check ever
 *     runs. Since a linked thread's title words are necessarily a subset of
 *     that global set, `entryThreadTitleWords.has(word)` can never be true
 *     for a word that survived the filter one line above it, for ANY input,
 *     fixed type mismatch or not. This is a deeper finding than A-045
 *     recorded (which attributed the gap to the type mismatch, implying the
 *     mechanism was trying to do something but doing it wrong) — it never
 *     fired at all.
 *
 *     So there is no real "per-entry vs. global" coverage distinction to
 *     restore: only the global title-word blocklist ever did anything. This
 *     module keeps that one (real, functioning, correctly multi-word-aware
 *     since it already tokenizes every thread's title) and deletes the
 *     vestigial per-entry code rather than resurrecting a mechanism that
 *     never fired. Per the audit's suggested fix ("define lexical coverage
 *     honestly, or label it as a word-frequency hint rather than thread
 *     coverage"), this module chooses the honest label over an unproven
 *     semantic check: a thread titled "The Faithful God" covers a word like
 *     "loyalty" semantically without sharing a token, and literal title-word
 *     matching cannot and does not claim otherwise. `review/page.tsx`'s copy
 *     describes this as a word-frequency hint against thread titles, never a
 *     claim that a concept is uncovered.
 */
import { and, eq, isNull } from "drizzle-orm";

import { motifCandidates, motifSightings, threads as threadsTable } from "@/db/schema";
import type { Entry, Thread } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { MotifCandidate, MotifCandidateStatus } from "@/lib/contracts/study-v2";
import { hasDatabaseErrorCode } from "@/lib/db/errors";

// `drizzle-orm` and `@/db/schema` are both side-effect-free to import under
// plain node (no `"server-only"`, no network) — `tests/tenant-isolation.test.ts`
// and `tests/sync-v2-persist.test.ts` both import `@/db/schema` directly
// without any require-cache seeding, which is the existing proof of that.
// `@/lib/db` (the actual client) is NOT safe to import statically here: it
// begins with `import "server-only"`, which throws outright under plain
// node, and `tests/radar.test.ts` — a READ-ONLY path for this task, and
// still required to pass unweakened — loads this module with no seeding of
// any kind. Every function below that needs the client therefore imports it
// LAZILY, through `getDb()`, so merely importing `lib/db/radar.ts` (as
// `computeMotifCandidates`'s own test does) never touches "server-only" —
// only actually CALLING a persistence function does. This is the same
// lazy-import shape `lib/sync/clear.ts` already uses in this codebase, not a
// one-off workaround. Verified directly (not just reasoned about): a dynamic
// `import()` compiled by this project's `tsx` test runner DOES resolve
// through the same `require.cache` a test's `seedModule()` helper patches,
// exactly like a static import does — proven with a throwaway probe test
// before writing this, then deleted; `tests/radar-persist.test.ts` below
// relies on that same fact.
async function getDb() {
  const mod = await import("@/lib/db");
  return mod.db;
}

// ---------------------------------------------------------------------------
// Ported VERBATIM from `lib/vault/seed.ts` (STOPWORDS, BOOK_NAMES,
// normaliseWord) per RADAR-001's acceptance criteria: "a diff-level match,
// since that logic was already audited once" against the real 70-entry seed.
// Do not re-derive; if the seed-side list ever changes, update both in the
// same commit. `lib/vault/seed.ts` is read-only for this task.
// ---------------------------------------------------------------------------

export const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "were", "they",
  "them", "their", "what", "when", "where", "which", "while", "would",
  "could", "should", "there", "here", "then", "than", "into", "over",
  "under", "about", "before", "after", "again", "still", "also", "even",
  "just", "only", "never", "always", "your", "unto", "shall", "will",
  "upon", "hath", "thee", "thou", "thy", "his", "her", "him", "she",
  "who", "was", "are", "for", "not", "but", "you", "all", "one", "two",
  "out", "now", "own", "did", "yet", "every", "between", "chapter",
  "chapters", "verse", "verses", "reads", "reading", "first", "second",
  "third", "fourth", "fifth", "each", "some", "much", "many", "more",
  "most", "less", "least", "such", "same", "other", "another", "these",
  "those", "being", "been", "back", "away", "toward",
  "through", "against", "because", "since", "until", "though", "given",
  "everything", "great", "toward",
]);

export const BOOK_NAMES = new Set([
  "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua",
  "judges", "ruth", "samuel", "kings", "chronicles", "ezra", "nehemiah",
  "esther", "job", "psalms", "psalm", "proverbs", "ecclesiastes", "song",
  "songs", "solomon", "isaiah", "jeremiah", "lamentations", "ezekiel",
  "daniel", "hosea", "joel", "amos", "obadiah", "jonah", "micah", "nahum",
  "habakkuk", "zephaniah", "haggai", "zechariah", "malachi", "matthew",
  "mark", "luke", "john", "acts", "romans", "corinthians", "galatians",
  "ephesians", "philippians", "colossians", "thessalonians", "timothy",
  "titus", "philemon", "hebrews", "james", "peter", "jude", "revelation",
]);

/** Crude plural-merge: "nations" and "nation" should count as one hit, not
 * two. Not real stemming (would need a real library for that) -- just
 * enough to stop the obvious cases from splitting a genuine pattern. */
export function normaliseWord(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// ---------------------------------------------------------------------------
// Motif-candidate shape
// ---------------------------------------------------------------------------

/** Count DISTINCT passages, require at least three (A-045, guide's own rule:
 * "make a thread on the third sighting, not the first"). Named so the
 * threshold is one obvious place to mutate for the required mutation proof. */
export const MOTIF_CANDIDATE_MIN_SIGHTINGS = 3;

/**
 * A not-yet-persisted candidate has no `id`, `workspaceId`, `revision`, or
 * timestamps — those are meaningless before a `motif_candidates` row exists,
 * so this type deliberately does NOT extend `MotifCandidate` wholesale (that
 * would force fabricating those fields). It reuses the three
 * already-meaningful fields from the real contract type — `label`,
 * `normalizedKey`, `status` — plus the one field a pure word-frequency pass
 * can honestly report: which distinct passages the word was seen in.
 */
export type RadarMotifCandidate = Pick<MotifCandidate, "label" | "normalizedKey" | "status"> & {
  /** Distinct passage scopes (RefKeys, e.g. "1.3") this word was seen in —
   * never fewer than MOTIF_CANDIDATE_MIN_SIGHTINGS, sorted for stable display. */
  passages: string[];
};

/**
 * Status for a candidate that exists only for this render pass, not yet
 * written anywhere. `MotifCandidate.status` has no enumerated values in
 * either planning document (`lib/contracts/study-v2.ts` gap #3), so this
 * module's three status constants (below, "Status vocabulary") remain the
 * source of truth for the actual literal values written to the column.
 * MOTIFSTATUS-001 closed the closed-type half of that gap:
 * `lib/contracts/study-v2.ts` now exports `MOTIF_CANDIDATE_STATUSES`,
 * derived FROM these three constants' values (read, not guessed), and this
 * constant is typed against the resulting `MotifCandidateStatus` union so
 * the two can never silently drift apart — a typo or a removed value here
 * fails `npm run typecheck`, not just a runtime assertion.
 */
const PENDING_STATUS: MotifCandidateStatus = "candidate";

/** Cap on how many candidates one render surfaces — carried over from the
 * pre-existing radar UI so the section's length doesn't change shape. */
const MAX_CANDIDATES = 8;

/**
 * word -> distinct PASSAGE (chapter) -> the first entry id seen mentioning
 * that word in that chapter. Extracted (RADARPERSIST-001) so persistence
 * below can attach a real `entryId` to each sighting it writes without ever
 * computing a DIFFERENT set of hits than `computeMotifCandidates` itself —
 * both read from this one pass. A word said twice about the SAME passage is
 * one sighting, not two (A-045), so only the FIRST entry per (word, chapter)
 * pair is kept; which one is arbitrary among ties and not a contract.
 *
 * Pure: no database read, no side effects. This is a mechanical extraction
 * of `computeMotifCandidates`'s original inline loop — verified byte-for-byte
 * output-identical against the 12 pre-existing RADAR-001 tests before
 * anything else in this file changed.
 */
function collectHits(entries: Entry[], threads: Thread[]): Map<string, Map<string, string>> {
  // The one real, functioning coverage check: every word tokenized out of
  // EVERY thread's title (multi-word titles included -- `.split` already
  // breaks "Covenant Faithfulness" into {"covenant","faithfulness"}), so a
  // word already carrying its own thread name never surfaces as "emerging."
  // This is literal lexical matching, not semantic coverage -- see the file
  // header (A-045, finding 2) for why a second, per-entry version of this
  // check was deleted rather than "fixed": it never fired.
  const threadTitleWords = new Set(
    threads.flatMap((t) => t.title.toLowerCase().split(/[^a-z]+/).filter(Boolean)),
  );

  const hits = new Map<string, Map<string, string>>();

  entries.forEach((entry) => {
    if (entry.kind !== "observation" && entry.kind !== "question") return;

    const words = entry.body
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 5 && !STOPWORDS.has(w) && !BOOK_NAMES.has(w) && !threadTitleWords.has(w))
      .map(normaliseWord);

    for (const word of words) {
      if (!hits.has(word)) hits.set(word, new Map());
      const byChapter = hits.get(word)!;
      if (!byChapter.has(entry.chapter)) byChapter.set(entry.chapter, entry.id);
    }
  });

  return hits;
}

/**
 * Pure function: no database read, no side effects. Callers (today,
 * `review/page.tsx`) fetch entries/threads themselves and pass them in.
 */
export function computeMotifCandidates(entries: Entry[], threads: Thread[]): RadarMotifCandidate[] {
  // word -> distinct PASSAGES (chapters) it appears in. Counting distinct
  // entries here would be wrong -- several entries can share one chapter
  // anchor, and a word said twice about the SAME passage is one sighting,
  // not two (A-045).
  const hits = collectHits(entries, threads);

  return Array.from(hits.entries())
    .filter(([, byChapter]) => byChapter.size >= MOTIF_CANDIDATE_MIN_SIGHTINGS)
    .map(([word, byChapter]) => ({
      label: word,
      normalizedKey: word,
      status: PENDING_STATUS,
      passages: Array.from(byChapter.keys()).sort(),
    }))
    .sort((a, b) => b.passages.length - a.passages.length || a.label.localeCompare(b.label))
    .slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Persistence (RADARPERSIST-001, BUILD_PLAN.md §3.3/§3.5, master plan §12.3)
// ---------------------------------------------------------------------------
//
// Status vocabulary — `motif_candidates.status` / `motif_sightings.status`
// have NO enumerated values in either planning document
// (`lib/contracts/study-v2.ts` gap #3); these five are this module's own
// plain-text choice, not a guessed enum. `MOTIF_SIGHTING_PENDING_STATUS`
// reuses `"counting"`, the value `tests/sync-v2-persist.test.ts`'s own
// `validMotifSightingPayload` fixture already picked for an
// un-promoted sighting — matching existing usage rather than inventing a
// second word for the same idea.
//
// MOTIFSTATUS-001: the three `MOTIF_CANDIDATE_*` constants below are now
// typed against `MotifCandidateStatus` (`lib/contracts/study-v2.ts`'s
// `MOTIF_CANDIDATE_STATUSES`, sourced FROM these exact three values) so this
// module and the contract can never independently drift. `motif_sightings.
// status` (the two `MOTIF_SIGHTING_*` constants) is NOT part of that closed
// type — it stays untyped plain text; nothing reads this column anywhere in
// the codebase to gate a decision on (grep-confirmed), so it carries none of
// `motif_candidates.status`'s promotion-bypass risk and MOTIFSTATUS-001's
// acceptance criteria scope an enum to the candidate column only.
export const MOTIF_CANDIDATE_PENDING_STATUS: MotifCandidateStatus = PENDING_STATUS;
export const MOTIF_CANDIDATE_DISMISSED_STATUS: MotifCandidateStatus = "dismissed";
export const MOTIF_CANDIDATE_PROMOTED_STATUS: MotifCandidateStatus = "promoted";
export const MOTIF_SIGHTING_PENDING_STATUS = "counting";
export const MOTIF_SIGHTING_PROMOTED_STATUS = "promoted";

export class MotifCandidateNotFoundError extends Error {
  constructor(readonly candidateId: string) {
    super(`Motif candidate "${candidateId}" was not found in this workspace`);
    this.name = "MotifCandidateNotFoundError";
  }
}

/** Thrown when a caller asks to promote without an explicit learner
 * confirmation. Reaching three sightings only OFFERS promotion — this
 * class of error is how the "never auto-promote" rule is enforced in code,
 * not merely by convention at call sites. */
export class MotifPromotionNotConfirmedError extends Error {
  constructor() {
    super(
      "Promotion requires an explicit learner confirmation (learnerConfirmed must be true) " +
        "-- reaching three sightings only offers promotion, it never triggers it",
    );
    this.name = "MotifPromotionNotConfirmedError";
  }
}

export class MotifPromotionInsufficientSightingsError extends Error {
  constructor(
    readonly candidateId: string,
    readonly sightingCount: number,
  ) {
    super(
      `Motif candidate "${candidateId}" has ${sightingCount} sighting(s) on record; ` +
        `promotion requires at least ${MOTIF_CANDIDATE_MIN_SIGHTINGS}`,
    );
    this.name = "MotifPromotionInsufficientSightingsError";
  }
}

export class MotifPromotionAlreadyResolvedError extends Error {
  constructor(
    readonly candidateId: string,
    readonly status: string,
  ) {
    super(`Motif candidate "${candidateId}" is already "${status}" and cannot be promoted again`);
    this.name = "MotifPromotionAlreadyResolvedError";
  }
}

/**
 * MOTIFSTATUS-001, acceptance criterion 4 — `dismissMotifCandidate`'s own
 * defense-in-depth guard. Until now this function issued a bare `UPDATE ...
 * SET status = 'dismissed'` scoped only by `(id, workspaceId)`, with no
 * check of the row's CURRENT status first — so calling it on an already-
 * promoted candidate would silently flip a real, thread-backed promotion
 * back to "dismissed". `app/api/motifs/[id]/route.ts` (read-only for this
 * task) already guards this at the route layer before either action runs;
 * this is the SECOND, independent guard the route's own comment flags as
 * missing ("`dismissMotifCandidate` itself has no such guard"). Both guards
 * are kept — the route's so a caller gets a clean 409 on the common path,
 * this one so `dismissMotifCandidate` is safe to call from anywhere, not
 * only from behind that specific route's pre-check.
 */
export class MotifDismissalAlreadyResolvedError extends Error {
  constructor(
    readonly candidateId: string,
    readonly status: string,
  ) {
    super(`Motif candidate "${candidateId}" is already "${status}" and cannot be dismissed`);
    this.name = "MotifDismissalAlreadyResolvedError";
  }
}

/**
 * MOTIFTHREAD-001: RADARPERSIST-001 left this class describing a promotion
 * that fails outright the moment its deterministic slug (== normalizedKey)
 * was already taken by any thread. That was a real bug, not a feature: a
 * learner who happened to already have a thread named "faith" could never
 * promote a "faith" candidate at all. `db/schema.ts` now carries
 * `motif_candidates.thread_slug` (additive, nullable — see that column's own
 * comment), so the created thread's slug no longer has to equal, or be
 * derivable from, `normalizedKey` — `promoteMotifCandidate` below tries a
 * human-readable slug derived from the candidate's label, and on a genuine
 * `(userId, slug)` collision retries with the next numbered variant
 * ("label-2", "label-3", ...) up to `MAX_THREAD_SLUG_ATTEMPTS`, so a naming
 * collision no longer blocks promotion at all.
 *
 * This class is KEPT, not deleted, but its trigger condition has narrowed:
 * it now fires only when EVERY attempt up to the bound collides — i.e. the
 * learner already has `MAX_THREAD_SLUG_ATTEMPTS` distinct threads whose slugs
 * are all numbered variants of this exact label. That is a genuinely
 * degenerate case (not "the learner has one thread with this name," which is
 * the case this task was filed to stop erroring on), so surfacing an error
 * rather than looping forever is still the right behavior for it.
 */
export class MotifThreadSlugCollisionError extends Error {
  constructor(
    readonly label: string,
    readonly attempts: number,
  ) {
    super(
      `Could not find a free thread slug derived from "${label}" for this learner ` +
        `after ${attempts} attempt(s) — every numbered variant is already taken`,
    );
    this.name = "MotifThreadSlugCollisionError";
  }
}

/** Bound on how many `(userId, slug)` collisions `promoteMotifCandidate`
 * will retry past before giving up (see `MotifThreadSlugCollisionError`).
 * Generous on purpose: a learner would need this many DISTINCT existing
 * threads, all numbered variants of the same label, before promotion ever
 * refuses — a case that does not occur in ordinary use. Exported so the
 * mutation-proof test can target it by name instead of a magic number. */
export const MAX_THREAD_SLUG_ATTEMPTS = 25;

/**
 * Same slugification convention `components/threads/ThreadCreator.tsx`
 * already uses for hand-created threads (diff-level match ported here,
 * that file is a client component and cannot be imported into this
 * server-side module) — kebab-case, ASCII-folded, capped at the 120-char
 * limit `lib/api/threads.ts`'s `threadSlugSchema` enforces on every thread
 * slug, hand-made or promoted alike.
 */
function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");
}

/** The Nth slug this promotion will try for `label` (0-indexed): the plain
 * slugified label first, then "label-2", "label-3", ... — never "label-1",
 * matching the human-facing counting a learner would expect ("the first one
 * is just the name; the second collision is #2"). */
function candidateThreadSlug(label: string, attempt: number): string {
  const base = slugify(label) || "thread";
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

/** Best-available `CanonicalRangeV1` for a sighting's originating entry.
 * `Entry.verse` is already a verse-level `RefKey` when present, so it is
 * used verbatim (a true single-verse range). When only `Entry.chapter` is
 * available, this falls back to a CHAPTER-granularity "range" (start===end
 * at chapter precision, not verse precision) rather than expanding it to the
 * chapter's real first/last verse — that expansion needs real Bible
 * versification data (`lib/bible/range.ts`, out of this module's inputs and
 * this task's scope) and is Phase 2 curated-passage-unit territory per
 * BUILD_PLAN §3.3. Documented simplification, not a silent one. */
function exactRangeForEntry(entry: Entry): CanonicalRangeV1 {
  const ref = entry.verse ?? entry.chapter;
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: ref, end: ref };
}

export interface PersistedMotifCandidateSummary {
  id: string;
  normalizedKey: string;
  label: string;
  /** `true` if THIS call created the row; `false` if a live candidate with
   * this normalizedKey already existed and was left untouched (dedup,
   * acceptance criterion 5). */
  created: boolean;
  sightingCount: number;
}

/**
 * Runs `computeMotifCandidates` over the given entries/threads and writes
 * any NEW candidate (one not already persisted, live, for this
 * `normalizedKey` in this workspace) as a `motif_candidates` row plus one
 * `motif_sightings` row per distinct passage it was computed from — "with
 * their sightings," per this task's acceptance criterion 1.
 *
 * Dedup (criterion 5): re-running this against growing entries never creates
 * a second `motif_candidates` row for a normalizedKey that already has a
 * live (non-soft-deleted) one in this workspace — including one already
 * dismissed or promoted, since "already resolved once" is exactly the case
 * a second row would silently re-litigate. This function does not attempt
 * to append newly-computed sightings onto an already-persisted candidate
 * either; that incremental-append behavior is out of this task's scope (see
 * the acceptance criteria — only "does not duplicate an existing candidate"
 * is required) and is left as a documented follow-up.
 *
 * NEVER auto-promotes. This function only ever writes `status:
 * MOTIF_CANDIDATE_PENDING_STATUS` candidates and
 * `MOTIF_SIGHTING_PENDING_STATUS` sightings — it has no code path that calls
 * `promoteMotifCandidate`, regardless of how many sightings a candidate
 * reaches. Promotion is a separate function a caller must invoke
 * deliberately, with an explicit confirmation flag (see below).
 */
export async function persistMotifCandidates(
  workspaceId: string,
  entries: Entry[],
  threads: Thread[],
): Promise<PersistedMotifCandidateSummary[]> {
  const candidates = computeMotifCandidates(entries, threads);
  if (candidates.length === 0) return [];

  const hits = collectHits(entries, threads);
  const db = await getDb();
  const summaries: PersistedMotifCandidateSummary[] = [];

  for (const candidate of candidates) {
    const [existing] = await db
      .select({ id: motifCandidates.id })
      .from(motifCandidates)
      .where(
        and(
          eq(motifCandidates.workspaceId, workspaceId),
          eq(motifCandidates.normalizedKey, candidate.normalizedKey),
          isNull(motifCandidates.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      summaries.push({
        id: existing.id,
        normalizedKey: candidate.normalizedKey,
        label: candidate.label,
        created: false,
        sightingCount: 0,
      });
      continue;
    }

    const candidateId = crypto.randomUUID();
    const now = new Date().toISOString();
    const byChapter = hits.get(candidate.normalizedKey);
    if (!byChapter) {
      // Cannot happen: `candidate` was computed FROM `hits` one line above,
      // by the same key. Guarded rather than asserted-away with `!` so a
      // future refactor that breaks this invariant fails loudly here
      // instead of writing a candidate with zero sightings.
      throw new Error(
        `Internal error: no hits recorded for computed candidate "${candidate.normalizedKey}"`,
      );
    }

    await db.batch([
      db.insert(motifCandidates).values({
        id: candidateId,
        workspaceId,
        label: candidate.label,
        normalizedKey: candidate.normalizedKey,
        status: MOTIF_CANDIDATE_PENDING_STATUS,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(motifSightings).values(
        candidate.passages.map((passage) => {
          const entryId = byChapter.get(passage)!;
          const entry = entries.find((e) => e.id === entryId)!;
          return {
            id: crypto.randomUUID(),
            workspaceId,
            candidateId,
            passageUnitKey: passage,
            exactRange: exactRangeForEntry(entry),
            entryId,
            claimId: null,
            status: MOTIF_SIGHTING_PENDING_STATUS,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          };
        }),
      ),
    ] as Parameters<typeof db.batch>[0]);

    summaries.push({
      id: candidateId,
      normalizedKey: candidate.normalizedKey,
      label: candidate.label,
      created: true,
      sightingCount: candidate.passages.length,
    });
  }

  return summaries;
}

/**
 * Marks a candidate dismissed. Per acceptance criterion 4, this NEVER
 * deletes or otherwise touches the underlying observations: it issues
 * exactly one `UPDATE motif_candidates SET status = ...` scoped to this one
 * row, and nothing else. `motif_sightings` rows, the `entries` the sightings
 * point at, and every other candidate are all left completely alone —
 * structurally, not just by care, since this function never imports or
 * references the `entries` table at all.
 *
 * MOTIFSTATUS-001: refuses (`MotifDismissalAlreadyResolvedError`) rather
 * than silently overwriting a candidate that is not currently PENDING — see
 * that error class's own header.
 */
export async function dismissMotifCandidate(workspaceId: string, candidateId: string): Promise<void> {
  const db = await getDb();

  const [current] = await db
    .select({ revision: motifCandidates.revision, status: motifCandidates.status })
    .from(motifCandidates)
    .where(
      and(
        eq(motifCandidates.id, candidateId),
        eq(motifCandidates.workspaceId, workspaceId),
        isNull(motifCandidates.deletedAt),
      ),
    )
    .limit(1);
  if (!current) throw new MotifCandidateNotFoundError(candidateId);
  // MOTIFSTATUS-001, acceptance criterion 4 — see MotifDismissalAlreadyResolvedError's
  // own header. A candidate that is already "dismissed" OR already "promoted"
  // may not be dismissed again; only a genuinely pending candidate reaches
  // the UPDATE below.
  if (current.status !== MOTIF_CANDIDATE_PENDING_STATUS) {
    throw new MotifDismissalAlreadyResolvedError(candidateId, current.status);
  }

  await db
    .update(motifCandidates)
    .set({
      status: MOTIF_CANDIDATE_DISMISSED_STATUS,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(motifCandidates.id, candidateId), eq(motifCandidates.workspaceId, workspaceId)));
}

export interface PromoteMotifCandidateResult {
  threadSlug: string;
  threadTitle: string;
  sightingCount: number;
}

/**
 * The BUILD_PLAN §3.3/§3.5 promotion transaction: "Promotion on the third
 * genuine sighting creates the thread and links earlier sightings
 * transactionally."
 *
 * NEVER AUTO-PROMOTES: `options.learnerConfirmed` must be exactly `true` or
 * this throws `MotifPromotionNotConfirmedError` before touching the
 * database at all. Reaching `MOTIF_CANDIDATE_MIN_SIGHTINGS` only makes
 * promotion POSSIBLE to call, never automatic — nothing in this module ever
 * calls this function on the caller's behalf (see `persistMotifCandidates`'s
 * header). The caller (a route handler, driven by the learner explicitly
 * confirming in the UI) is the only thing that can set this flag.
 *
 * ATOMIC PER ATTEMPT: every write for one attempt — the candidate's status
 * flip (now including `threadSlug`, MOTIFTHREAD-001), every one of its
 * sightings' status flips, and the new `threads` row — is issued as ONE
 * `db.batch([...])` call. `db.batch` on this codebase's Neon HTTP driver is
 * one transaction (the same fact `lib/db/sync.ts` and `lib/db/sync-v2.ts`
 * already rely on, stated in their own header comments) — if ANY statement
 * in the array fails, NOTHING in that attempt's array lands: the candidate
 * stays exactly as it was (status, revision, and `threadSlug` all
 * unchanged), so a promoted candidate can never exist without its thread
 * reference (this task's acceptance criterion 2). The thread insert is
 * deliberately the LAST statement in each attempt's array specifically so a
 * failure there proves the two kinds of updates ahead of it (which,
 * unbatched, WOULD have already landed) are rolled back too.
 *
 * SLUG COLLISION HANDLING (MOTIFTHREAD-001, replacing RADARPERSIST-001's
 * deterministic-slug workaround): the thread slug is no longer forced to
 * equal `candidate.normalizedKey`. It tries `candidateThreadSlug(label, 0)`
 * (the plain slugified label) first; if that specific attempt's batch fails
 * with a real `threads (userId, slug)` primary-key collision (SQLSTATE
 * 23505) — the learner already has an unrelated thread by that name, or a
 * genuine concurrent promotion race — it retries the WHOLE batch with the
 * next numbered variant ("label-2", "label-3", ...), up to
 * `MAX_THREAD_SLUG_ATTEMPTS` real attempts. Each attempt is independently
 * atomic (its own `db.batch` call, its own rollback on failure), so a
 * learner who already has a same-named thread now gets promoted into a
 * differently-slugged thread instead of hitting an error (the bug this task
 * was filed to fix) — `MotifThreadSlugCollisionError` is thrown only if
 * every attempt up to the bound collides.
 *
 * `userId` is trusted from the caller, exactly like every other
 * `lib/db/*.ts` module in this codebase (`threads.ts`, `entries.ts`): this
 * function does not re-derive or re-verify that `userId` owns `workspaceId`
 * — the caller must have already done that (e.g. via
 * `assertWorkspaceOwnership`) before reaching here. `threads` (v1) is keyed
 * by `(userId, slug)`, not by workspace, which is why `userId` is a required
 * parameter here even though every other argument is workspace-scoped.
 */
export async function promoteMotifCandidate(
  workspaceId: string,
  userId: string,
  candidateId: string,
  options: { learnerConfirmed: boolean },
): Promise<PromoteMotifCandidateResult> {
  if (options.learnerConfirmed !== true) {
    throw new MotifPromotionNotConfirmedError();
  }

  const db = await getDb();

  const [candidate] = await db
    .select({
      id: motifCandidates.id,
      status: motifCandidates.status,
      label: motifCandidates.label,
      normalizedKey: motifCandidates.normalizedKey,
      revision: motifCandidates.revision,
    })
    .from(motifCandidates)
    .where(
      and(
        eq(motifCandidates.id, candidateId),
        eq(motifCandidates.workspaceId, workspaceId),
        isNull(motifCandidates.deletedAt),
      ),
    )
    .limit(1);
  if (!candidate) throw new MotifCandidateNotFoundError(candidateId);
  if (candidate.status !== MOTIF_CANDIDATE_PENDING_STATUS) {
    throw new MotifPromotionAlreadyResolvedError(candidateId, candidate.status);
  }

  const sightings = await db
    .select({ id: motifSightings.id, revision: motifSightings.revision })
    .from(motifSightings)
    .where(
      and(
        eq(motifSightings.candidateId, candidateId),
        eq(motifSightings.workspaceId, workspaceId),
        isNull(motifSightings.deletedAt),
      ),
    );
  if (sightings.length < MOTIF_CANDIDATE_MIN_SIGHTINGS) {
    throw new MotifPromotionInsufficientSightingsError(candidateId, sightings.length);
  }

  const now = new Date().toISOString();

  for (let attempt = 0; attempt < MAX_THREAD_SLUG_ATTEMPTS; attempt += 1) {
    const threadSlug = candidateThreadSlug(candidate.label, attempt);
    try {
      await db.batch([
        db
          .update(motifCandidates)
          .set({
            status: MOTIF_CANDIDATE_PROMOTED_STATUS,
            threadSlug,
            revision: candidate.revision + 1,
            updatedAt: now,
          })
          .where(and(eq(motifCandidates.id, candidateId), eq(motifCandidates.workspaceId, workspaceId))),
        ...sightings.map((sighting) =>
          db
            .update(motifSightings)
            .set({ status: MOTIF_SIGHTING_PROMOTED_STATUS, revision: sighting.revision + 1, updatedAt: now })
            .where(and(eq(motifSightings.id, sighting.id), eq(motifSightings.workspaceId, workspaceId))),
        ),
        db.insert(threadsTable).values({
          userId,
          slug: threadSlug,
          title: candidate.label,
          definition: "",
          seeing: "",
          createdAt: now,
          updatedAt: now,
        }),
      ] as Parameters<typeof db.batch>[0]);

      return { threadSlug, threadTitle: candidate.label, sightingCount: sightings.length };
    } catch (error) {
      if (!hasDatabaseErrorCode(error, "23505")) throw error;
      // This attempt's batch rolled back in full (nothing above landed);
      // fall through and retry with the next numbered slug variant.
    }
  }

  throw new MotifThreadSlugCollisionError(candidate.label, MAX_THREAD_SLUG_ATTEMPTS);
}
