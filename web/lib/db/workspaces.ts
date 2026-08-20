import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { workspaces } from "@/db/schema";
import { db } from "@/lib/db";

const PERSONAL_WORKSPACE_NAME = "Personal";

export class WorkspaceAccessDeniedError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace "${workspaceId}" does not belong to this user`);
    this.name = "WorkspaceAccessDeniedError";
  }
}

function personalWorkspaceCondition(userId: string) {
  return and(
    eq(workspaces.createdBy, userId),
    eq(workspaces.kind, "personal"),
    isNull(workspaces.deletedAt),
  );
}

/**
 * Deterministic tie-break (oldest row, then id) so a caller reading twice
 * always gets the same workspace even in the rare case that more than one
 * personal-workspace row exists for a user — see the concurrency note on
 * `getOrCreatePersonalWorkspace` below for why that case is possible at all.
 */
async function findPersonalWorkspaceId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(personalWorkspaceCondition(userId))
    .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The predicate backing `workspaces_created_by_personal_live_idx`
 * (`db/migrations/0008_workspaces_created_by_personal_live_unique.sql`,
 * generated from the matching partial `uniqueIndex(...).where(...)` on
 * `workspaces` in `db/schema.ts`). Used both to build that index and to
 * target it from `ON CONFLICT` below — Postgres only accepts an
 * `ON CONFLICT ... WHERE <predicate>` as inference against a partial unique
 * index when the predicate matches the index's own predicate, so this MUST
 * stay textually in sync with the index definition. Only `kind = 'personal'`
 * ever exists in `workspace_kind` today, so scoping to it is a no-op in
 * practice, but keeping it explicit means a future non-personal workspace
 * kind does not silently start colliding with this constraint.
 */
const PERSONAL_LIVE_WORKSPACE = sql`${workspaces.kind} = 'personal' and ${workspaces.deletedAt} is null`;

/**
 * Resolves an authenticated user id to their personal workspace, creating it
 * exactly-once-in-the-common-case if it does not exist yet.
 *
 * CONCURRENCY — read before changing this function. MIGORDER-001 added
 * `workspaces_created_by_personal_live_idx`, a partial unique index on
 * `created_by` scoped to `kind = 'personal' AND deleted_at IS NULL` (a user
 * may hold at most one *live* personal workspace at a time; a soft-deleted
 * one does not permanently block a replacement). That index is a real
 * conflict target, so the insert below uses `ON CONFLICT ... DO NOTHING`
 * against it — this is not the narrowed-but-still-racy
 * `INSERT ... WHERE NOT EXISTS` shape WORKSPACE-001 originally shipped (see
 * git history/`tests/workspaces.test.ts` header for that prior state and why
 * it could not close the race with no unique target). With the index in
 * place, Postgres itself serializes two genuinely concurrent inserts for the
 * same user: exactly one commits, the other observes the conflict and
 * `DO NOTHING`s. This was proven against a real local Postgres 18 instance
 * as part of MIGORDER-001's verification (two concurrent sessions issuing
 * this exact statement for the same `created_by`; the loser's `RETURNING`
 * came back empty, not a duplicate row).
 *
 * The two-round-trip shape (read, then maybe insert) remains for read-mostly
 * efficiency — an existing personal workspace short-circuits before any
 * write is attempted — but correctness no longer depends on that shape: even
 * if two callers both miss the read and both attempt the insert, only one
 * insert can ever land. `findPersonalWorkspaceId`'s deterministic ordering
 * is kept as the fallback read after a lost conflict, and also covers the
 * pre-existing-duplicate-rows case (e.g. from data created before this
 * index existed).
 */
export async function getOrCreatePersonalWorkspace(
  userId: string,
): Promise<string> {
  const existing = await findPersonalWorkspaceId(userId);
  if (existing) return existing;

  const id = crypto.randomUUID();

  const inserted = await db
    .insert(workspaces)
    .values({
      id,
      kind: "personal",
      name: PERSONAL_WORKSPACE_NAME,
      createdBy: userId,
    })
    .onConflictDoNothing({
      target: workspaces.createdBy,
      where: PERSONAL_LIVE_WORKSPACE,
    })
    .returning({ id: workspaces.id });

  const row = inserted[0];
  if (row) return row.id;

  // Someone else's call won the real database-level conflict above. Read
  // back rather than assume — see the deterministic ordering above.
  const winner = await findPersonalWorkspaceId(userId);
  if (!winner) {
    throw new Error(
      `Workspace insert for "${userId}" reported a conflict but no personal workspace was found`,
    );
  }
  return winner;
}

/**
 * Verifies `workspaceId` was created by `userId` and is not soft-deleted.
 * Every caller that accepts a workspace id from outside this module MUST
 * route it through this check first — accepting a caller-supplied workspace
 * id without this is exactly the tenant-isolation hole P0-001 exists to
 * prevent, just one level up (workspace ownership instead of row ownership).
 */
export async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.createdBy, userId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new WorkspaceAccessDeniedError(workspaceId);
}
