import { invalidRequest, notFound, privateJson } from "@/lib/api/response";

import { limitQuerySchema } from "../../../_lib/pagination";
import { rejectMutation, withReadOnlyV2Workspace } from "../../../_lib/guard";
import { listMotifSightingsV2 } from "../../../_lib/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/motifs/[id]/sightings — every non-deleted sighting of one
 * motif candidate, scoped to the acting user's workspace, bounded by
 * `?limit=` (default 50, max 200 — see `_lib/pagination.ts`).
 * `listMotifSightingsV2` resolves the parent candidate inside the caller's
 * workspace FIRST (excluding a soft-deleted candidate) and returns `null`
 * if it does not — so probing another workspace's candidate id 404s exactly
 * like `GET /api/v2/motifs/[id]` does, rather than leaking a distinguishing
 * "candidate exists but you can't see it" empty-list response.
 */
export async function GET(request: Request, context: RouteContext) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const url = new URL(request.url);
    const parsed = limitQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return invalidRequest(parsed.error);

    const { id } = await context.params;
    const data = await listMotifSightingsV2(workspaceId, id, { limit: parsed.data.limit });
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
