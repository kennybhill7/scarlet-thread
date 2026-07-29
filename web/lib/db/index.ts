import "server-only";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";

const missingDatabaseUrl =
  "postgresql://configuration:missing@127.0.0.1:5432/bible_brain";

/**
 * Connection creation is intentionally network-lazy, so `next build` can run
 * before Neon credentials exist. Any database request still fails closed.
 */
export const db = drizzle(
  process.env.DATABASE_URL ?? missingDatabaseUrl,
  { schema },
);

export type Database = typeof db;
