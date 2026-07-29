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
