import { notFound } from "next/navigation";

import { ThreadDetail } from "@/components/threads/ThreadDetail";

type ThreadPageProps = {
  params: Promise<{ slug: string }>;
};

const threadSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { slug } = await params;
  if (!threadSlug.test(slug) || slug.length > 120) notFound();

  return <ThreadDetail slug={slug} />;
}
