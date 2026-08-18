import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { CanonicalRangeV1, DisplayReferenceV1 } from "@/lib/contracts/range-v1";
import {
  CLAIM_CONFIDENCES,
  CLAIM_EVIDENCE_TYPES,
  CLAIM_KINDS,
  CLAIM_PROVENANCES,
  CONNECTION_TYPES,
  DOCTRINE_STATUSES,
  EPISTEMIC_BASES,
  EVIDENCE_LABELS,
  MODERN_DOMAINS,
  RESPONSE_TYPES,
  STUDY_SESSION_CONNECTION_STATES,
  STUDY_SESSION_MODES,
  STUDY_SESSION_WORKFLOW_STATES,
  STUDY_CLAIM_STATUSES,
  USER_CONNECTION_STATUSES,
} from "@/lib/contracts/study-v2";

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

// ---------------------------------------------------------------------------
// v2 learner tables — SCHEMAV2-001, Phase 1 (BUILD_PLAN.md §3.3, "User-owned
// (synced)" list). Strictly additive: nothing above this comment is touched.
//
// Every table here carries workspaceId + an integer revision from day one
// (§3.3: "cheap now and brutal to retrofit") plus the same created/updated/
// soft-delete timestamp shape v1's entries/threads/people already use — every
// interface in lib/contracts/study-v2.ts declares `deletedAt?: string | null`,
// so all eight use the shared `timestamps` spread below, unlike readingProgress/
// dailyLogs/stages/syncReceipts above which never soft-delete.
//
// `workspace_id` is NOT foreign-keyed to `users.id` here. BUILD_PLAN §3.3 says
// only "one personal workspace per user, backfilled" — it never defines a
// `workspaces` table, and none exists in this schema. Inventing an FK to
// `users` would silently assert workspace_id === user_id forever, which is
// exactly the kind of guess this task was told to avoid making. Reported gap:
// a future task must either add a `workspaces` table (and FK these columns to
// it) or explicitly confirm the 1:1 user mapping and FK to `users.id`.
//
// Tenant-safety pattern reused from `entries`/`entryThreads` above: parent
// tables a child must stay inside the same workspace for (studySessions,
// studyClaims, motifCandidates) expose a composite UNIQUE(id, workspace_id)
// index, and every child FKs against that composite pair — not just the bare
// id — so a row can never reference a same-id-different-workspace parent.
// ---------------------------------------------------------------------------

export const claimKindEnum = pgEnum("claim_kind", CLAIM_KINDS);
export const epistemicBasisEnum = pgEnum("epistemic_basis", EPISTEMIC_BASES);
export const claimConfidenceEnum = pgEnum("claim_confidence", CLAIM_CONFIDENCES);
export const claimProvenanceEnum = pgEnum("claim_provenance", CLAIM_PROVENANCES);
export const connectionTypeEnum = pgEnum("connection_type", CONNECTION_TYPES);
export const evidenceLabelEnum = pgEnum("evidence_label", EVIDENCE_LABELS);
export const doctrineStatusEnum = pgEnum("doctrine_status", DOCTRINE_STATUSES);
export const claimEvidenceTypeEnum = pgEnum("claim_evidence_type", CLAIM_EVIDENCE_TYPES);
export const studySessionModeEnum = pgEnum("study_session_mode", STUDY_SESSION_MODES);
export const studySessionWorkflowStateEnum = pgEnum(
  "study_session_workflow_state",
  STUDY_SESSION_WORKFLOW_STATES,
);
export const studySessionConnectionStateEnum = pgEnum(
  "study_session_connection_state",
  STUDY_SESSION_CONNECTION_STATES,
);
export const userConnectionStatusEnum = pgEnum("user_connection_status", USER_CONNECTION_STATUSES);
export const modernDomainEnum = pgEnum("modern_domain", MODERN_DOMAINS);
export const responseTypeEnum = pgEnum("response_type", RESPONSE_TYPES);

/**
 * Imported from the contract module like every other v2 enum. The contract's
 * STUDY_CLAIM_STATUSES was briefly stale at three values while BUILD_PLAN.md
 * had already been corrected to the master plan's four; SCHEMAV2-001 caught
 * the disagreement and transcribed the correct four locally rather than
 * freeze the wrong vocabulary into this migration. The contract has since
 * been fixed, so the local transcription is gone and there is one source of
 * truth again.
 */
export const studyClaimStatusEnum = pgEnum("study_claim_status", STUDY_CLAIM_STATUSES);

export const studySessions = pgTable(
  "study_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    range: jsonb("range").$type<CanonicalRangeV1>().notNull(),
    mode: studySessionModeEnum("mode").notNull(),
    workflowState: studySessionWorkflowStateEnum("workflow_state").notNull(),
    connectionState: studySessionConnectionStateEnum("connection_state").notNull(),
    /** Curated catalog/curriculum release this session is pinned to, if any. */
    catalogReleaseId: text("catalog_release_id"),
    readGateAt: timestamp("read_gate_at", { withTimezone: true, mode: "string" }),
    currentStep: text("current_step").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("study_sessions_id_workspace_idx").on(table.id, table.workspaceId),
    index("study_sessions_workspace_idx").on(table.workspaceId),
  ],
);

