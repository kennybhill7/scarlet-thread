import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
};

// Auth.js tables
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", {
    withTimezone: true,
    mode: "date",
  }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"oauth" | "oidc" | "email">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const entryKind = pgEnum("entry_kind", [
  "observation",
  "question",
  "note",
  "teaching",
]);

export const stageSide = pgEnum("stage_side", ["ascent", "peak", "descent"]);

export const entries = pgTable(
  "entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: entryKind("kind").notNull(),
    body: text("body").notNull(),
    chapter: text("chapter").notNull(),
    verse: text("verse"),
    answeredAt: timestamp("answered_at", {
      withTimezone: true,
      mode: "string",
    }),
    inkUrl: text("ink_url"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("entries_id_user_idx").on(table.id, table.userId),
    index("entries_user_updated_idx").on(table.userId, table.updatedAt),
    index("entries_user_chapter_idx").on(table.userId, table.chapter),
    index("entries_user_kind_idx").on(table.userId, table.kind),
  ],
);

export const threads = pgTable(
  "threads",
  {
    slug: text("slug").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    definition: text("definition").default("").notNull(),
    seeing: text("seeing").default("").notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.slug] }),
    index("threads_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

/**
 * This join table is the enforced reverse edge: linking an entry to a thread
 * creates one row that both the entry and thread views read.
 */
export const entryThreads = pgTable(
  "entry_threads",
  {
    entryId: text("entry_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadSlug: text("thread_slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.threadSlug] }),
    index("entry_threads_thread_idx").on(table.userId, table.threadSlug),
    foreignKey({
      columns: [table.entryId, table.userId],
      foreignColumns: [entries.id, entries.userId],
      name: "entry_threads_user_entry_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.threadSlug],
      foreignColumns: [threads.userId, threads.slug],
      name: "entry_threads_user_thread_fk",
    }).onDelete("cascade"),
  ],
);

export const people = pgTable(
  "people",
  {
    slug: text("slug").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").default("").notNull(),
    chapters: text("chapters").array().default([]).notNull(),
    threadSlugs: text("thread_slugs").array().default([]).notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.slug] })],
);

export const readingProgress = pgTable(
  "reading_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapter: text("chapter").notNull(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapter] }),
    index("reading_progress_user_read_idx").on(table.userId, table.readAt),
  ],
);

export const dailyLogs = pgTable(
  "daily_logs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    chapter: text("chapter"),
    read: boolean("read").default(false).notNull(),
    observe: boolean("observe").default(false).notNull(),
    link: boolean("link").default(false).notNull(),
    ask: boolean("ask").default(false).notNull(),
    pray: boolean("pray").default(false).notNull(),
    sentence: text("sentence").default("").notNull(),
    carrying: text("carrying").default("").notNull(),
    prayer: text("prayer").default("").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

export const stages = pgTable(
  "stages",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    stage: integer("stage").notNull(),
    side: stageSide("side").notNull(),
    mirror: text("mirror"),
    chapters: text("chapters").array().default([]).notNull(),
    summary: text("summary").default("").notNull(),
  },
  (table) => [uniqueIndex("stages_stage_idx").on(table.stage)],
);

export const syncReceipts = pgTable(
  "sync_receipts",
  {
    opId: text("op_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    clientUpdatedAt: timestamp("client_updated_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    acceptedAt: timestamp("accepted_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.opId] }),
    index("sync_receipts_user_accepted_idx").on(
      table.userId,
      table.acceptedAt,
    ),
  ],
);
