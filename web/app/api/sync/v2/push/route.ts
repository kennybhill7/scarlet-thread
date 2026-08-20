import { syncPushV2Schema } from "@/lib/api/sync-v2";
import {
  invalidRequest,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { pushSyncOpsV2 } from "@/lib/db/sync-v2";

import { pullSyncChangesV2 } from "../_lib/pull";

/**
 * SYNCV2ROUTE-001 — the v2 analogue of `app/api/sync/push/route.ts`
 * (byte-stable, read-only for this task), same shape field for field:
 * authenticate, parse JSON, validate against the schema `lib/api/sync-v2.ts`
 * already exports (`syncPushV2Schema` — no second copy of op/payload
 * validation is written here), push, then return the acting user's full v2
 * snapshot alongside whatever was rejected.
 *
 * This route is the ONLY new write path this task adds, and it adds no
 * persistence logic of its own: `pushSyncOpsV2` (`lib/db/sync-v2.ts`,
 * SYNCPERSIST-001, read-only for this task) does every write, every
 * tenant-ownership check, every idempotency check, and — critically — the
 * MOTIFSTATUS-001 refusal that keeps `motif.status` server-owned for the
 * `"promoted"` transition. Wiring this route live is exactly what makes that
 * refusal matter in production instead of only in `pushSyncOpsV2`'s own unit
 * tests; `tests/sync-v2-route.test.ts` proves it holds THROUGH this route,
 * not only at the planner level.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON",
        },
      },
      { status: 400 },
    );
  }

  const parsed = syncPushV2Schema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const rejected = await pushSyncOpsV2(session.user.id, parsed.data.ops);
    const changes = await pullSyncChangesV2(session.user.id);
    return privateJson({ ...changes, rejected });
  } catch (error) {
    return serverError(error);
  }
}
