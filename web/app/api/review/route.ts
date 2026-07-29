import {
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { getReviewSnapshot } from "@/lib/db/review";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    return privateJson({
      data: await getReviewSnapshot(session.user.id),
    });
  } catch (error) {
    return serverError(error);
  }
}
