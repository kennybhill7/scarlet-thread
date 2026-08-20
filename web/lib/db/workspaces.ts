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
 * Resolves an authenticated user id to their personal workspace, creating it
 * exactly-once-in-the-common-case if it does not exist yet.
 *
 * CONCURRENCY — read before changing this function. The insert below is a
 * single `INSERT ... SELECT ... WHERE NOT EXISTS` statement, not a naive
 * separate select-then-insert: it collapses the check and the write into one
 * round trip instead of two, which shrinks the race window from a full
 * network round trip down to one statement's internal planning time. It does
 * NOT eliminate the race. Verified empirically against a real local
 * Postgres 16 instance (workspaces table, no unique constraint, matching
 * `db/schema.ts` exactly): two genuinely concurrent connections running this
 * exact statement shape for the same user BOTH pass `WHERE NOT EXISTS` and
 * BOTH insert, because under READ COMMITTED nothing blocks a phantom insert
 * without a unique/exclusion constraint backing it — `ON CONFLICT` has no
 * constraint to target here either, for the same reason.
 *
 * The real fix is a partial unique index —
 * `UNIQUE (created_by) WHERE kind = 'personal' AND deleted_at IS NULL` — but
 * `db/schema.ts` is a read-only path for this task (WORKSPACE-001 owns only
 * this file and its test), so that index cannot be added here. The other
 * standard mitigations are also unavailable in this codebase's current data
 * layer: `drizzle-orm/neon-http` throws "No transactions support in
 * neon-http driver" (see `node_modules/drizzle-orm/neon-http/session.js`),
 * so there is no wrapping transaction to run `SERIALIZABLE` or take a
 * session-scoped `pg_advisory_lock` inside — and the HTTP driver gives no
 * guarantee that two sequential queries even share one database session,
 * which a session-level advisory lock would additionally require.
 *
 * Given that, this function does the best available thing and says so
 * plainly: it narrows the window as far as a single statement allows, and
 * `findPersonalWorkspaceId`'s deterministic ordering means that even in the
 * rare event two rows get created, every caller still converges on the same
 * one rather than flip-flopping between requests. Closing the race for real
 * is a schema follow-up (the partial unique index above) tracked outside
 * this task's scope.
 */
export async function getOrCreatePersonalWorkspace(
  userId: string,
): Promise<string> {
  const existing = await findPersonalWorkspaceId(userId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const inserted = await db.execute<{ id: string }>(sql`
    insert into ${workspaces} (id, kind, name, created_by, created_at)
    select ${id}, 'personal'::workspace_kind, ${PERSONAL_WORKSPACE_NAME}, ${userId}, ${now}
    where not exists (
      select 1 from ${workspaces}
      where ${workspaces.createdBy} = ${userId}
        and ${workspaces.kind} = 'personal'
        and ${workspaces.deletedAt} is null
    )
    returning id
  `);

  const row = inserted.rows[0];
  if (row) return row.id;

  // Someone else's call won the race between our SELECT and our INSERT.
  // Read back rather than assume — see the deterministic ordering above.
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
