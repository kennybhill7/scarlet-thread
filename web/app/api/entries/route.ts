import { auth } from "@/lib/auth/config";
import {
  createEntrySchema,
  listEntriesQuerySchema,
} from "@/lib/api/entries";
import {
  invalidRequest,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import {
  createEntry,
  InvalidEntryStateError,
  listEntries,
  UnknownThreadsError,
} from "@/lib/db/entries";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  const url = new URL(request.url);
  const parsed = listEntriesQuerySchema.safeParse({
    chapter: url.searchParams.get("chapter") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    includeDeleted: url.searchParams.get("includeDeleted") ?? undefined,
  });
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const data = await listEntries(session.user.id, parsed.data);
    return privateJson({ data });
  } catch (error) {
    return serverError(error);
  }
}

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

  const parsed = createEntrySchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const data = await createEntry(session.user.id, parsed.data);
    return privateJson({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidEntryStateError) {
      return privateJson(
        {
          error: {
            code: "INVALID_ENTRY_STATE",
            message: error.message,
          },
        },
        { status: 409 },
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
