/**
 * Thread radar — Phase 1 (RADAR-001, BUILD_PLAN.md §3.5).
 *
 * "You've noticed X in three passages, is this becoming a thread?" per the
 * guide's own rule (make a thread on the THIRD sighting, not the first).
 * Deliberately NOT an AI feature: no model, no summarizing, no
 * interpretation — word frequency across entries, at the scale of "read your
 * own writing back."
 *
 * SCOPE (read this before touching the shape below): `motif_candidates` and
 * `motif_sightings` (THEOLOGY_MASTER_BUILD_PLAN.md §12.3) are SCHEMAV2-001's
 * tables, built in parallel with this task, and do NOT exist on this branch
 * — confirmed by grep, zero "motif" references in `db/schema.ts` as of this
 * commit. This module is a PURE FUNCTION over already-fetched
 * entries/threads that returns motif-candidate-SHAPED values; it never reads
 * or writes a table. Persisting a candidate, deduping it against previously
 * dismissed/promoted candidates, and the promotion-into-a-thread transaction
 * are later tasks' work once those tables land.
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
import type { Entry, Thread } from "@/lib/contracts";
import type { MotifCandidate } from "@/lib/contracts/study-v2";

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
 * either planning document (`lib/contracts/study-v2.ts` gap #3) — this
 * module does not invent an enum either; `"candidate"` is a plain string,
 * not a member of a closed type.
 */
const PENDING_STATUS = "candidate";

/** Cap on how many candidates one render surfaces — carried over from the
 * pre-existing radar UI so the section's length doesn't change shape. */
const MAX_CANDIDATES = 8;

/**
 * Pure function: no database read, no side effects. Callers (today,
 * `review/page.tsx`) fetch entries/threads themselves and pass them in.
 */
export function computeMotifCandidates(entries: Entry[], threads: Thread[]): RadarMotifCandidate[] {
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

  // word -> distinct PASSAGES (chapters) it appears in. Counting distinct
  // entries here would be wrong -- several entries can share one chapter
  // anchor, and a word said twice about the SAME passage is one sighting,
  // not two (A-045).
  const hits = new Map<string, Set<string>>();

  entries.forEach((entry) => {
    if (entry.kind !== "observation" && entry.kind !== "question") return;

    const words = entry.body
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 5 && !STOPWORDS.has(w) && !BOOK_NAMES.has(w) && !threadTitleWords.has(w))
      .map(normaliseWord);

    for (const word of words) {
      if (!hits.has(word)) hits.set(word, new Set());
      hits.get(word)!.add(entry.chapter);
    }
  });

  return Array.from(hits.entries())
    .filter(([, chapters]) => chapters.size >= MOTIF_CANDIDATE_MIN_SIGHTINGS)
    .map(([word, chapters]) => ({
      label: word,
      normalizedKey: word,
      status: PENDING_STATUS,
      passages: Array.from(chapters).sort(),
    }))
    .sort((a, b) => b.passages.length - a.passages.length || a.label.localeCompare(b.label))
    .slice(0, MAX_CANDIDATES);
}
