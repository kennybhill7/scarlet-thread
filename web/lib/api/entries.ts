import { z } from "zod";

import { threadSlugSchema } from "@/lib/api/threads";

// Protestant canon chapter counts in canonical book-number order. Keeping this
// beside the shared reference schemas makes every API, sync, and local write
// reject well-shaped but nonexistent chapters such as Genesis 51 or Jude 2.
const chaptersPerBook = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42,
  150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
  28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5,
  3, 5, 1, 1, 1, 22,
] as const;

function chapterExists(value: string) {
  const [book, chapter] = value.split(".").map(Number);
  return chapter <= (chaptersPerBook[book - 1] ?? 0);
}

export const chapterRefSchema = z
  .string()
  .regex(/^(?:[1-9]|[1-5]\d|6[0-6])\.[1-9]\d{0,2}$/, {
    message: "Expected a canonical chapter key such as 1.3",
  })
  .refine(chapterExists, {
    message: "Chapter does not exist in the 66-book canon",
  });

export const verseRefSchema = z
  .string()
  .regex(
    /^(?:[1-9]|[1-5]\d|6[0-6])\.[1-9]\d{0,2}\.[1-9]\d{0,2}$/,
    { message: "Expected a canonical verse key such as 1.3.15" },
  )
  .refine((value) => chapterExists(value.split(".").slice(0, 2).join(".")), {
    message: "Verse chapter does not exist in the 66-book canon",
  });

export const inkUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine(
    (value) =>
      ["https:", "http:", "applenotes:", "mobilenotes:"].includes(
        new URL(value).protocol,
      ),
    { message: "Unsupported ink-link protocol" },
  );

const kindSchema = z.enum(["observation", "question", "note", "teaching"]);

const entryFields = {
  kind: kindSchema,
  body: z.string().trim().min(1).max(100_000),
  chapter: chapterRefSchema,
  verse: verseRefSchema.nullish(),
  threads: z
    .array(threadSlugSchema)
    .min(1, "Every passage entry must link at least one thread")
    .max(50),
  answeredAt: z.iso.datetime({ offset: true }).nullish(),
  inkUrl: inkUrlSchema.nullish(),
};

function validateEntryShape(
  value: {
    kind?: string;
    chapter?: string;
    verse?: string | null;
    answeredAt?: string | null;
  },
  context: z.RefinementCtx,
) {
  if (
    value.chapter &&
    value.verse &&
    !value.verse.startsWith(`${value.chapter}.`)
  ) {
    context.addIssue({
      code: "custom",
      path: ["verse"],
      message: "Verse must belong to the entry chapter",
    });
  }

  if (value.kind && value.kind !== "question" && value.answeredAt) {
    context.addIssue({
      code: "custom",
      path: ["answeredAt"],
      message: "Only questions can be marked answered",
    });
  }
}

export const createEntrySchema = z
  .object({
    id: z.uuid().optional(),
    ...entryFields,
  })
  .strict()
  .superRefine(validateEntryShape);

export const updateEntrySchema = z
  .object(entryFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  })
  .superRefine(validateEntryShape);

export const listEntriesQuerySchema = z.object({
  chapter: chapterRefSchema.optional(),
  kind: kindSchema.optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
