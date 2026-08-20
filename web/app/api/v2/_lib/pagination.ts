import { z } from "zod";

import { V2_LIST_MAX_LIMIT } from "./queries";

/**
 * V2API-002 — the one `?limit=` schema every v2 list route parses with,
 * rather than each route hand-rolling its own bound. Accepts a positive
 * integer up to `V2_LIST_MAX_LIMIT` (200); omitted defaults to
 * `V2_LIST_DEFAULT_LIMIT` (50) once passed through to the query layer (see
 * `_lib/queries.ts`'s `resolveListLimit`, which re-clamps independently so
 * the bound holds even for a caller of the query layer that skips this
 * schema). An out-of-range value is a 400 (`invalidRequest`), not a silent
 * clamp, so a caller relying on more than 200 rows per page discovers that
 * immediately rather than silently getting a truncated page.
 */
export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(V2_LIST_MAX_LIMIT).optional(),
});

export type LimitQuery = z.infer<typeof limitQuerySchema>;
