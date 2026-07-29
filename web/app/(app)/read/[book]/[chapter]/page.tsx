import { notFound } from "next/navigation";
import { ChapterReader } from "@/components/reader/ChapterReader";

interface PageProps {
  params: Promise<{ book: string; chapter: string }>;
}

// Scripture data (Cache API, fetch) only exists client-side, so this server
// component's only job is to validate the URL shape before handing off —
// real range validation (does Leviticus have 40 chapters?) happens once the
// client has the loaded index.
export default async function ReadChapterPage({ params }: PageProps) {
  const { book, chapter } = await params;
  const bookNumber = Number.parseInt(book, 10);
  const chapterNumber = Number.parseInt(chapter, 10);

  if (!Number.isInteger(bookNumber) || bookNumber < 1 || bookNumber > 66) notFound();
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) notFound();

  return <ChapterReader book={bookNumber} chapter={chapterNumber} />;
}
