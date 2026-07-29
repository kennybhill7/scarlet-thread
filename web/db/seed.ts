import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z, type ZodType } from "zod";

import * as schema from "@/db/schema";
import {
  entries,
  entryThreads,
  people,
  stages,
  threads,
  users,
} from "@/db/schema";
import { chapterRefSchema } from "@/lib/api/entries";

type SeedStage = typeof stages.$inferInsert;
type SeedThread = Pick<
  typeof threads.$inferInsert,
  "slug" | "title" | "definition" | "seeing"
>;
type SeedPerson = {
  slug: string;
  name: string;
  body: string;
  chapters: string[];
  threads: string[];
};
type SeedEntry = {
  kind: "observation" | "question" | "note" | "teaching";
  body: string;
  chapter: string;
  threads: string[];
  answeredAt?: string | null;
};

const seedDirectory = path.join(process.cwd(), "data", "seed");

async function readSeed<T>(filename: string, schema: ZodType<T>) {
  const value: unknown = JSON.parse(
    await readFile(path.join(seedDirectory, filename), "utf8"),
  );
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n- ");
    throw new Error(`${filename} is invalid:\n- ${issues}`);
  }
  return parsed.data;
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugSchema = z.string().regex(slugPattern);
const seedStageSchema = z.array(
  z
    .object({
      slug: slugSchema,
      title: z.string().trim().min(1),
      stage: z.number().int(),
      side: z.enum(["ascent", "peak", "descent"]),
      mirror: slugSchema.nullable(),
      chapters: z.array(chapterRefSchema),
      summary: z.string(),
    })
    .strict(),
);
const seedThreadSchema = z.array(
  z
    .object({
      slug: slugSchema,
      title: z.string().trim().min(1),
      definition: z.string(),
      seeing: z.string(),
    })
    .strict(),
);
const seedPersonSchema = z.array(
  z
    .object({
      slug: slugSchema,
      name: z.string().trim().min(1),
      body: z.string(),
      chapters: z.array(chapterRefSchema),
      threads: z.array(slugSchema),
    })
    .strict(),
);
const seedEntrySchema = z.array(
  z
    .object({
      kind: z.enum(["observation", "question", "note", "teaching"]),
      body: z.string().trim().min(1),
      chapter: chapterRefSchema,
      threads: z.array(slugSchema),
      answeredAt: z.iso.datetime({ offset: true }).nullish(),
    })
    .strict(),
);

