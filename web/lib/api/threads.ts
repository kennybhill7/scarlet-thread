import { z } from "zod";

export const threadSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Thread slugs must be kebab-case",
  });

export const createThreadSchema = z
  .object({
    slug: threadSlugSchema,
    title: z.string().trim().min(1).max(200),
    definition: z.string().trim().max(2_000).default(""),
    seeing: z.string().trim().max(100_000).default(""),
  })
  .strict();

export const updateThreadSchema = createThreadSchema
  .omit({ slug: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });
