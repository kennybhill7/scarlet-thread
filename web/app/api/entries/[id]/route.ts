import { z } from "zod";

import { updateEntrySchema } from "@/lib/api/entries";
import {
  invalidRequest,
  notFound,
  privateEmpty,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import {
  deleteEntry,
  getEntry,
  InvalidEntryStateError,
  UnknownThreadsError,
  updateEntry,
} from "@/lib/db/entries";

const idSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string }> };

async function authorizedId(context: RouteContext) {
  const [session, params] = await Promise.all([auth(), context.params]);
  return {
    userId: session?.user?.id ?? null,
    id: idSchema.safeParse(params.id),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { userId, id } = await authorizedId(context);
  if (!userId) return unauthorized();
  if (!id.success) return invalidRequest(id.error);

  try {
    const data = await getEntry(userId, id.data);
    return data ? privateJson({ data }) : notFound();
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { userId, id } = await authorizedId(context);
  if (!userId) return unauthorized();
  if (!id.success) return invalidRequest(id.error);

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

  const parsed = updateEntrySchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const data = await updateEntry(userId, id.data, parsed.data);
    return data ? privateJson({ data }) : notFound();
  } catch (error) {
    if (error instanceof InvalidEntryStateError) {
      return privateJson(
        {
          error: {
            code: "INVALID_ENTRY_STATE",
            message: error.message,
          },
        },
        { status: 400 },
      );
    }
    if (error instanceof UnknownThreadsError) {
      return privateJson(
        {
          error: {
            code: "UNKNOWN_THREADS",
            message: error.message,
            slugs: error.slugs,
          },
        },
        { status: 409 },
      );
    }
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { userId, id } = await authorizedId(context);
  if (!userId) return unauthorized();
  if (!id.success) return invalidRequest(id.error);

  try {
    const deleted = await deleteEntry(userId, id.data);
    return deleted ? privateEmpty() : notFound();
  } catch (error) {
    return serverError(error);
  }
}
