import { privateJson, serverError, unauthorized } from "@/lib/api/response";
import { auth } from "@/lib/auth/config";

import { pullSyncChangesV2 } from "../_lib/pull";

/**
 * SYNCV2ROUTE-001 — the v2 analogue of `app/api/sync/pull/route.ts`
 * (byte-stable, read-only for this task), same shape: authenticate, read the
 * acting user's own snapshot, return it with an empty `rejected` array (a
 * pull never rejects anything — nothing to write on this path).
 *
 * `pullSyncChangesV2` (`_lib/pull.ts`, owned by this task) resolves the
 * caller's workspace from the SESSION via `lib/db/workspaces.ts`'s
 * `getOrCreatePersonalWorkspace` — never from anything the request carries —
 * so there is no parameter through which a caller could ask for another
 * account's data. `tests/sync-v2-route.test.ts`'s hostile two-account case
 * proves this by seeding a second account's workspace with live data and
 * asserting a pull as the first account never returns any of it.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    const changes = await pullSyncChangesV2(session.user.id);
    return privateJson({ ...changes, rejected: [] });
  } catch (error) {
    return serverError(error);
  }
}
