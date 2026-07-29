/**
 * Server-only access to web/data/seed/*.json — the vault import produced by
 * tools/import_vault.py.
 *
 * The `server-only` import makes this a build error if anything ever tries
 * to pull it into a Client Component. That matters here specifically:
 * entries.json holds Ken's actual observations and questions, and a client
 * bundle importing it would ship the raw text into a publicly-fetchable
 * /_next/static/ JS chunk — unauthenticated, regardless of proxy.ts, because
 * static assets aren't page navigations. Server Components may pass computed
 * *results* down as props (that travels over the authenticated page
 * response); they must never pass the raw seed data itself.
 *
 * This is a bridge. Track B's `stages`/`threads`/`entries`/`people` tables
 * are the intended home for this data — once Neon is connected and a seed
 * script loads these JSON files into Postgres for Ken's user row, the Climb
 * and Review screens should read from the API instead of this file. See
 * PROGRESS.md "Seed bridge" for the handoff.
 */
import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const SEED_DIR = path.join(process.cwd(), "data", "seed");

interface SeedStage {
  slug: string;
  title: string;
  stage: number;
  side: "ascent" | "peak" | "descent";
  mirror: string | null;
  chapters: string[];
  summary: string;
}

interface SeedThread {
  slug: string;
  title: string;
  definition: string;
  seeing: string;
}

interface SeedPerson {
  slug: string;
  name: string;
  body: string;
  chapters: string[];
  threads: string[];
}

type SeedEntryKind = "observation" | "question" | "note" | "teaching";

interface SeedEntry {
  kind: SeedEntryKind;
  body: string;
  chapter: string;
  threads: string[];
  answeredAt?: string | null;
}

let cache: {
  stages: SeedStage[];
  threads: SeedThread[];
  people: SeedPerson[];
  entries: SeedEntry[];
} | null = null;

async function readJson<T>(file: string): Promise<T> {
  const raw = await readFile(path.join(SEED_DIR, file), "utf-8");
  return JSON.parse(raw) as T;
}

