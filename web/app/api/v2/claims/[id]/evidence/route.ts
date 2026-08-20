import { notFound, privateJson } from "@/lib/api/response";

import { rejectMutation, withReadOnlyV2Workspace } from "../../../_lib/guard";
import { listClaimEvidenceV2 } from "../../../_lib/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/claims/[id]/evidence — every evidence row citing one claim,
 * scoped to the acting user's workspace. `listClaimEvidenceV2` resolves the
 * parent claim inside the caller's workspace FIRST and returns `null` if it
 * does not — so probing another workspace's claim id here 404s exactly like
 * `GET /api/v2/claims/[id]` does, rather than leaking a distinguishing
 * "claim exists but you can't see it" empty-list response.
 */
export async function GET(request: Request, context: RouteContext) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const { id } = await context.params;
    const data = await listClaimEvidenceV2(workspaceId, id);
    if (data === null) return notFound();
    return privateJson({ data });
  });
}

export async function POST(request: Request) {
  return rejectMutation(request);
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
