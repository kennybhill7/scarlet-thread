import { privateJson } from "@/lib/api/response";

import { rejectMutation, withReadOnlyV2Workspace } from "../_lib/guard";
import { listSessionsV2 } from "../_lib/queries";

/**
 * GET /api/v2/sessions — every study session in the acting user's workspace.
 * BUILD_PLAN tenet 7: read-only. Mutations go through /api/sync/push.
 */
export async function GET(request: Request) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const data = await listSessionsV2(workspaceId);
    return privateJson({ data });
  });
}

export async function POST(request: Request) {
  return rejectMutation(request);
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
