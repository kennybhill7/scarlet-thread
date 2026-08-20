import { z } from "zod";

import { invalidRequest, privateJson } from "@/lib/api/response";

import { rejectMutation, withReadOnlyV2Workspace } from "../_lib/guard";
import { listClaimsV2 } from "../_lib/queries";

const listClaimsQuerySchema = z.object({
  sessionId: z.string().min(1).max(200).optional(),
});

/**
 * GET /api/v2/claims — every study claim in the acting user's workspace,
 * optionally narrowed to one session via `?sessionId=`.
 */
export async function GET(request: Request) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const url = new URL(request.url);
    const parsed = listClaimsQuerySchema.safeParse({
      sessionId: url.searchParams.get("sessionId") ?? undefined,
    });
    if (!parsed.success) return invalidRequest(parsed.error);

    const data = await listClaimsV2(workspaceId, parsed.data);
    return privateJson({ data });
  });
}

export async function POST(request: Request) {
  return rejectMutation(request);
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
