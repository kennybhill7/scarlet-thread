import { createThreadSchema } from "@/lib/api/threads";
import {
  invalidRequest,
  privateJson,
  serverError,
  unauthorized,
} from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { createThread, listThreads } from "@/lib/db/threads";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    return privateJson({ data: await listThreads(session.user.id) });
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

  const parsed = createThreadSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  try {
    const data = await createThread(session.user.id, parsed.data);
    return data
      ? privateJson({ data }, { status: 201 })
      : privateJson(
          {
            error: {
              code: "THREAD_EXISTS",
              message: "A thread with this slug already exists",
            },
          },
          { status: 409 },
        );
  } catch (error) {
    return serverError(error);
  }
}
