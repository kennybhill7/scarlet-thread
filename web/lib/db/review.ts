import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import {
  dailyLogs,
  entries,
  entryThreads,
  readingProgress,
  stages,
  threads,
} from "@/db/schema";
import type { ReviewSnapshot } from "@/lib/contracts";
import { db } from "@/lib/db";

function recentRhythm(dates: string[]) {
  const unique = [...new Set(dates)].sort().reverse();
  if (unique.length === 0) return 0;
  let count = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const previous = Date.parse(`${unique[index - 1]}T00:00:00Z`);
    const current = Date.parse(`${unique[index]}T00:00:00Z`);
    if (previous - current !== 86_400_000) break;
    count += 1;
  }
  return count;
}

export async function getReviewSnapshot(
  userId: string,
): Promise<ReviewSnapshot> {
  const [entryRows, threadRows, linkRows, stageRows, progressRows, logRows] =
    await Promise.all([
      db
        .select()
        .from(entries)
        .where(and(eq(entries.userId, userId), isNull(entries.deletedAt))),
      db
        .select()
        .from(threads)
        .where(and(eq(threads.userId, userId), isNull(threads.deletedAt))),
      db
        .select({
          entryId: entryThreads.entryId,
          threadSlug: entryThreads.threadSlug,
        })
        .from(entryThreads)
        .where(eq(entryThreads.userId, userId)),
      db.select().from(stages),
      db
        .select()
        .from(readingProgress)
        .where(eq(readingProgress.userId, userId)),
      db.select().from(dailyLogs).where(eq(dailyLogs.userId, userId)),
    ]);

  const activeEntryIds = new Set(entryRows.map((entry) => entry.id));
  const activeThreadSlugs = new Set(threadRows.map((thread) => thread.slug));
  const activeLinks = linkRows.filter(
    (link) =>
      activeEntryIds.has(link.entryId) &&
      activeThreadSlugs.has(link.threadSlug),
  );
  const inbound = new Map<string, number>();
  const linkedEntries = new Set<string>();
  for (const link of activeLinks) {
    inbound.set(link.threadSlug, (inbound.get(link.threadSlug) ?? 0) + 1);
    linkedEntries.add(link.entryId);
  }

  const studiedChapters = new Set(entryRows.map((entry) => entry.chapter));
  const stagesBySlug = new Map(stageRows.map((stage) => [stage.slug, stage]));
  const mirrorBreaks: ReviewSnapshot["mirrorBreaks"] = [];
  for (const stage of stageRows) {
    if (!stage.mirror) continue;
    const partner = stagesBySlug.get(stage.mirror);
    if (!partner) {
      mirrorBreaks.push({
        stage: stage.slug,
        issue: `Mirror '${stage.mirror}' does not exist`,
      });
    } else if (partner.mirror !== stage.slug) {
      mirrorBreaks.push({
        stage: stage.slug,
        issue: `Mirror '${stage.mirror}' does not point back`,
      });
    }
  }

  const threadStrength = threadRows
    .map((thread) => ({
      slug: thread.slug,
      title: thread.title,
      inbound: inbound.get(thread.slug) ?? 0,
    }))
    .sort((a, b) => b.inbound - a.inbound || a.title.localeCompare(b.title));

  return {
    chaptersRead: progressRows.length,
    totalChapters: 1_189,
    stagesStudied: stageRows.filter((stage) =>
      stage.chapters.some((chapter) => studiedChapters.has(chapter)),
    ).length,
    totalStages: stageRows.length,
    openQuestions: entryRows.filter(
      (entry) => entry.kind === "question" && !entry.answeredAt,
    ).length,
    // This is consecutive activity ending at the most recent study day, not
    // a today-gated streak. Missing a day never turns the UI into a warning.
    streak: recentRhythm(
      logRows
        .filter((log) => Object.values({
          read: log.read,
          observe: log.observe,
          link: log.link,
          ask: log.ask,
          pray: log.pray,
        }).some(Boolean))
        .map((log) => log.date),
    ),
    threads: threadStrength,
    coldThreads: threadStrength
      .filter((thread) => thread.inbound === 0)
      .map((thread) => thread.slug),
    orphanEntries: entryRows
      .filter((entry) => !linkedEntries.has(entry.id))
      .map((entry) => entry.id),
    mirrorBreaks,
  };
}
