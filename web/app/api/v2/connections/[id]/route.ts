import { notFound, privateJson } from "@/lib/api/response";

import { rejectMutation, withReadOnlyV2Workspace } from "../../_lib/guard";
import { getConnectionV2 } from "../../_lib/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/connections/[id] — one connection, scoped to the acting
 * user's workspace. A connection id belonging to another workspace, or one
 * the caller has since deleted, resolves to 404, identically to an id that
 * does not exist at all.
 */
export async function GET(request: Request, context: RouteContext) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const { id } = await context.params;
    const data = await getConnectionV2(workspaceId, id);
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
