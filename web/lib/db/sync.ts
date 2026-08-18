import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ZodType } from "zod";

import {
  entries,
  entryThreads,
  dailyLogs,
  people,
  readingProgress,
  syncReceipts,
  threads,
} from "@/db/schema";
import {
  syncEntrySchema,
  syncLogSchema,
  syncPersonSchema,
  syncProgressSchema,
  syncThreadSchema,
} from "@/lib/api/sync";
import type { SyncOp, SyncResponse } from "@/lib/contracts";
import { db } from "@/lib/db";
import {
  toIsoTimestamp,
  toOptionalIsoTimestamp,
} from "@/lib/db/time";

function isNewer(incoming: string, current: string) {
  return Date.parse(incoming) > Date.parse(current);
}

async function hasReceipt(userId: string, opId: string) {
  const [receipt] = await db
    .select({ opId: syncReceipts.opId })
    .from(syncReceipts)
    .where(
      and(eq(syncReceipts.userId, userId), eq(syncReceipts.opId, opId)),
    )
    .limit(1);
  return Boolean(receipt);
}

function receiptInsert(
  userId: string,
  op: SyncOp,
) {
  return db
    .insert(syncReceipts)
    .values({
      opId: op.id,
      userId,
      entity: op.entity,
      entityId: op.entityId,
      clientUpdatedAt: op.updatedAt,
    })
    .onConflictDoNothing();
}

async function recordReceipt(
  userId: string,
  op: SyncOp,
) {
  await receiptInsert(userId, op);
}

/**
 * Validates an operation against its own payload before anything is written.
 *
 * `timestampFromPayload` names the payload field carrying the client timestamp
 * that `op.updatedAt` must equal. It defaults to `updatedAt`, which every sync
 * payload schema declares except `progress`: `ReadingProgress` is a frozen v1
 * contract of exactly `{ chapter, readAt }` (`lib/contracts.ts:162-165`) and
 * `syncProgressSchema` also types the pull response, so an `updatedAt` field
 * cannot be added to the wire payload without changing the stored contract.
 * For progress, `readAt` IS the update timestamp, so `applyProgress` passes it
 * here. The cross-check therefore stays enforced for every entity instead of
 * being waived for one, and last-write-wins is unchanged for entries, threads,
 * people, and logs.
 *
 * The default is fail-closed: a payload carrying neither field yields
 * `undefined !== op.updatedAt` and the operation is rejected.
 */
function parsePayload<T>(
  schema: ZodType<T>,
  op: SyncOp,
  idFromPayload: (payload: T) => string,
  timestampFromPayload: (payload: T) => string | undefined = (payload) =>
    (payload as { updatedAt?: string }).updatedAt,
) {
  const parsed = schema.safeParse(op.payload);
  if (!parsed.success) {
    throw new Error(`Invalid ${op.entity} payload`);
  }
  if (idFromPayload(parsed.data) !== op.entityId) {
    throw new Error("Operation entityId does not match its payload");
  }
  if (timestampFromPayload(parsed.data) !== op.updatedAt) {
    throw new Error("Operation timestamp does not match its payload");
  }
  return parsed.data;
}

async function applyEntry(userId: string, op: SyncOp) {
  const payload = parsePayload(syncEntrySchema, op, (entry) => entry.id);
  const [current] = await db
    .select({ userId: entries.userId, updatedAt: entries.updatedAt })
    .from(entries)
    .where(eq(entries.id, payload.id))
    .limit(1);

  if (current?.userId !== undefined && current.userId !== userId) {
    throw new Error("Entry ID belongs to another user");
  }
  if (current && isNewer(current.updatedAt, payload.updatedAt)) {
    await recordReceipt(userId, op);
    return;
  }

  const deletedAt =
    op.op === "delete" ? payload.deletedAt ?? op.updatedAt : payload.deletedAt;
  const uniqueThreads = [...new Set(payload.threads)];
  if (!deletedAt && uniqueThreads.length > 0) {
    const known = await db
      .select({ slug: threads.slug })
      .from(threads)
      .where(
        and(
          eq(threads.userId, userId),
          inArray(threads.slug, uniqueThreads),
          isNull(threads.deletedAt),
        ),
      );
    if (known.length !== uniqueThreads.length) {
      throw new Error("Entry references an unknown thread");
    }
  }

  const writeEntry = db
    .insert(entries)
    .values({
      id: payload.id,
      userId,
      kind: payload.kind,
      body: payload.body,
      chapter: payload.chapter,
      verse: payload.verse ?? null,
      answeredAt: payload.answeredAt ?? null,
      inkUrl: payload.inkUrl ?? null,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      deletedAt: deletedAt ?? null,
    })
    .onConflictDoUpdate({
      target: entries.id,
      set: {
        kind: payload.kind,
        body: payload.body,
        chapter: payload.chapter,
        verse: payload.verse ?? null,
        answeredAt: payload.answeredAt ?? null,
        inkUrl: payload.inkUrl ?? null,
        updatedAt: payload.updatedAt,
        deletedAt: deletedAt ?? null,
      },
    });

  const removeLinks = db
    .delete(entryThreads)
    .where(
      and(
        eq(entryThreads.userId, userId),
        eq(entryThreads.entryId, payload.id),
      ),
    );

  if (uniqueThreads.length === 0 || deletedAt) {
    await db.batch([
      writeEntry,
      removeLinks,
      receiptInsert(userId, op),
    ]);
  } else {
    await db.batch([
      writeEntry,
      removeLinks,
      db.insert(entryThreads).values(
        uniqueThreads.map((threadSlug) => ({
          entryId: payload.id,
          userId,
          threadSlug,
        })),
      ),
      receiptInsert(userId, op),
    ]);
  }
}

