import { notFound } from "next/navigation";
import { ChapterReader } from "@/components/reader/ChapterReader";
import { auth } from "@/lib/auth/config";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";

interface PageProps {
  params: Promise<{ book: string; chapter: string }>;
}

/**
 * STUDYENTRY-001 -- resolves the signed-in reader's own workspace id, the
 * same server-side derivation app/(app)/study/[sessionId]/page.tsx's
 * resolveStudyPageData already uses (auth() -> getOrCreatePersonalWorkspace,
 * lib/db/workspaces.ts, a readOnlyPath here): NEVER a caller-supplied id.
 *
 * app/(app)/layout.tsx (not owned/readOnly here, but already wraps this
 * whole route group) redirects an unauthenticated visitor to /sign-in before
 * this page ever renders, so in the ordinary case auth() here always
 * resolves to a real session. This still guards both auth() and the
 * workspace lookup with try/catch and returns null on any failure (a
 * database outage between the layout's check and this one, or any other
 * surprise) rather than letting reading itself break: null flows into
 * ChapterReader's workspaceId prop, which StudyEntryControl
 * (components/reader/StudyEntry.tsx) treats as "the start-a-study affordance
 * is temporarily unavailable," never as a reason to fail the whole page --
 * the chapter must still be readable with the database or the network down.
 */
export type ResolveWorkspaceDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } | null } | null>;
  resolveWorkspaceId: (userId: string) => Promise<string>;
};

const defaultResolveWorkspaceDeps: ResolveWorkspaceDeps = {
  getSession: auth,
  resolveWorkspaceId: getOrCreatePersonalWorkspace,
};

export async function resolveWorkspaceId(
  deps: ResolveWorkspaceDeps = defaultResolveWorkspaceDeps,
): Promise<string | null> {
  try {
    const session = await deps.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;
    return await deps.resolveWorkspaceId(userId);
  } catch {
    return null;
  }
}

// Scripture data (Cache API, fetch) only exists client-side, so this server
// component's other job is to validate the URL shape before handing off --
// real range validation (does Leviticus have 40 chapters?) happens once the
// client has the loaded index.
export default async function ReadChapterPage({ params }: PageProps) {
  const { book, chapter } = await params;
  const bookNumber = Number.parseInt(book, 10);
  const chapterNumber = Number.parseInt(chapter, 10);

  if (!Number.isInteger(bookNumber) || bookNumber < 1 || bookNumber > 66) notFound();
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) notFound();

  const workspaceId = await resolveWorkspaceId();

  return <ChapterReader book={bookNumber} chapter={chapterNumber} workspaceId={workspaceId} />;
}
