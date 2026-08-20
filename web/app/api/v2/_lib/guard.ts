import "server-only";

import { auth } from "@/lib/auth/config";
import {
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import {
  V2ResourceRouteMutationRejected,
  assertReadOnlyV2ResourceRequest,
} from "@/lib/api/sync-v2";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";

/**
 * V2API-001 — the one entry point every v2 resource route goes through.
 *
 * BUILD_PLAN tenet 7 / master plan §14 ("one mutation path"): v2 resource
 * routes are READ-ONLY, and the rule rejecting anything else must have ONE
 * implementation. `assertReadOnlyV2ResourceRequest` is that implementation
 * (SYNCV2-001, `lib/api/sync-v2.ts`, a readOnlyPath for this task) — this
 * file imports and calls it rather than re-deriving "is this request a
 * mutation" from the HTTP method a second time anywhere in `app/api/v2/`.
 *
 * Workspace scoping is the other half of the contract this task owns: every
 * v2 row is scoped to `workspace_id`, and a caller must NEVER be able to
 * choose which workspace a route reads by supplying an id (query param,
 * body, header) — that is exactly the tenant-isolation hole `WORKSPACE-001`
 * built `assertWorkspaceOwnership`/`getOrCreatePersonalWorkspace` to close
 * for the write path, and it applies identically here. `run` below only
 * ever receives a `workspaceId` this module derived itself, from the
 * authenticated session id, via `getOrCreatePersonalWorkspace` — never a
 * value read off `request`.
 */
export function methodNotAllowed(message: string) {
  return privateJson(
    { error: { code: "METHOD_NOT_ALLOWED", message } },
    { status: 405 },
  );
}

/**
 * Wraps a v2 resource GET handler: rejects any mutation-shaped request via
 * the single imported predicate, requires an authenticated session, resolves
 * that session to the acting user's own workspace, and only then calls
 * `run`. Errors thrown by `run` (or by workspace resolution) fall through to
 * the shared `serverError` helper, so route files never need their own
 * try/catch for that.
 */
export async function withReadOnlyV2Workspace(
  request: Request,
  run: (workspaceId: string, userId: string) => Promise<Response>,
): Promise<Response> {
  try {
    assertReadOnlyV2ResourceRequest(request);
  } catch (error) {
    if (error instanceof V2ResourceRouteMutationRejected) {
      return methodNotAllowed(error.message);
    }
    throw error;
  }

  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    const workspaceId = await getOrCreatePersonalWorkspace(session.user.id);
    return await run(workspaceId, session.user.id);
  } catch (error) {
    return serverError(error);
  }
}

/**
 * The handler every non-GET export (`POST`/`PUT`/`PATCH`/`DELETE`) on a v2
 * resource route delegates to. Always rejects — `assertReadOnlyV2ResourceRequest`
 * rejects on method alone before it would ever need to inspect a body — via
 * the same single predicate `withReadOnlyV2Workspace` uses above, so the
 * read-only rule is enforced identically regardless of which verb reached
 * it.
 */
export async function rejectMutation(request: Request): Promise<Response> {
  try {
    assertReadOnlyV2ResourceRequest(request);
  } catch (error) {
    if (error instanceof V2ResourceRouteMutationRejected) {
      return methodNotAllowed(error.message);
    }
    throw error;
  }
  // assertReadOnlyV2ResourceRequest only resolves for a bodiless GET/HEAD
  // request, so a non-GET verb reaching this line without throwing would
  // mean the predicate stopped enforcing its own contract. Fail loudly
  // rather than silently return 200 for a mutation.
  throw new Error(
    "rejectMutation was reached by a request assertReadOnlyV2ResourceRequest did not reject",
  );
}