async function applyThread(userId: string, op: SyncOp) {
  const payload = parsePayload(syncThreadSchema, op, (thread) => thread.slug);
  const [current] = await db
    .select()
    .from(threads)
    .where(
      and(eq(threads.userId, userId), eq(threads.slug, payload.slug)),
    )
    .limit(1);

  if (current && !isNewer(payload.updatedAt, current.updatedAt)) {
    await recordReceipt(userId, op);
    return;
  }

  const deletedAt =
    op.op === "delete" ? payload.deletedAt ?? op.updatedAt : payload.deletedAt;
  if (deletedAt) {
    const [linked] = await db
      .select({ entryId: entryThreads.entryId })
      .from(entryThreads)
      .innerJoin(
        entries,
        and(
          eq(entries.id, entryThreads.entryId),
          eq(entries.userId, entryThreads.userId),
          isNull(entries.deletedAt),
        ),
      )
      .where(
        and(
          eq(entryThreads.userId, userId),
          eq(entryThreads.threadSlug, payload.slug),
        ),
      )
      .limit(1);
    if (linked) {
      throw new Error("Thread is still linked to active writing");
    }
  }
  await db
    .insert(threads)
    .values({
      userId,
      slug: payload.slug,
      title: payload.title,
      definition: payload.definition,
      seeing: payload.seeing,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      deletedAt: deletedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [threads.userId, threads.slug],
      set: {
        title: payload.title,
        definition: payload.definition,
        seeing: payload.seeing,
        updatedAt: payload.updatedAt,
        deletedAt: deletedAt ?? null,
      },
    });

  await recordReceipt(userId, op);
}

async function applyProgress(userId: string, op: SyncOp) {
  if (op.op === "delete") {
    throw new Error("Reading progress is monotonic and cannot be deleted");
  }
  const payload = parsePayload(
    syncProgressSchema,
    op,
    (progress) => progress.chapter,
    // `readAt` is this entity's update timestamp; see parsePayload. Passing it
    // keeps the op/payload timestamp cross-check enforced for progress, which
    // the removed local copy of this check could never reach.
    (progress) => progress.readAt,
  );
  const [current] = await db
    .select()
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.userId, userId),
        eq(readingProgress.chapter, payload.chapter),
      ),
    )
    .limit(1);
  if (current && !isNewer(payload.readAt, current.readAt)) {
    await recordReceipt(userId, op);
    return;
  }
  await db
    .insert(readingProgress)
    .values({ userId, chapter: payload.chapter, readAt: payload.readAt })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.chapter],
      set: { readAt: payload.readAt },
    });
  await recordReceipt(userId, op);
}

async function applyLog(userId: string, op: SyncOp) {
  if (op.op === "delete") {
    throw new Error("Daily logs cannot be deleted through sync");
  }
  const payload = parsePayload(syncLogSchema, op, (log) => log.date);
  const [current] = await db
    .select()
    .from(dailyLogs)
    .where(
      and(eq(dailyLogs.userId, userId), eq(dailyLogs.date, payload.date)),
    )
    .limit(1);
  if (current && !isNewer(payload.updatedAt, current.updatedAt)) {
    await recordReceipt(userId, op);
    return;
  }
  await db
    .insert(dailyLogs)
    .values({
      userId,
      date: payload.date,
      chapter: payload.chapter,
      ...payload.steps,
      sentence: payload.sentence,
      carrying: payload.carrying,
      prayer: payload.prayer,
      updatedAt: payload.updatedAt,
    })
    .onConflictDoUpdate({
      target: [dailyLogs.userId, dailyLogs.date],
      set: {
        chapter: payload.chapter,
        ...payload.steps,
        sentence: payload.sentence,
        carrying: payload.carrying,
        prayer: payload.prayer,
        updatedAt: payload.updatedAt,
      },
    });
  await recordReceipt(userId, op);
}

async function applyPerson(userId: string, op: SyncOp) {
  if (op.op === "delete") {
    throw new Error("Person deletion is not represented by the shared contract");
  }
  const payload = parsePayload(syncPersonSchema, op, (person) => person.slug);
  const [current] = await db
    .select()
    .from(people)
    .where(and(eq(people.userId, userId), eq(people.slug, payload.slug)))
    .limit(1);
  if (current && !isNewer(payload.updatedAt, current.updatedAt)) {
    await recordReceipt(userId, op);
    return;
  }
  await db
    .insert(people)
    .values({
      userId,
      slug: payload.slug,
      name: payload.name,
      body: payload.body,
      chapters: payload.chapters,
      threadSlugs: payload.threads,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    })
    .onConflictDoUpdate({
      target: [people.userId, people.slug],
      set: {
        name: payload.name,
        body: payload.body,
        chapters: payload.chapters,
        threadSlugs: payload.threads,
        updatedAt: payload.updatedAt,
        deletedAt: null,
      },
    });
  await recordReceipt(userId, op);
}

