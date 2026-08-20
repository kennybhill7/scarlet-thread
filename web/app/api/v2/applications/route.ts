import { z } from "zod";

import { invalidRequest, privateJson } from "@/lib/api/response";

import { limitQuerySchema } from "../_lib/pagination";
import { rejectMutation, withReadOnlyV2Workspace } from "../_lib/guard";
import { listApplicationsV2 } from "../_lib/queries";

const listApplicationsQuerySchema = z
  .object({
    sessionId: z.string().min(1).max(200).optional(),
  })
  .extend(limitQuerySchema.shape);

/**
 * GET /api/v2/applications — every non-deleted application in the acting
 * user's workspace, optionally narrowed to one session via `?sessionId=`,
 * bounded by `?limit=` (default 50, max 200 — see `_lib/pagination.ts`).
 * V2API-002: one of the five entities V2API-001 reported as missing a read
 * route.
 */
export async function GET(request: Request) {
  return withReadOnlyV2Workspace(request, async (workspaceId) => {
    const url = new URL(request.url);
    const parsed = listApplicationsQuerySchema.safeParse({
      sessionId: url.searchParams.get("sessionId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return invalidRequest(parsed.error);

    const data = await listApplicationsV2(workspaceId, parsed.data);
    return privateJson({ data });
  });
}

export async function POST(request: Request) {
  return rejectMutation(request);
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