export const studyClaims = pgTable(
  "study_claims",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sessionId: text("session_id").notNull(),
    kind: claimKindEnum("kind").notNull(),
    epistemicBasis: epistemicBasisEnum("epistemic_basis").notNull(),
    body: text("body").notNull(),
    passage: jsonb("passage").$type<CanonicalRangeV1>().notNull(),
    confidence: claimConfidenceEnum("confidence").notNull(),
    provenance: claimProvenanceEnum("provenance").notNull(),
    /** Theology claims only (BUILD_PLAN §3.3); null for every other ClaimKind. */
    doctrineStatus: doctrineStatusEnum("doctrine_status"),
    viewpointId: text("viewpoint_id"),
    status: studyClaimStatusEnum("status").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("study_claims_id_workspace_idx").on(table.id, table.workspaceId),
    index("study_claims_workspace_idx").on(table.workspaceId),
    index("study_claims_workspace_passage_idx").on(table.workspaceId, table.passage),
    index("study_claims_workspace_kind_idx").on(table.workspaceId, table.kind),
    foreignKey({
      columns: [table.sessionId, table.workspaceId],
      foreignColumns: [studySessions.id, studySessions.workspaceId],
      name: "study_claims_session_workspace_fk",
    }).onDelete("cascade"),
  ],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    claimId: text("claim_id").notNull(),
    evidenceType: claimEvidenceTypeEnum("evidence_type").notNull(),
    /** Present when evidenceType anchors to a passage (passage | context | connection). */
    canonicalReference: jsonb("canonical_reference").$type<CanonicalRangeV1>(),
    displayReference: jsonb("display_reference").$type<DisplayReferenceV1>(),
    contentBlockId: text("content_block_id"),
    /** First-class citation id into the sources/citations model (not built yet — no FK target exists in this task's scope). */
    citationId: text("citation_id"),
    note: text("note").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("claim_evidence_workspace_idx").on(table.workspaceId),
    index("claim_evidence_claim_idx").on(table.workspaceId, table.claimId),
    foreignKey({
      columns: [table.claimId, table.workspaceId],
      foreignColumns: [studyClaims.id, studyClaims.workspaceId],
      name: "claim_evidence_claim_workspace_fk",
    }).onDelete("cascade"),
  ],
);

export const motifCandidates = pgTable(
  "motif_candidates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    label: text("label").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    /** No enumerated values in either source doc (BUILD_PLAN §3.3 warning block) — plain text, not a guessed enum. */
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("motif_candidates_id_workspace_idx").on(table.id, table.workspaceId),
    index("motif_candidates_workspace_idx").on(table.workspaceId),
    index("motif_candidates_workspace_key_idx").on(table.workspaceId, table.normalizedKey),
  ],
);

export const motifSightings = pgTable(
  "motif_sightings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    /** Stable key of the curated passage_unit this sighting falls in. */
    passageUnitKey: text("passage_unit_key").notNull(),
    exactRange: jsonb("exact_range").$type<CanonicalRangeV1>().notNull(),
    /** entries.id is a global primary key (see F1, tests/tenant-isolation.test.ts) — a single-column FK is sound without a workspace pairing. */
    entryId: text("entry_id").references(() => entries.id, { onDelete: "set null" }),
    claimId: text("claim_id"),
    /** No enumerated values in either source doc (BUILD_PLAN §3.3 warning block) — plain text, not a guessed enum. */
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("motif_sightings_workspace_idx").on(table.workspaceId),
    index("motif_sightings_candidate_idx").on(table.workspaceId, table.candidateId),
    foreignKey({
      columns: [table.candidateId, table.workspaceId],
      foreignColumns: [motifCandidates.id, motifCandidates.workspaceId],
      name: "motif_sightings_candidate_workspace_fk",
    }).onDelete("cascade"),
    // claimId is nullable but workspaceId (the FK's other column) is NOT
    // NULL on this table — ON DELETE SET NULL on a multi-column FK nulls
    // every column in that FK, which would violate workspace_id's own
    // NOT NULL constraint the moment a referenced claim is deleted. CASCADE
    // avoids that trap (same reasoning entryThreads' FKs above already use).
    foreignKey({
      columns: [table.claimId, table.workspaceId],
      foreignColumns: [studyClaims.id, studyClaims.workspaceId],
      name: "motif_sightings_claim_workspace_fk",
    }).onDelete("cascade"),
  ],
);

