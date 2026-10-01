import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";

/**
 * STUDYOFFLINE-001 — the pure reconciliation logic behind this route's
 * client-side hydration (`StudyPageClient.tsx`, same directory). Split out
 * from that component on purpose (this repo's own established discipline —
 * `lib/workspace/gating.ts`/`renderState.ts` sit beside `WorkspaceShell.tsx`
 * the same way): everything here is a plain function over plain data, no
 * React, no IndexedDB, no `fetch`, so it is tested with injected fakes
 * (`tests/study-offline-hydration.test.ts`) rather than `fake-indexeddb`.
 *
 * THE PROBLEM THIS SOLVES: `app/(app)/study/[sessionId]/page.tsx` (a Server
 * Component) renders this session/its claims/its applications straight out
 * of Postgres on every request. That is the only source of truth the page
 * used before this task — but this device's own IndexedDB vault
 * (`lib/sync/store.ts`) can legitimately be AHEAD of what the server just
 * rendered: a claim saved locally moments ago may still be sitting in
 * `syncQueueV2`, unpushed, when this exact page load's server-side query ran.
 * Trusting the server's snapshot unconditionally would make the learner's own
 * just-written prose disappear from the screen the instant the page
 * reloads — not lost (it is still safe in IndexedDB), but not shown, which is
 * its own kind of dishonesty this app's "never silently lose or hide prose"
 * discipline (BUILD_PLAN tenet 4) does not distinguish from actual loss from
 * the learner's chair.
 *
 * THE RULE — reused, not reinvented: `lib/sync/store.ts`'s own
 * `mergeRemoteChangesV2` already settled this exact question for the PULL
 * direction (a server snapshot merging into the local vault): an entity with
 * a still-pending `syncQueueV2` op for its id is a local edit the server has
 * not yet acknowledged, so the pulled row is skipped and the local copy wins;
 * an entity with no pending op has nothing local of its own contesting it, so
 * the server's row wins. `reconcileStudyWorkspace` below applies the SAME
 * rule in the opposite direction (local data merging into what the server
 * rendered for THIS page load): pending-op membership decides the winner,
 * never a clock/`updatedAt` comparison (the mechanism BUILD_PLAN tenet 4
 * retires), with one addition `mergeRemoteChangesV2` does not need — a plain
 * `revision` comparison as the tiebreaker for an entity that is NOT currently
 * pending (e.g. this device pushed an edit, the push was accepted, but this
 * render's server snapshot was fetched from a replica/read path a moment
 * before that acceptance became visible there). Never a timestamp comparison
 * either way.
 */

export interface PendingEntityIds {
  session: ReadonlySet<string>;
  claim: ReadonlySet<string>;
  application: ReadonlySet<string>;
}

export interface StudyWorkspaceSnapshot {
  session: StudySession | null;
  claims: StudyClaim[];
  applications: Application[];
}

export type StudySessionSource = "server" | "local" | "none";

export interface ReconciledStudyWorkspace {
  session: StudySession | null;
  claims: StudyClaim[];
  applications: Application[];
  /**
   * Where the SESSION record this render actually used came from.
   * "none" only happens when neither the server nor this device's own vault
   * has ever heard of this session id -- `StudyPageClient` treats that as "no
   * local fallback exists," not as a reason to fabricate anything.
   * `WorkspaceShell`/`StudyPageClient` use this purely for an honest status
   * notice -- it never feeds `lib/workspace/gating.ts`, which only ever sees
   * the merged `session`/`claims`/`applications` above.
   */
  sessionSource: StudySessionSource;
}

interface HasIdAndRevision {
  id: string;
  revision: number;
}

/**
 * Merges one entity collection (claims, or applications) from the server
 * snapshot and this device's local vault, keyed by `id`. For a id present on
 * both sides: a row named in `pendingIds` (this device has an unsynced edit
 * for it) always wins locally, regardless of revision; otherwise the higher
 * `revision` wins (a plain `>`, never `>=`, so a genuine tie -- the ordinary
 * "this device is already caught up" case -- prefers the SERVER's copy,
 * since that is the one guaranteed to carry whatever the server's own
 * read-side considers canonical for every field this module does not itself
 * inspect). A row present on only one side is always included -- a local-only
 * row is this device's own unsynced creation; a server-only row is something
 * another device already pushed that has not reached this one yet.
 */
