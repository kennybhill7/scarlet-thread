import "server-only";

import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";

import { entries, entryThreads, threads } from "@/db/schema";
import { db } from "@/lib/db";
import type { Entry, EntryKind } from "@/lib/contracts";
import { hasDatabaseErrorCode } from "@/lib/db/errors";
import {
  toIsoTimestamp,
  toOptionalIsoTimestamp,
} from "@/lib/db/time";

export type EntryWrite = {
  id?: string;
  kind: EntryKind;
  body: string;
  chapter: string;
  verse?: string | null;
  threads: string[];
  answeredAt?: string | null;
  inkUrl?: string | null;
};

export type EntryPatch = Partial<Omit<EntryWrite, "id">>;

export type EntryFilters = {
  chapter?: string;
  kind?: EntryKind;
  includeDeleted?: boolean;
};

type EntryRow = typeof entries.$inferSelect;

function serializeEntry(row: EntryRow, threadSlugs: string[]): Entry {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    chapter: row.chapter,
    ...(row.verse ? { verse: row.verse } : {}),
    threads: threadSlugs,
    answeredAt: toOptionalIsoTimestamp(row.answeredAt),
    ...(row.inkUrl ? { inkUrl: row.inkUrl } : {}),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

async function hydrateEntries(rows: EntryRow[]) {
  if (rows.length === 0) return [];

  const links = await db
    .select({
      entryId: entryThreads.entryId,
      threadSlug: entryThreads.threadSlug,
    })
    .from(entryThreads)
    .innerJoin(
      threads,
      and(
        eq(threads.userId, entryThreads.userId),
        eq(threads.slug, entryThreads.threadSlug),
        isNull(threads.deletedAt),
      ),
    )
    .where(inArray(entryThreads.entryId, rows.map((row) => row.id)));

  const byEntry = new Map<string, string[]>();
  for (const link of links) {
    const slugs = byEntry.get(link.entryId) ?? [];
    slugs.push(link.threadSlug);
    byEntry.set(link.entryId, slugs);
  }

  return rows.map((row) => serializeEntry(row, byEntry.get(row.id) ?? []));
}

async function assertThreadsExist(userId: string, slugs: string[]) {
  if (slugs.length === 0) {
    throw new InvalidEntryStateError(
      "Every active passage entry must link at least one thread",
    );
  }

  const uniqueSlugs = [...new Set(slugs)];
  const found = await db
    .select({ slug: threads.slug })
    .from(threads)
    .where(
      and(
        eq(threads.userId, userId),
        inArray(threads.slug, uniqueSlugs),
        isNull(threads.deletedAt),
      ),
    );

  const foundSlugs = new Set(found.map((thread) => thread.slug));
  const missing = uniqueSlugs.filter((slug) => !foundSlugs.has(slug));
  if (missing.length > 0) {
    throw new UnknownThreadsError(missing);
  }
}

export class UnknownThreadsError extends Error {
  constructor(readonly slugs: string[]) {
    super(`Unknown thread${slugs.length === 1 ? "" : "s"}: ${slugs.join(", ")}`);
    this.name = "UnknownThreadsError";
  }
}

export class InvalidEntryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEntryStateError";
  }
}

export async function listEntries(userId: string, filters: EntryFilters) {
  const conditions: SQL[] = [eq(entries.userId, userId)];
  if (!filters.includeDeleted) conditions.push(isNull(entries.deletedAt));
  if (filters.chapter) conditions.push(eq(entries.chapter, filters.chapter));
  if (filters.kind) conditions.push(eq(entries.kind, filters.kind));

  const rows = await db
    .select()
    .from(entries)
    .where(and(...conditions))
    .orderBy(desc(entries.updatedAt));

  return hydrateEntries(rows);
}

export async function getEntry(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        eq(entries.id, id),
        isNull(entries.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  const [entry] = await hydrateEntries([row]);
  return entry;
}

export async function createEntry(userId: string, input: EntryWrite) {
  await assertThreadsExist(userId, input.threads);
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const uniqueThreads = [...new Set(input.threads)];

  let insertedRows: (typeof entries.$inferSelect)[];
  try {
    [insertedRows] = await db.batch([
      db
        .insert(entries)
        .values({
          id,
          userId,
          kind: input.kind,
          body: input.body,
          chapter: input.chapter,
          verse: input.verse ?? null,
          answeredAt: input.answeredAt ?? null,
          inkUrl: input.inkUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      db.insert(entryThreads).values(
        uniqueThreads.map((threadSlug) => ({
          userId,
          entryId: id,
          threadSlug,
        })),
      ),
    ]);
  } catch (error) {
    if (hasDatabaseErrorCode(error, "23514")) {
      throw new InvalidEntryStateError(
        "A linked thread changed while the entry was being saved. Reload and try again.",
      );
    }
    throw error;
  }
  const [row] = insertedRows;

  return serializeEntry(row, uniqueThreads);
}

export async function updateEntry(
  userId: string,
  id: string,
  input: EntryPatch,
) {
  const current = await getEntry(userId, id);
  if (!current) return null;
  if (input.threads !== undefined) {
    await assertThreadsExist(userId, input.threads);
  }

  const kind = input.kind ?? current.kind;
  const chapter = input.chapter ?? current.chapter;
  const verse = input.verse === undefined ? current.verse : input.verse;
  if (verse && !verse.startsWith(`${chapter}.`)) {
    throw new InvalidEntryStateError("Verse must belong to the entry chapter");
  }
  const answeredAt =
    kind === "question"
      ? input.answeredAt === undefined
        ? current.answeredAt
        : input.answeredAt
      : null;

  const update = db
    .update(entries)
    .set({
      ...(input.kind !== undefined ? { kind } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.chapter !== undefined ? { chapter } : {}),
      ...(input.verse !== undefined ? { verse } : {}),
      ...(input.inkUrl !== undefined ? { inkUrl: input.inkUrl } : {}),
      answeredAt,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(entries.userId, userId),
        eq(entries.id, id),
        isNull(entries.deletedAt),
      ),
    )
    .returning();

  const threadSlugs = input.threads ?? current.threads;
  let rows: (typeof entries.$inferSelect)[];
  if (input.threads !== undefined) {
    const uniqueThreads = [...new Set(input.threads)];
    try {
      const [updatedRows] = await db.batch([
        update,
        db
          .delete(entryThreads)
          .where(
            and(
              eq(entryThreads.userId, userId),
              eq(entryThreads.entryId, id),
            ),
          ),
        db.insert(entryThreads).values(
          uniqueThreads.map((threadSlug) => ({
            userId,
            entryId: id,
            threadSlug,
          })),
        ),
      ]);
      rows = updatedRows;
    } catch (error) {
      if (hasDatabaseErrorCode(error, "23514")) {
        throw new InvalidEntryStateError(
          "A linked thread changed while the entry was being saved. Reload and try again.",
        );
      }
      throw error;
    }
  } else {
    rows = await update;
  }
  const [row] = rows;
  if (!row) return null;

  return serializeEntry(row, [...new Set(threadSlugs)]);
}

export async function deleteEntry(userId: string, id: string) {
  const [row] = await db
    .update(entries)
    .set({
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(entries.userId, userId),
        eq(entries.id, id),
        isNull(entries.deletedAt),
      ),
    )
    .returning({ id: entries.id });

  return Boolean(row);
}