export const userConnections = pgTable(
  "user_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    fromRange: jsonb("from_range").$type<CanonicalRangeV1>().notNull(),
    toRange: jsonb("to_range").$type<CanonicalRangeV1>().notNull(),
    type: connectionTypeEnum("type").notNull(),
    evidenceLabel: evidenceLabelEnum("evidence_label").notNull(),
    /** Required, minimum 20 characters (BUILD_PLAN §3.3) — enforced by repository-layer validation, not this column. */
    rationale: text("rationale").notNull(),
    threadSlug: text("thread_slug"),
    status: userConnectionStatusEnum("status").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_connections_workspace_range_type_idx").on(
      table.workspaceId,
      table.fromRange,
      table.toRange,
      table.type,
    ),
    index("user_connections_workspace_idx").on(table.workspaceId),
    // §3.2's first enforced constraint (same-row, so a plain CHECK suffices):
    // "personal_resonance connections require evidence_label = 'devotional'".
    // Mirrors lib/contracts/study-v2.ts's isPersonalResonanceEvidenceLabelValid
    // predicate exactly.
    //
    // The second §3.2 constraint — devotional-labeled evidence can never back
    // a theology claim — is cross-table (user_connections x claim_evidence x
    // study_claims) and is DELIBERATELY NOT implemented as a deferrable
    // constraint trigger here, unlike migration 0003's entry/thread triggers.
    // A trigger needs a join path from claim_evidence to the specific
    // user_connections row a "connection"-typed evidence row cites, and no
    // such column exists: lib/contracts/study-v2.ts's own header (gap #5)
    // documents that neither BUILD_PLAN.md nor THEOLOGY_MASTER_BUILD_PLAN.md
    // ever defines a connectionId (or similar) field on claim_evidence.
    // Inventing one here would be exactly the kind of undocumented, guessed
    // schema addition this task was told to avoid. DECISION: this rule is
    // deferred to the repository layer (BUILD_PLAN §3.2 already requires
    // repository-layer validation as one of the three layers regardless);
    // tests/schema-v2.test.ts locks in the missing-column fact so this
    // decision gets revisited, not silently stale, the moment the column
    // exists. Follow-up: once claim_evidence names that column, add the
    // deferrable constraint trigger (see migration 0003's pattern) in the
    // task that adds it.
    check(
      "user_connections_personal_resonance_devotional_check",
      sql`${table.type} <> 'personal_resonance' OR ${table.evidenceLabel} = 'devotional'`,
    ),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sessionId: text("session_id").notNull(),
    sourceClaimId: text("source_claim_id").notNull(),
    originalAudienceMeaning: text("original_audience_meaning").notNull(),
    enduringPrinciple: text("enduring_principle").notNull(),
    /** Prose bridge from original meaning to today, not a passage range. */
    canonicalBridge: text("canonical_bridge").notNull(),
    /** No enumerated values in either source doc (BUILD_PLAN §3.3 warning block) — plain text, not a guessed enum. */
    applicationClass: text("application_class").notNull(),
    /** No enumerated values in either source doc (BUILD_PLAN §3.3 warning block) — plain text, not a guessed enum. */
    promiseScope: text("promise_scope").notNull(),
    modernDomain: modernDomainEnum("modern_domain").notNull(),
    situation: text("situation").notNull(),
    responseType: responseTypeEnum("response_type").notNull(),
    faithfulResponse: text("faithful_response").notNull(),
    cautions: text("cautions").notNull(),
    availableAfter: timestamp("available_after", { withTimezone: true, mode: "string" }),
    /** No enumerated values in either source doc (BUILD_PLAN §3.3 warning block) — plain text, not a guessed enum. */
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("applications_workspace_idx").on(table.workspaceId),
    foreignKey({
      columns: [table.sessionId, table.workspaceId],
      foreignColumns: [studySessions.id, studySessions.workspaceId],
      name: "applications_session_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceClaimId, table.workspaceId],
      foreignColumns: [studyClaims.id, studyClaims.workspaceId],
      name: "applications_source_claim_workspace_fk",
    }).onDelete("cascade"),
  ],
);

export const teachingDrafts = pgTable(
  "teaching_drafts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sessionId: text("session_id").notNull(),
    title: text("title").notNull(),
    bigIdea: text("big_idea").notNull(),
    audience: text("audience").notNull(),
    /** The four vision formats (60-second/5-minute/15-minute/30-minute) are UI presets that set this; not a separate column (BUILD_PLAN §3.3). */
    durationMinutes: integer("duration_minutes").notNull(),
    gospelConnection: text("gospel_connection").notNull(),
    /** No enumerated values in either source doc (BUILD_PLAN §3.3 warning block) — plain text, not a guessed enum. */
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("teaching_drafts_workspace_idx").on(table.workspaceId),
    foreignKey({
      columns: [table.sessionId, table.workspaceId],
      foreignColumns: [studySessions.id, studySessions.workspaceId],
      name: "teaching_drafts_session_workspace_fk",
    }).onDelete("cascade"),
  ],
);
