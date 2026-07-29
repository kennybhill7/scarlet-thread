import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { entries, entryThreads, threads } from "@/db/schema";
import { db } from "@/lib/db";
import type { Thread } from "@/lib/contracts";
import { hasDatabaseErrorCode } from "@/lib/db/errors";
import {
  toIsoTimestamp,
  toOptionalIsoTimestamp,
} from "@/lib/db/time";

export type ThreadWrite = Pick<
  Thread,
  "slug" | "title" | "definition" | "seeing"
>;
export type ThreadPatch = Partial<Omit<ThreadWrite, "slug">>;

export class ThreadInUseError extends Error {
  constructor(readonly slug: string) {
    super(`Thread "${slug}" is still linked to active writing`);
    this.name = "ThreadInUseError";
  }
}

function serializeThread(row: typeof threads.$inferSelect): Thread {
  return {
    slug: row.slug,
    title: row.title,
    definition: row.definition,
    seeing: row.seeing,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

export async function listThreads(userId: string) {
  const rows = await db
    .select()
    .from(threads)
    .where(and(eq(threads.userId, userId), isNull(threads.deletedAt)))
    .orderBy(asc(threads.title));
  return rows.map(serializeThread);
}

export async function getThread(userId: string, slug: string) {
  const [row] = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.userId, userId),
        eq(threads.slug, slug),
        isNull(threads.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeThread(row) : null;
}

export async function createThread(userId: string, input: ThreadWrite) {
  const now = new Date().toISOString();
  const [existing] = await db
    .select()
    .from(threads)
    .where(
      and(eq(threads.userId, userId), eq(threads.slug, input.slug)),
    )
    .limit(1);
  if (existing && !existing.deletedAt) return null;
  if (existing) {
    const [restored] = await db
      .update(threads)
      .set({
        title: input.title,
        definition: input.definition,
        seeing: input.seeing,
        updatedAt: now,
        deletedAt: null,
      })
      .where(
        and(eq(threads.userId, userId), eq(threads.slug, input.slug)),
      )
      .returning();
    return serializeThread(restored);
  }

  const [row] = await db
    .insert(threads)
    .values({
      userId,
      ...input,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  return serializeThread(row);
}

export async function updateThread(
  userId: string,
  slug: string,
  input: ThreadPatch,
) {
  const [row] = await db
    .update(threads)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(threads.userId, userId),
        eq(threads.slug, slug),
        isNull(threads.deletedAt),
      ),
    )
    .returning();
  return row ? serializeThread(row) : null;
}

export async function deleteThread(userId: string, slug: string) {
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
        eq(entryThreads.threadSlug, slug),
      ),
    )
    .limit(1);
  if (linked) throw new ThreadInUseError(slug);

  const now = new Date().toISOString();
  let row: { slug: string } | undefined;
  try {
    [row] = await db
      .update(threads)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(threads.userId, userId),
          eq(threads.slug, slug),
          isNull(threads.deletedAt),
        ),
      )
      .returning({ slug: threads.slug });
  } catch (error) {
    if (hasDatabaseErrorCode(error, "23514")) {
      throw new ThreadInUseError(slug);
    }
    throw error;
  }
  return Boolean(row);
}
