import { syncPushSchema } from "@/lib/api/sync";
import {
  invalidRequest,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { pullSyncChanges, pushSyncOps } from "@/lib/db/sync";

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

  const parsed = syncPushSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const rejected = await pushSyncOps(session.user.id, parsed.data.ops);
    const changes = await pullSyncChanges(session.user.id, null);
    return privateJson({ ...changes, rejected });
  } catch (error) {
    return serverError(error);
  }
}
