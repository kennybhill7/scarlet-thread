import { threadSlugSchema, updateThreadSchema } from "@/lib/api/threads";
import {
  invalidRequest,
  privateEmpty,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import {
  deleteThread,
  getThread,
  ThreadInUseError,
  updateThread,
} from "@/lib/db/threads";

type RouteContext = { params: Promise<{ slug: string }> };

function threadNotFound() {
  return privateJson(
    { error: { code: "NOT_FOUND", message: "Thread not found" } },
    { status: 404 },
  );
}

async function authorizedSlug(context: RouteContext) {
  const [session, params] = await Promise.all([auth(), context.params]);
  return {
    userId: session?.user?.id ?? null,
    slug: threadSlugSchema.safeParse(params.slug),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { userId, slug } = await authorizedSlug(context);
  if (!userId) return unauthorized();
  if (!slug.success) return invalidRequest(slug.error);

  try {
    const data = await getThread(userId, slug.data);
    return data ? privateJson({ data }) : threadNotFound();
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { userId, slug } = await authorizedSlug(context);
  if (!userId) return unauthorized();
  if (!slug.success) return invalidRequest(slug.error);

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

  const parsed = updateThreadSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const data = await updateThread(userId, slug.data, parsed.data);
    return data ? privateJson({ data }) : threadNotFound();
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { userId, slug } = await authorizedSlug(context);
  if (!userId) return unauthorized();
  if (!slug.success) return invalidRequest(slug.error);

  try {
    return (await deleteThread(userId, slug.data))
      ? privateEmpty()
      : threadNotFound();
  } catch (error) {
    if (error instanceof ThreadInUseError) {
      return privateJson(
        {
          error: {
            code: "THREAD_IN_USE",
            message:
              "Move or remove this thread's entry links before deleting it.",
          },
        },
        { status: 409 },
      );
    }
    return serverError(error);
  }
}