export function mergeEntitiesById<T extends HasIdAndRevision>(
  serverRows: readonly T[],
  localRows: readonly T[],
  pendingIds: ReadonlySet<string>,
): T[] {
  const merged = new Map<string, T>();
  for (const row of serverRows) merged.set(row.id, row);
  for (const row of localRows) {
    const existing = merged.get(row.id);
    if (!existing) {
      merged.set(row.id, row);
      continue;
    }
    if (pendingIds.has(row.id) || row.revision > existing.revision) {
      merged.set(row.id, row);
    }
  }
  return [...merged.values()];
}

/**
 * The session record itself follows the identical rule as `mergeEntitiesById`
 * above, just not through that generic (there is exactly one session, never
 * an array to key by id) -- kept as its own small function rather than
 * wrapping a single-element array through the generic, so the three outcomes
 * ("local", "server", "none") are a plain return value a caller can switch on
 * without unwrapping an array first.
 */
function resolveSession(
  serverSession: StudySession | null,
  localSession: StudySession | null,
  pendingSessionIds: ReadonlySet<string>,
): { session: StudySession | null; source: StudySessionSource } {
  if (serverSession && localSession) {
    const preferLocal = pendingSessionIds.has(localSession.id) || localSession.revision > serverSession.revision;
    return preferLocal ? { session: localSession, source: "local" } : { session: serverSession, source: "server" };
  }
  if (serverSession) return { session: serverSession, source: "server" };
  if (localSession) return { session: localSession, source: "local" };
  return { session: null, source: "none" };
}

/**
 * The one entry point `StudyPageClient` calls. `routeSessionId` scopes the
 * claim/application merge the same way the server's own
 * `listClaimsV2`/`listApplicationsV2` are scoped by session id -- this
 * device's local vault holds entities for EVERY session it has ever touched,
 * not just this route's, so `server.claims`/`server.applications` (already
 * scoped by the server) are trusted as the base and `local.claims`/
 * `local.applications` are filtered down to this session before merging, so
 * an unrelated session's local rows can never leak into this render.
 */
export function reconcileStudyWorkspace(
  routeSessionId: string,
  server: StudyWorkspaceSnapshot,
  local: StudyWorkspaceSnapshot,
  pendingIds: PendingEntityIds,
): ReconciledStudyWorkspace {
  const { session, source } = resolveSession(server.session, local.session, pendingIds.session);

  const localClaims = local.claims.filter((claim) => claim.sessionId === routeSessionId);
  const localApplications = local.applications.filter((application) => application.sessionId === routeSessionId);

  const claims = session ? mergeEntitiesById(server.claims, localClaims, pendingIds.claim) : [];
  const applications = session
    ? mergeEntitiesById(server.applications, localApplications, pendingIds.application)
    : [];

  return { session, claims, applications, sessionSource: source };
}

/** Minimal shape this module needs from a `StoredSyncOpV2` (`lib/sync/store.ts`) -- no IndexedDB dependency here, see this file's own header. */
export interface PendingOpLike {
  entity: string;
  entityId: string;
}

/** Builds the three `PendingEntityIds` sets `reconcileStudyWorkspace` needs from this device's real outbox (`getPendingV2Ops()`), or any injected fake of it. */
export function pendingEntityIdsFromOps(ops: readonly PendingOpLike[]): PendingEntityIds {
  const session = new Set<string>();
  const claim = new Set<string>();
  const application = new Set<string>();
  for (const op of ops) {
    if (op.entity === "session") session.add(op.entityId);
    else if (op.entity === "claim") claim.add(op.entityId);
    else if (op.entity === "application") application.add(op.entityId);
  }
  return { session, claim, application };
}
