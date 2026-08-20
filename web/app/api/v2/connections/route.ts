import { invalidRequest, privateJson } from "@/lib/api/response";

import { limitQuerySchema } from "../_lib/pagination";
import { rejectMutation, withReadOnlyV2Workspace } from "../_lib/guard";
import { listConnectionsV2 } from "../_lib/queries";

/**
 * GET /api/v2/connections — every non-deleted connection in the acting
 * user's workspace, newest first, bounded by `?limit=` (default 50, max
 * 200 — see `_lib/pagination.ts`). V2API-002: one of the five entities
 * V2API-001 reported as missing a read route.
 */
export async function GET(request: Request) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const url = new URL(request.url);
    const parsed = limitQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return invalidRequest(parsed.error);

    const data = await listConnectionsV2(workspaceId, { limit: parsed.data.limit });
    return privateJson({ data });
  });
}

export async function POST(request: Request) {
  return rejectMutation(request);
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