export async function pushSyncOps(userId: string, ops: SyncOp[]) {
  const rejected: SyncResponse["rejected"] = [];

  for (const op of ops) {
    if (await hasReceipt(userId, op.id)) continue;
    try {
      if (op.entity === "thread") {
        await applyThread(userId, op);
      } else if (op.entity === "entry") {
        await applyEntry(userId, op);
      } else if (op.entity === "progress") {
        await applyProgress(userId, op);
      } else if (op.entity === "log") {
        await applyLog(userId, op);
      } else if (op.entity === "person") {
        await applyPerson(userId, op);
      } else {
        throw new Error(`${op.entity} sync is not implemented yet`);
      }
    } catch (error) {
      rejected.push({
        id: op.id,
        reason: error instanceof Error ? error.message : "Unknown sync failure",
      });
    }
  }

  return rejected;
}

export async function pullSyncChanges(
  userId: string,
  since: string | null,
): Promise<Omit<SyncResponse, "rejected">> {
  // We currently return the full user-owned snapshot on every pull. Client
  // timestamps drive conflict
  // resolution, but they are not safe database cursors because a clock-skewed
  // write can commit after a cursor advances. The dataset is intentionally
  // single-user and small, and a complete snapshot makes such a late commit
  // visible on the next sync instead of losing it permanently.
  void since;
  const serverTime = new Date().toISOString();
  const entryConditions = [eq(entries.userId, userId)];
  const threadConditions = [eq(threads.userId, userId)];
  const progressConditions = [eq(readingProgress.userId, userId)];
  const logConditions = [eq(dailyLogs.userId, userId)];
  const personConditions = [
    eq(people.userId, userId),
    isNull(people.deletedAt),
  ];
  // Neon HTTP batch executes these statements in one transaction. Reading
  // entries and their backlinks in the same snapshot prevents a concurrent
  // entry edit from producing a transient active-but-threadless response.
  const [entryLinkRows, threadRows, progressRows, logRows, peopleRows] =
    await db.batch([
      db
        .select({
          entry: entries,
          threadSlug: entryThreads.threadSlug,
        })
        .from(entries)
        .leftJoin(
          entryThreads,
          and(
            eq(entryThreads.entryId, entries.id),
            eq(entryThreads.userId, entries.userId),
          ),
        )
        .where(and(...entryConditions)),
      db
        .select()
        .from(threads)
        .where(and(...threadConditions)),
      db
        .select()
        .from(readingProgress)
        .where(and(...progressConditions)),
      db.select().from(dailyLogs).where(and(...logConditions)),
      db.select().from(people).where(and(...personConditions)),
    ]);

  const entryRows = new Map<
    string,
    { entry: (typeof entryLinkRows)[number]["entry"]; threads: string[] }
  >();
  for (const row of entryLinkRows) {
    const grouped = entryRows.get(row.entry.id) ?? {
      entry: row.entry,
      threads: [],
    };
    if (row.threadSlug) grouped.threads.push(row.threadSlug);
    entryRows.set(row.entry.id, grouped);
  }

  const linksByEntry = new Map<string, string[]>();
  for (const [entryId, grouped] of entryRows) {
    linksByEntry.set(entryId, grouped.threads);
  }

  return {
    serverTime,
    entries: [...entryRows.values()].map(({ entry: row }) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      chapter: row.chapter,
      ...(row.verse ? { verse: row.verse } : {}),
      threads: linksByEntry.get(row.id) ?? [],
      answeredAt: toOptionalIsoTimestamp(row.answeredAt),
      ...(row.inkUrl ? { inkUrl: row.inkUrl } : {}),
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
      deletedAt: toOptionalIsoTimestamp(row.deletedAt),
    })),
    threads: threadRows.map((row) => ({
      slug: row.slug,
      title: row.title,
      definition: row.definition,
      seeing: row.seeing,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
      deletedAt: toOptionalIsoTimestamp(row.deletedAt),
    })),
    people: peopleRows.map((row) => ({
      slug: row.slug,
      name: row.name,
      body: row.body,
      chapters: row.chapters,
      threads: row.threadSlugs,
      createdAt: toIsoTimestamp(row.createdAt),
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
    progress: progressRows.map((row) => ({
      chapter: row.chapter,
      readAt: toIsoTimestamp(row.readAt),
    })),
    logs: logRows.map((row) => ({
      date: row.date,
      chapter: row.chapter,
      steps: {
        read: row.read,
        observe: row.observe,
        link: row.link,
        ask: row.ask,
        pray: row.pray,
      },
      sentence: row.sentence,
      carrying: row.carrying,
      prayer: row.prayer,
      updatedAt: toIsoTimestamp(row.updatedAt),
    })),
  };
}