function deterministicId(
  userId: string,
  occurrence: number,
  entry: SeedEntry,
) {
  const hex = createHash("sha256")
    .update(
      `${userId}\0${occurrence}\0${entry.kind}\0${entry.chapter}\0${entry.body}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function preflight(
  stageSeed: SeedStage[],
  threadSeed: SeedThread[],
  personSeed: SeedPerson[],
  entrySeed: SeedEntry[],
) {
  const errors: string[] = [];
  const stageSlugs = new Set<string>();
  const stageNumbers = new Set<number>();
  const threadSlugs = new Set<string>();

  if (stageSeed.length !== 11) {
    errors.push(`Expected 11 mountain stages, found ${stageSeed.length}`);
  }
  for (const stage of stageSeed) {
    if (!stage.slug || stageSlugs.has(stage.slug)) {
      errors.push(`Duplicate or missing stage slug: ${stage.slug || "(empty)"}`);
    }
    stageSlugs.add(stage.slug);
    if (!Number.isInteger(stage.stage) || stageNumbers.has(stage.stage)) {
      errors.push(`Duplicate or invalid stage number: ${stage.stage}`);
    }
    stageNumbers.add(stage.stage);
    if (stage.stage < 1 || stage.stage > 11) {
      errors.push(`Stage ${stage.slug} is outside the 1-11 mountain`);
    }
    if (!Array.isArray(stage.chapters)) {
      errors.push(`Stage ${stage.slug} has no chapter list`);
    }
    for (const chapter of stage.chapters ?? []) {
      if (!chapterRefSchema.safeParse(chapter).success) {
        errors.push(`Stage ${stage.slug} has invalid chapter ${chapter}`);
      }
    }
  }
  const stagesBySlug = new Map(stageSeed.map((stage) => [stage.slug, stage]));
  for (const stage of stageSeed) {
    if (!stage.mirror) continue;
    const mirror = stagesBySlug.get(stage.mirror);
    if (!mirror) {
      errors.push(`Stage ${stage.slug} has unknown mirror ${stage.mirror}`);
    } else if (mirror.mirror !== stage.slug) {
      errors.push(`Stage ${stage.slug} mirror is not reciprocal`);
    }
  }

  for (const thread of threadSeed) {
    if (!slugPattern.test(thread.slug) || threadSlugs.has(thread.slug)) {
      errors.push(
        `Duplicate or invalid thread slug: ${thread.slug || "(empty)"}`,
      );
    }
    threadSlugs.add(thread.slug);
  }

  for (const person of personSeed) {
    if (!slugPattern.test(person.slug)) {
      errors.push(`Invalid person slug: ${person.slug || "(empty)"}`);
    }
    for (const chapter of person.chapters) {
      if (!chapterRefSchema.safeParse(chapter).success) {
        errors.push(`Person ${person.slug} has invalid chapter ${chapter}`);
      }
    }
    for (const thread of person.threads) {
      if (!threadSlugs.has(thread)) {
        errors.push(`Person ${person.slug} has unknown thread ${thread}`);
      }
    }
  }
  const expectedPersonOrphans = new Set(["abraham", "david", "noah"]);
  const actualPersonOrphans = new Set(
    personSeed
      .filter(
        (person) =>
          person.chapters.length === 0 && person.threads.length === 0,
      )
      .map((person) => person.slug),
  );
  for (const slug of expectedPersonOrphans) {
    if (!actualPersonOrphans.has(slug)) {
      errors.push(`Expected source person orphan is missing: ${slug}`);
    }
  }
  for (const slug of actualPersonOrphans) {
    if (!expectedPersonOrphans.has(slug)) {
      errors.push(`Unexpected imported person orphan: ${slug}`);
    }
  }

  entrySeed.forEach((entry, index) => {
    if (!entry.body?.trim()) errors.push(`Entry ${index} has an empty body`);
    if (!chapterRefSchema.safeParse(entry.chapter).success) {
      errors.push(`Entry ${index} has invalid chapter ${entry.chapter}`);
    }
    if (!entry.threads.length) {
      errors.push(`Entry ${index} has no thread link`);
    }
    for (const thread of entry.threads) {
      if (!threadSlugs.has(thread)) {
        errors.push(`Entry ${index} has unknown thread ${thread}`);
      }
    }
    if (entry.kind !== "question" && entry.answeredAt) {
      errors.push(`Entry ${index} is not a question but is marked answered`);
    }
  });

  if (errors.length > 0) {
    throw new Error(
      `Seed preflight failed with ${errors.length} issue(s):\n- ${errors
        .slice(0, 25)
        .join("\n- ")}`,
    );
  }
}

async function main() {
  const email = process.env.AUTH_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!email) {
    throw new Error("AUTH_ALLOWED_EMAIL is required");
  }
  const db = drizzle(process.env.DATABASE_URL, { schema });

  const [stageSeed, threadSeed, personSeed, entrySeed] = await Promise.all([
    readSeed<SeedStage[]>("stages.json", seedStageSchema),
    readSeed<SeedThread[]>("threads.json", seedThreadSchema),
    readSeed<SeedPerson[]>("people.json", seedPersonSchema),
    readSeed<SeedEntry[]>("entries.json", seedEntrySchema),
  ]);
  preflight(stageSeed, threadSeed, personSeed, entrySeed);

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    throw new Error(
      "The allowed Google account must sign in once before running db:seed",
    );
  }
  const [existingEntry, existingThread, existingPerson] = await Promise.all([
    db
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.userId, user.id))
      .limit(1),
    db
      .select({ slug: threads.slug })
      .from(threads)
      .where(eq(threads.userId, user.id))
      .limit(1),
    db
      .select({ slug: people.slug })
      .from(people)
      .where(eq(people.userId, user.id))
      .limit(1),
  ]);
  if (
    existingEntry.length > 0 ||
    existingThread.length > 0 ||
    existingPerson.length > 0
  ) {
    throw new Error(
      "Seed target already contains journal data. The baseline import is one-time and will not overwrite an active journal.",
    );
  }

  const now = new Date().toISOString();
  const [firstStage, ...remainingStages] = stageSeed;
  if (!firstStage) {
    throw new Error("Seed preflight did not provide a first stage");
  }
  const stageUpsert = (stage: SeedStage) =>
    db
      .insert(stages)
      .values(stage)
      .onConflictDoUpdate({
        target: stages.slug,
        set: {
          title: stage.title,
          stage: stage.stage,
          side: stage.side,
          mirror: stage.mirror,
          chapters: stage.chapters,
          summary: stage.summary,
        },
      });
  const operations: [
    BatchItem<"pg">,
    ...BatchItem<"pg">[],
  ] = [stageUpsert(firstStage)];
  for (const stage of remainingStages) {
    operations.push(stageUpsert(stage));
  }

  for (const thread of threadSeed) {
    operations.push(
      db.insert(threads).values({
        userId: user.id,
        ...thread,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  for (const person of personSeed) {
    operations.push(
      db.insert(people).values({
        userId: user.id,
        slug: person.slug,
        name: person.name,
        body: person.body,
        chapters: person.chapters,
        threadSlugs: person.threads,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  const entryOccurrences = new Map<string, number>();
  for (const entry of entrySeed) {
    const fingerprint = `${entry.kind}\0${entry.chapter}\0${entry.body}`;
    const occurrence = entryOccurrences.get(fingerprint) ?? 0;
    entryOccurrences.set(fingerprint, occurrence + 1);
    const id = deterministicId(user.id, occurrence, entry);
    operations.push(
      db.insert(entries).values({
        id,
        userId: user.id,
        kind: entry.kind,
        body: entry.body,
        chapter: entry.chapter,
        answeredAt: entry.answeredAt ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(entryThreads).values(
        [...new Set(entry.threads)].map((threadSlug) => ({
          entryId: id,
          userId: user.id,
          threadSlug,
        })),
      ),
    );
  }

  await db.batch(operations);
  console.log(
    `Seeded ${stageSeed.length} stages, ${threadSeed.length} threads, ` +
      `${personSeed.length} people, and ${entrySeed.length} entries.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exitCode = 1;
});
