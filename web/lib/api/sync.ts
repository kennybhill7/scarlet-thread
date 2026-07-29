import { z } from "zod";

import {
  chapterRefSchema,
  inkUrlSchema,
  verseRefSchema,
} from "@/lib/api/entries";
import { threadSlugSchema } from "@/lib/api/threads";

const timestampSchema = z.iso.datetime({ offset: true });

export const syncEntrySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["observation", "question", "note", "teaching"]),
    body: z.string().min(1).max(100_000),
    chapter: chapterRefSchema,
    verse: verseRefSchema.optional(),
    threads: z.array(threadSlugSchema).max(50),
    answeredAt: timestampSchema.nullish(),
    inkUrl: inkUrlSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.verse && !entry.verse.startsWith(`${entry.chapter}.`)) {
      context.addIssue({
        code: "custom",
        path: ["verse"],
        message: "Verse must belong to the entry chapter",
      });
    }
    if (entry.kind !== "question" && entry.answeredAt) {
      context.addIssue({
        code: "custom",
        path: ["answeredAt"],
        message: "Only questions can be marked answered",
      });
    }
    if (!entry.deletedAt && entry.threads.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["threads"],
        message: "Every active passage entry must link at least one thread",
      });
    }
  });

export const syncThreadSchema = z
  .object({
    slug: threadSlugSchema,
    title: z.string().min(1).max(200),
    definition: z.string().max(2_000),
    seeing: z.string().max(100_000),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict();

export const syncProgressSchema = z
  .object({
    chapter: chapterRefSchema,
    readAt: timestampSchema,
  })
  .strict();

export const syncLogSchema = z
  .object({
    date: z.iso.date(),
    chapter: chapterRefSchema.nullable(),
    steps: z
      .object({
        read: z.boolean(),
        observe: z.boolean(),
        link: z.boolean(),
        ask: z.boolean(),
        pray: z.boolean(),
      })
      .strict(),
    sentence: z.string().max(10_000),
    carrying: z.string().max(10_000),
    prayer: z.string().max(20_000),
    updatedAt: timestampSchema,
  })
  .strict();

export const syncPersonSchema = z
  .object({
    slug: threadSlugSchema,
    name: z.string().trim().min(1).max(200),
    body: z.string().max(100_000),
    chapters: z.array(chapterRefSchema).max(1_189),
    threads: z.array(threadSlugSchema).max(200),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const syncOpSchema = z
  .object({
    id: z.uuid(),
    // Stages are global seeded reference data, not user-authored sync state.
    entity: z.enum(["entry", "thread", "person", "progress", "log"]),
    entityId: z.string().min(1).max(200),
    op: z.enum(["upsert", "delete"]),
    payload: z.unknown(),
    updatedAt: timestampSchema,
    syncedAt: timestampSchema.nullish().optional(),
  })
  .strict();

export const syncPushSchema = z
  .object({
    ops: z.array(syncOpSchema).max(500),
  })
  .strict();

export const syncPullQuerySchema = z.object({
  since: timestampSchema.nullable(),
});

export const syncResponseSchema = z
  .object({
    entries: z.array(syncEntrySchema),
    threads: z.array(syncThreadSchema),
    people: z.array(syncPersonSchema),
    progress: z.array(syncProgressSchema),
    logs: z.array(syncLogSchema),
    rejected: z.array(
      z
        .object({
          id: z.uuid(),
          reason: z.string().min(1).max(2_000),
        })
        .strict(),
    ),
    serverTime: timestampSchema,
  })
  .strict();
