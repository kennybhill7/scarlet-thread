import { syncPullQuerySchema } from "@/lib/api/sync";
import {
  invalidRequest,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { pullSyncChanges } from "@/lib/db/sync";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  const url = new URL(request.url);
  const parsed = syncPullQuerySchema.safeParse({
    since: url.searchParams.get("since"),
  });
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const changes = await pullSyncChanges(session.user.id, parsed.data.since);
    return privateJson({ ...changes, rejected: [] });
  } catch (error) {
    return serverError(error);
  }
}
