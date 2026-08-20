import { notFound, privateJson } from "@/lib/api/response";

import { rejectMutation, withReadOnlyV2Workspace } from "../../_lib/guard";
import { getSessionV2 } from "../../_lib/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/sessions/[id] — one study session, scoped to the acting
 * user's workspace. A session id that belongs to another workspace resolves
 * to 404, identically to an id that does not exist at all — the route never
 * distinguishes "not yours" from "not found".
 */
export async function GET(request: Request, context: RouteContext) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const { id } = await context.params;
    const data = await getSessionV2(workspaceId, id);
    if (!data) return notFound();
    return privateJson({ data });
  });
}

export async function POST(request: Request) {
  return rejectMutation(request);
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
