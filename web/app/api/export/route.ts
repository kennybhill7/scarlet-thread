import { and, eq, isNull } from "drizzle-orm";

import { dailyLogs, people } from "@/db/schema";
import { unauthorized, serverError } from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { listEntries } from "@/lib/db/entries";
import { listThreads } from "@/lib/db/threads";
import { toIsoTimestamp } from "@/lib/db/time";
import { buildVaultArchive } from "@/lib/export/vault";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    const userId = session.user.id;
    const [entries, threads, peopleRows, logRows] = await Promise.all([
      listEntries(userId, { includeDeleted: false }),
      listThreads(userId),
      db
        .select()
        .from(people)
        .where(and(eq(people.userId, userId), isNull(people.deletedAt))),
      db
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.userId, userId)),
    ]);

    const archive = buildVaultArchive({
      entries,
      threads,
      people: peopleRows.map((person) => ({
        slug: person.slug,
        name: person.name,
        body: person.body,
        chapters: person.chapters,
        threads: person.threadSlugs,
        createdAt: toIsoTimestamp(person.createdAt),
        updatedAt: toIsoTimestamp(person.updatedAt),
      })),
      logs: logRows.map((log) => ({
        date: log.date,
        chapter: log.chapter,
        steps: {
          read: log.read,
          observe: log.observe,
          link: log.link,
          ask: log.ask,
          pray: log.pray,
        },
        sentence: log.sentence,
        carrying: log.carrying,
        prayer: log.prayer,
        updatedAt: toIsoTimestamp(log.updatedAt),
      })),
    });

    return new Response(new Blob([archive]), {
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="bible-brain-vault.zip"',
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