async function loadSeed() {
  if (!cache) {
    const [stages, threads, people, entries] = await Promise.all([
      readJson<SeedStage[]>("stages.json"),
      readJson<SeedThread[]>("threads.json"),
      readJson<SeedPerson[]>("people.json"),
      readJson<SeedEntry[]>("entries.json"),
    ]);
    cache = { stages, threads, people, entries };
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Computed views — the pieces allowed to leave this module as props.
// ---------------------------------------------------------------------------

export interface MountainStage {
  slug: string;
  title: string;
  reference: string;
  short: string;
  stage: number;
  side: "ascent" | "peak" | "descent";
  mirror: string | null;
  /** RefKey of the stage's opening chapter, e.g. "1.3" -- Mountain links here. */
  firstChapter: string | null;
  threadCount: number;
  observationCount: number;
  questionCount: number;
  studied: boolean;
}

function splitLabel(title: string): { reference: string; short: string } {
  for (const dash of [" — ", " – ", " - "]) {
    const idx = title.indexOf(dash);
    if (idx !== -1) {
      return { reference: title.slice(0, idx).trim(), short: title.slice(idx + dash.length).trim() };
    }
  }
  return { reference: title, short: "" };
}

export async function getMountain(): Promise<MountainStage[]> {
  const { stages, entries } = await loadSeed();

  const threadsByStage = new Map<string, Set<string>>();
  const obsByStage = new Map<string, number>();
  const qByStage = new Map<string, number>();

  // Entries are anchored to a chapter (stage's opening chapter, per the
  // importer's documented approximation), so we key back to the stage via
  // that same anchor rather than storing a stage slug on the entry.
  const anchorToStage = new Map(stages.filter((s) => s.chapters[0]).map((s) => [s.chapters[0], s.slug]));

  for (const entry of entries) {
    const slug = anchorToStage.get(entry.chapter);
    if (!slug) continue;
    if (entry.kind === "observation") obsByStage.set(slug, (obsByStage.get(slug) ?? 0) + 1);
    // Matches getReview()'s own definition of "open" below -- an answered
    // question isn't open, and the mountain's tooltip and getReview()'s count
    // must not disagree about what "open questions" means.
    if (entry.kind === "question" && !entry.answeredAt) {
      qByStage.set(slug, (qByStage.get(slug) ?? 0) + 1);
    }
    if (!threadsByStage.has(slug)) threadsByStage.set(slug, new Set());
    entry.threads.forEach((t) => threadsByStage.get(slug)!.add(t));
  }

  return stages
    .map((stage) => {
      const { reference, short } = splitLabel(stage.title);
      return {
        slug: stage.slug,
        title: stage.title,
        reference,
        short,
        stage: stage.stage,
        side: stage.side,
        mirror: stage.mirror,
        firstChapter: stage.chapters[0] ?? null,
        threadCount: threadsByStage.get(stage.slug)?.size ?? 0,
        observationCount: obsByStage.get(stage.slug) ?? 0,
        questionCount: qByStage.get(stage.slug) ?? 0,
        // "Studied" per the vault's own definition (My notes written) isn't
        // captured by the importer yet -- every seeded stage has bullets
        // under Observation but nothing under My notes, so this is honestly
        // false for all eleven right now. Left explicit rather than guessed.
        studied: false,
      };
    })
    .sort((a, b) => a.stage - b.stage);
}

export interface ThreadStrength {
  slug: string;
  title: string;
  definition: string;
  inbound: number;
}

export interface ReviewData {
  chaptersRead: number;
  totalChapters: number;
  stagesStudied: number;
  totalStages: number;
  openQuestions: number;
  threads: ThreadStrength[];
  coldThreads: string[];
  orphanPeople: string[];
  mirrorBreaks: { stage: string; issue: string }[];
}

export async function getReview(): Promise<ReviewData> {
  const { stages, threads, entries, people } = await loadSeed();

  const inbound = new Map<string, number>();
  for (const entry of entries) {
    for (const slug of entry.threads) inbound.set(slug, (inbound.get(slug) ?? 0) + 1);
  }

  const threadRows: ThreadStrength[] = threads
    .map((t) => ({ slug: t.slug, title: t.title, definition: t.definition, inbound: inbound.get(t.slug) ?? 0 }))
    .sort((a, b) => b.inbound - a.inbound || a.title.localeCompare(b.title));

  const stagesBySlug = new Map(stages.map((s) => [s.slug, s]));
  const mirrorBreaks: ReviewData["mirrorBreaks"] = [];
  for (const stage of stages) {
    if (!stage.mirror) continue;
    const partner = stagesBySlug.get(stage.mirror);
    if (!partner) {
      mirrorBreaks.push({ stage: stage.title, issue: `mirror '${stage.mirror}' not found` });
    } else if (partner.mirror !== stage.slug) {
      mirrorBreaks.push({ stage: stage.title, issue: `'${partner.title}' does not point back` });
    }
  }

  return {
    chaptersRead: 0, // wide-gear tracker isn't wired to the seed yet -- see Wide Gear tracker note
    totalChapters: 1189,
    stagesStudied: 0,
    totalStages: stages.length,
    openQuestions: entries.filter((e) => e.kind === "question" && !e.answeredAt).length,
    threads: threadRows,
    coldThreads: threadRows.filter((t) => t.inbound === 0).map((t) => t.title),
    orphanPeople: people.filter((p) => p.chapters.length === 0 && p.threads.length === 0).map((p) => p.name),
    mirrorBreaks,
  };
}

// ---------------------------------------------------------------------------
// Thread radar — "you've noticed X in three passages, is this becoming a
// thread?" per the guide's own rule (make a thread on the THIRD sighting,
// not the first). Deliberately NOT an AI feature: no model, no summarizing,
// no interpretation. Just word frequency across entries that don't already
// share a thread covering that word -- the same kind of noticing the guide
// asks a human to do, done at the scale of "read your own writing back."
//
// Honest limitation: today's seed data assigns threads at STAGE granularity
// (every entry in a stage inherits all of that stage's declared threads),
// not per-entry, so almost every entry already carries 2-4 broad thread
// tags and there's little truly untagged text to find a pattern in. This
// will get more useful once live capture (real per-entry thread selection)
// replaces the seed bridge -- the mechanism is what matters being correct
// now, not today's output being exciting.
// ---------------------------------------------------------------------------

// Verified against the real 70-entry seed: the first pass here surfaced
// "genesis" and "between" as top "patterns", which is noise, not signal.
// Fixed by extending this list and excluding the 66 book names below --
// self-reference to what book you're reading is not an emerging thread.
const STOPWORDS = new Set([
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

const BOOK_NAMES = new Set([
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
function normaliseWord(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export interface RadarHit {
  word: string;
  /** Distinct entries the word appears in. */
  count: number;
  /** Chapters those entries are anchored to, for display. */
  chapters: string[];
}

export async function getThreadRadar(): Promise<RadarHit[]> {
  const { entries, threads } = await loadSeed();

  const threadTitleWords = new Set(
    threads.flatMap((t) => t.title.toLowerCase().split(/[^a-z]+/).filter(Boolean)),
  );

  // word -> distinct entries (by index) that mention it AND don't already
  // carry a thread whose own title is that same word.
  const hits = new Map<string, { entryIndexes: Set<number>; chapters: Set<string> }>();

  entries.forEach((entry, index) => {
    if (entry.kind !== "observation" && entry.kind !== "question") return;
    const entryThreadTitleWords = new Set(
      entry.threads
        .map((slug) => threads.find((t) => t.slug === slug)?.title.toLowerCase())
        .filter((title): title is string => Boolean(title)),
    );

    const words = new Set(
      entry.body
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 5 && !STOPWORDS.has(w) && !BOOK_NAMES.has(w) && !threadTitleWords.has(w))
        .map(normaliseWord),
    );

    for (const word of words) {
      // Already named by one of THIS entry's own threads -- not emerging, named.
      if (entryThreadTitleWords.has(word)) continue;
      if (!hits.has(word)) hits.set(word, { entryIndexes: new Set(), chapters: new Set() });
      const hit = hits.get(word)!;
      hit.entryIndexes.add(index);
      hit.chapters.add(entry.chapter);
    }
  });

  return Array.from(hits.entries())
    .filter(([, hit]) => hit.entryIndexes.size >= 2)
    .map(([word, hit]) => ({ word, count: hit.entryIndexes.size, chapters: Array.from(hit.chapters) }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// Teaching — the guide's Sunday-review step 3: "find one thing worth
// teaching." Read-only for now. There is no capture UI for this yet because
// there is nowhere live to write it TO -- Neon isn't connected, so a capture
// form here would be an unverifiable write path (see PROGRESS.md). This
// exists so the surface is ready and correct the moment that changes.
// ---------------------------------------------------------------------------

export interface TeachingEntry {
  body: string;
  chapter: string;
  threads: string[];
}

export async function getTeaching(): Promise<TeachingEntry[]> {
  const { entries } = await loadSeed();
  return entries
    .filter((e) => e.kind === "teaching")
    .map((e) => ({ body: e.body, chapter: e.chapter, threads: e.threads }));
}
