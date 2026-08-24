/**
 * Shared contracts between Track A (read path) and Track B (write path).
 *
 * This file is the interface between the two builders. Treat it as a public API:
 * additive changes are fine, renames and removals require both tracks to agree.
 *
 * Owned by Track A. Frozen after Phase 0.
 */

// ---------------------------------------------------------------------------
// Scripture — static, immutable, ships as JSON in /public/bible
// ---------------------------------------------------------------------------

/**
 * Translation identifiers. All five are public domain or released for free use.
 * SBL (Santa Biblia libre Latinoamericano) is Spanish, Latin American dialect —
 * see tools/build_spanish.py for the licence source and tools/versification-report.md
 * for its two known verse-numbering divergences from BSB (Romans 14 & 16).
 */
export type VersionId = "BSB" | "KJV" | "ASV" | "YLT" | "SBL";

export interface VersionMeta {
  id: VersionId;
  name: string;
  /** Display name in the switcher, e.g. "Berean Standard". */
  short: string;
  year: string;
  /** Why we are permitted to redistribute it. Rendered in Settings. */
  licence: string;
  note: string;
  /** BCP-47-ish tag: "en" or "es". Drives which pane a version defaults into. */
  language: "en" | "es";
}

export interface BookMeta {
  /** 1-66, canonical order. Also the data filename: /bible/{version}/{n}.json */
  n: number;
  name: string;
  /** Short form used in references, e.g. "Gen", "1 Cor". */
  abbr: string;
  chapters: number;
  testament: "OT" | "NT";
}

/** /public/bible/index.json */
export interface BibleIndex {
  versions: VersionMeta[];
  default: VersionId;
  totalChapters: number; // 1189
  books: BookMeta[];
  /** Book number (as string key) -> Spanish display name. Written by build_spanish.py. */
  spanishNames?: Record<string, string>;
}

/** /public/bible/{version}/{bookNumber}.json — chapters, each an array of verses. */
export interface BookData {
  b: string;
  c: string[][];
}

/** A single verse address. Chapter and verse are 1-indexed. */
export interface VerseRef {
  book: number;
  chapter: number;
  verse: number;
}

/** A chapter address — the unit the reader and the daily loop work in. */
export interface ChapterRef {
  book: number;
  chapter: number;
}

/**
 * Canonical string form used as a database key and in URLs: "1.3.15" = Genesis 3:15,
 * "1.3" = Genesis 3. Parsing and formatting live in lib/bible/reference.ts (Track A).
 */
export type RefKey = string;

// ---------------------------------------------------------------------------
// The vault — Ken's writing. Lives in IndexedDB, syncs to Postgres.
// ---------------------------------------------------------------------------

/**
 * The four kinds of writing the daily loop produces.
 * - observation: something noticed, not a summary. Step 2 of the loop.
 * - question:    a live question. Step 4. Questions stay open until closed.
 * - note:        free writing, the old "## My notes" section.
 * - teaching:    something worth giving away. Sunday review, step 3.
 */
export type EntryKind = "observation" | "question" | "note" | "teaching";

export interface Entry {
  id: string;
  kind: EntryKind;
  body: string;
  /** Chapter this belongs to. Every entry has one. */
  chapter: RefKey;
  /** Optional verse anchor — the Maxwell-style note pinned to a specific verse. */
  verse?: RefKey;
  /** Thread slugs this entry links to. The reverse edge is written automatically. */
  threads: string[];
  /** Questions only: null while open. Answering is deliberate, never automatic. */
  answeredAt?: string | null;
  /** Link to an Apple Notes sketch. Ink stays in Notes; we only hold the pointer. */
  inkUrl?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Thread {
  /** kebab-case, stable, used in URLs: "seed-of-the-woman". */
  slug: string;
  title: string;
  /** The "In one line:" definition. */
  definition: string;
  /** Free writing — the old "## What I'm seeing". */
  seeing: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/**
 * One of the eleven mountain stages. Seeded from the vault; not user-created.
 * Chapter notes hang underneath via `chapters`.
 */
export interface Stage {
  slug: string;
  title: string;
  /** 1-11. Position on the mountain. */
  stage: number;
  side: "ascent" | "peak" | "descent";
  /** Slug of the mirror stage. Stage 1 mirrors 11, 2 mirrors 10, and so on. */
  mirror: string | null;
  /** Chapters this stage covers, as RefKeys. */
  chapters: RefKey[];
  summary: string;
}

/** A person note — Abraham, David, Noah. The Maxwell "profile" shape. */
export interface Person {
  slug: string;
  name: string;
  body: string;
  /** Chapters where they appear. */
  chapters: RefKey[];
  threads: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * Wide gear: cover-to-cover reading, tracked per chapter.
 * Deep gear (studied chapters) is derived from Entry presence, not stored here.
 */
export interface ReadingProgress {
  chapter: RefKey;
  readAt: string;
}

/** The five steps of the daily loop, per day. */
export interface DailyLog {
  /** ISO date, YYYY-MM-DD. One per day. */
  date: string;
  chapter: RefKey | null;
  steps: {
    read: boolean;
    observe: boolean;
    link: boolean;
    ask: boolean;
    pray: boolean;
  };
  sentence: string;
  carrying: string;
  prayer: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sync — Track B owns the engine; Track A writes ops into the queue.
// ---------------------------------------------------------------------------

export type SyncEntity = "entry" | "thread" | "person" | "progress" | "log" | "stage";

/**
 * One pending change. Single user across devices, so resolution is
 * last-write-wins on `updatedAt`. Do not build CRDTs for this.
 */
export interface SyncOp {
  id: string;
  entity: SyncEntity;
  entityId: string;
  op: "upsert" | "delete";
  payload: unknown;
  /** Client clock at the time of the change. Drives conflict resolution. */
  updatedAt: string;
  /** Set once the server has accepted it. Unsynced ops are retried on reconnect. */
  syncedAt?: string | null;
}

export interface SyncPullRequest {
  since: string | null;
}

export interface SyncPushRequest {
  ops: SyncOp[];
}

export interface SyncResponse {
  serverTime: string;
  entries: Entry[];
  threads: Thread[];
  people: Person[];
  progress: ReadingProgress[];
  logs: DailyLog[];
  /** Ops the server rejected, with a reason. Surface these; never swallow them. */
  rejected: { id: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Review — computed, never stored. Port of build_map.py.
// ---------------------------------------------------------------------------

export interface ThreadStrength {
  slug: string;
  title: string;
  /** Entries linking in. The longest bar shows what has been recurring in the learner's own notes -- a count of note frequency, not a claim about where God is working. */
  inbound: number;
}

export interface ReviewSnapshot {
  chaptersRead: number;
  totalChapters: number;
  stagesStudied: number;
  totalStages: number;
  openQuestions: number;
  streak: number;
  threads: ThreadStrength[];
  /** Threads with nothing linking in, and entries linking to nothing. */
  coldThreads: string[];
  orphanEntries: string[];
  /** Stage pairs where the mirror does not point both ways. */
  mirrorBreaks: { stage: string; issue: string }[];
}

// ---------------------------------------------------------------------------
// Auth — Track B owns. Single user; this is a gate, not a platform.
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}
