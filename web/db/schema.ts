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
// (synced)" list), extended by SCHEMAFU-001 (see below). Strictly additive:
// nothing above this comment is touched.
//
// Every table here carries workspaceId + an integer revision from day one
// (§3.3: "cheap now and brutal to retrofit") plus the same created/updated/
// soft-delete timestamp shape v1's entries/threads/people already use — every
// interface in lib/contracts/study-v2.ts declares `deletedAt?: string | null`,
// so all eight use the shared `timestamps` spread below, unlike readingProgress/
// dailyLogs/stages/syncReceipts above which never soft-delete.
//
// SCHEMAFU-001 (gap a): `workspace_id` IS now foreign-keyed, to the
// `workspaces` table defined just below this comment (master plan §12.1: id,
// kind(personal), name, created_by, created_at, deleted_at — one personal
// workspace per user, created/backfilled by a separate data-migration task,
// not this schema task). SCHEMAV2-001 had deliberately left this column bare
// because no `workspaces` table existed yet; it now does.
//
// Tenant-safety pattern reused from `entries`/`entryThreads` above: parent
// tables a child must stay inside the same workspace for (studySessions,
// studyClaims, motifCandidates, and — new in SCHEMAFU-001 — userConnections
// and teachingDrafts) expose a composite UNIQUE(id, workspace_id) index, and
// every child FKs against that composite pair — not just the bare id — so a
// row can never reference a same-id-different-workspace parent.
//
// SCHEMAFU-001 (gap b/c) adds `claimEvidence.connectionId` (nullable FK into
// `userConnections`), `teachingSections`, and `artifactRevisions` — see each
// table's own comment below for what it resolves and what it still leaves
// open.
// ---------------------------------------------------------------------------

/**
 * SCHEMAFU-001 gap (a). Master plan §12.1 columns verbatim: `id`,
 * `kind(personal)`, `name`, `created_by`, `created_at`, `deleted_at` — no
 * `updated_at` is listed there, so unlike every v2 table below this does NOT
 * reuse the shared `timestamps` spread; it has exactly the four
 * timestamp-adjacent columns the plan states, nothing invented on top.
 *
 * Only `"personal"` is enumerated: §12.1 states plainly that
 * cohort/church workspaces, mentor roles, and sharing are deferred until
 * invite-only coaching is authorized, and `workspace_memberships`
 * (role/status) is separately-scoped, deferred territory the plan itself
 * calls out — neither is part of this task's four listed gaps, so neither is
 * added here.
 *
 * "Every user gets exactly one personal workspace conceptually" (this task's
 * acceptance criterion) is a data/backfill guarantee, not a schema-enforceable
 * one — a UNIQUE(created_by) index would wrongly forbid a future second
 * (e.g. cohort) workspace per user, which §12.1 explicitly anticipates. Left
 * unconstrained here; enforcing "exactly one personal workspace right now"
 * belongs to the bootstrap/backfill code path, not this table's shape.
 */
export const workspaceKindEnum = pgEnum("workspace_kind", ["personal"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    kind: workspaceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("workspaces_created_by_idx").on(table.createdBy),
    // Backs getOrCreatePersonalWorkspace's ON CONFLICT target (WORKSPACE-001
    // documented the race and named this exact index as the real fix — see
    // lib/db/workspaces.ts). Scoped to kind = 'personal' AND deleted_at IS
    // NULL rather than a plain UNIQUE(created_by): a user is allowed at most
    // one *live* personal workspace at a time, but a soft-deleted one must
    // not permanently block them from ever getting a replacement, and this
    // schema has no non-personal workspace kind yet for created_by to
    // legitimately repeat under.
    uniqueIndex("workspaces_created_by_personal_live_idx")
      .on(table.createdBy)
      .where(sql`${table.kind} = 'personal' AND ${table.deletedAt} IS NULL`),
  ],
);

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
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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

// userConnections is defined here, ahead of studyClaims/claimEvidence below,
// solely so claimEvidence's connectionId FK (SCHEMAFU-001 gap b) can reference
// it — drizzle-orm's `foreignKey()` needs the real column objects at call
// time, not a lazy callback, so the referenced table must already be a
// defined `const` by that point in this file. No other ordering reason.
export const userConnections = pgTable(
  "user_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    // SCHEMAFU-001: composite UNIQUE(id, workspace_id), the same tenant-safety
    // pattern studySessions/studyClaims/motifCandidates already use, so
    // claimEvidence.connectionId (below) can FK against this pair instead of
    // a bare id — a claim can never cite a connection from another workspace.
    uniqueIndex("user_connections_id_workspace_idx").on(table.id, table.workspaceId),
    // §3.2's first enforced constraint (same-row, so a plain CHECK suffices):
    // "personal_resonance connections require evidence_label = 'devotional'".
    // Mirrors lib/contracts/study-v2.ts's isPersonalResonanceEvidenceLabelValid
    // predicate exactly.
    //
    // The second §3.2 constraint — devotional-labeled evidence can never back
    // a theology claim — is cross-table (user_connections x claim_evidence x
    // study_claims). SCHEMAV2-001 could not implement it as a deferrable
    // constraint trigger (migration 0003's pattern) because claim_evidence had
    // no column identifying which user_connections row a "connection"-typed
    // evidence row cites, so a trigger had no join path; it deferred the rule
    // to the repository layer instead. SCHEMAFU-001 adds that column
    // (claimEvidence.connectionId, above/below) and implements the trigger in
    // migration 0007 — see that migration file and
    // tests/schema-followups.test.ts for the enforcement and its proof.
    check(
      "user_connections_personal_resonance_devotional_check",
      sql`${table.type} <> 'personal_resonance' OR ${table.evidenceLabel} = 'devotional'`,
    ),
  ],
);

export const studyClaims = pgTable(
  "study_claims",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    claimId: text("claim_id").notNull(),
    evidenceType: claimEvidenceTypeEnum("evidence_type").notNull(),
    /** Present when evidenceType anchors to a passage (passage | context | connection). */
    canonicalReference: jsonb("canonical_reference").$type<CanonicalRangeV1>(),
    displayReference: jsonb("display_reference").$type<DisplayReferenceV1>(),
    contentBlockId: text("content_block_id"),
    /** First-class citation id into the sources/citations model (not built yet — no FK target exists in this task's scope). */
    citationId: text("citation_id"),
    /**
     * SCHEMAFU-001 gap (b). Names WHICH `userConnections` row an
     * evidenceType:"connection" row cites — the column SCHEMAV2-001 reported
     * as missing (lib/contracts/study-v2.ts header, gap #5) and the reason
     * the §3.2 cross-table devotional/theology rule had no join path and was
     * deferred to the repository layer. Nullable because passage/context/
     * source evidence rows never use it. Composite-FK'd against
     * `(userConnections.id, userConnections.workspaceId)` — not a bare
     * single-column FK to `userConnections.id` — so a claim can never cite a
     * connection that lives in a different workspace; that would otherwise be
     * a tenant-isolation hole this repo's own tests (`tenant-isolation.test.ts`)
     * exist to catch. onDelete is CASCADE, not SET NULL, for the same reason
     * `motifSightings.claimId`'s FK below is CASCADE: this column is nullable
     * but the FK's other member, `workspaceId`, is NOT NULL on this table —
     * SET NULL on a multi-column FK nulls every column in that FK, which
     * would violate `workspace_id`'s own NOT NULL constraint the moment a
     * cited connection is deleted.
     */
    connectionId: text("connection_id"),
    note: text("note").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("claim_evidence_workspace_idx").on(table.workspaceId),
    index("claim_evidence_claim_idx").on(table.workspaceId, table.claimId),
    index("claim_evidence_connection_idx").on(table.workspaceId, table.connectionId),
    foreignKey({
      columns: [table.claimId, table.workspaceId],
      foreignColumns: [studyClaims.id, studyClaims.workspaceId],
      name: "claim_evidence_claim_workspace_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.connectionId, table.workspaceId],
      foreignColumns: [userConnections.id, userConnections.workspaceId],
      name: "claim_evidence_connection_workspace_fk",
    }).onDelete("cascade"),
  ],
);

export const motifCandidates = pgTable(
  "motif_candidates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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

export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    // SCHEMAFU-001: composite UNIQUE(id, workspace_id) so teachingSections
    // (below) can FK its draftId against this pair, same tenant-safety
    // pattern as userConnections above.
    uniqueIndex("teaching_drafts_id_workspace_idx").on(table.id, table.workspaceId),
    foreignKey({
      columns: [table.sessionId, table.workspaceId],
      foreignColumns: [studySessions.id, studySessions.workspaceId],
      name: "teaching_drafts_session_workspace_fk",
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// SCHEMAFU-001 gaps (c) and (d) — teaching_sections and artifact_revisions
// were named in BUILD_PLAN.md §3.3 prose but were outside SCHEMAV2-001's own
// acceptance list, so neither table exists until here.
// ---------------------------------------------------------------------------

/**
 * SCHEMAFU-001 gap (c). BUILD_PLAN.md §3.3 ("`teaching_drafts` +
 * `teaching_sections`") and THEOLOGY_MASTER_BUILD_PLAN.md §12.3
 * (`teaching_sections`) both give the SAME kind vocabulary verbatim — no
 * conflict to report between the two docs here, unlike gap #1 in
 * lib/contracts/study-v2.ts's header.
 *
 * Every other vocabulary in this file is imported from
 * `lib/contracts/study-v2.ts`, never retyped — this one is the deliberate
 * exception, and it's an exception this task cannot close: that contract
 * module does not export a teaching-section-kind vocabulary at all (it only
 * covers §3.2's canonical list plus a handful of §3.3 field vocabularies that
 * predate teaching_sections), and `lib/contracts/study-v2.ts` is a
 * *readOnlyPath* for this task — it may be read, never written. Adding the
 * missing export there is out of this task's scope by construction, not an
 * oversight. Transcribed by hand here instead, the same way SCHEMAV2-001
 * transcribed `study_claims.status` by hand while its contract source was
 * briefly stale (see the comment on `studyClaimStatusEnum` above) — except
 * this transcription cannot later collapse into an import the way that one
 * did, until a *future* task (outside SCHEMAFU-001's ownedPaths) adds the
 * export. Recommended follow-up, reported rather than smuggled per
 * SCOPE-BOUNDARY-001: add `TEACHING_SECTION_KINDS` to
 * lib/contracts/study-v2.ts and switch this line to import it.
 */
const TEACHING_SECTION_KINDS = [
  "outline",
  "context",
  "connection",
  "theology",
  "illustration",
  "objection",
  "application",
  "not_justified",
  "discussion",
  "prayer",
] as const;

export const teachingSectionKindEnum = pgEnum("teaching_section_kind", TEACHING_SECTION_KINDS);

export const teachingSections = pgTable(
  "teaching_sections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    draftId: text("draft_id").notNull(),
    kind: teachingSectionKindEnum("kind").notNull(),
    sortOrder: integer("sort_order").notNull(),
    body: text("body").notNull(),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("teaching_sections_workspace_idx").on(table.workspaceId),
    index("teaching_sections_draft_idx").on(table.workspaceId, table.draftId),
    // A section always belongs to a draft (BUILD_PLAN §3.3 lists draftId as a
    // required FK, not nullable), so this can cascade without the
    // nullable-column/NOT-NULL-workspace_id trap claimEvidence.connectionId
    // and motifSightings.claimId (above) both have to work around.
    foreignKey({
      columns: [table.draftId, table.workspaceId],
      foreignColumns: [teachingDrafts.id, teachingDrafts.workspaceId],
      name: "teaching_sections_draft_workspace_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * SCHEMAFU-001 gap (d). BUILD_PLAN.md line 126: the learner's first
 * observation is preserved permanently "via append-only `artifact_revisions`
 * rows — an integer revision counter alone is not the guarantee; every edit
 * inserts the prior body as an immutable row." THEOLOGY_MASTER_BUILD_PLAN.md
 * §14 lists it among the sync-v2 server records: "`artifact_revisions`:
 * immutable prior versions for prose conflicts and recovery."
 *
 * Neither document gives this table a column list the way §12.3 does for
 * every other table in this file — both mention it in prose only. The columns
 * below are this task's own inference of the minimum needed to satisfy
 * "append-only prior-version store" as a generic mechanism usable by more
 * than one revisioned entity (studyClaims, teachingDrafts, etc. all carry
 * their own `revision` counter and could each be the "prior body" being
 * preserved): `entityTable`/`entityId` name which row is being preserved,
 * `revision` records which revision of THAT row this snapshot represents
 * (deliberately NOT defaulted — the caller must always state it explicitly,
 * unlike every other `revision` column in this file), and `snapshot` holds
 * the prior row's full content as jsonb rather than a plain `body` text
 * column, because not every revisioned entity has a field literally named
 * `body` (TeachingDraft does not; StudyClaim does). This is a disclosed
 * inference, not a transcription — flagging for review rather than presenting
 * it as verified BUILD_PLAN text.
 *
 * Deliberately has NO `updatedAt`/`deletedAt`: nothing should ever update or
 * soft-delete a preserved revision — that would defeat the exact guarantee
 * this table exists to provide. `createdAt` alone records when the snapshot
 * was captured. Because of this it does not reuse the shared `timestamps`
 * spread (same reasoning as `workspaces` above), and it is deliberately
 * exempted from two of `tests/schema-v2.test.ts`'s generic v2-table sweep
 * assertions (revision-has-a-default, and the full created/updated/deleted
 * timestamp triple) — see that file for the explicit exemption and why.
 */
export const artifactRevisions = pgTable(
  "artifact_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Which table this snapshot preserves a prior version of, e.g. "study_claims". Polymorphic by design (no FK target — see motifCandidates.status above for the same "no enumerated values stated" reasoning applied to a table-name column instead of a status column). */
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id").notNull(),
    /** Which revision of the parent entity this snapshot captured — not this row's own identity, and intentionally has no default. */
    revision: integer("revision").notNull(),
    /** Full prior row content. jsonb, not text, because not every revisioned entity has a field literally called "body". */
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("artifact_revisions_workspace_idx").on(table.workspaceId),
    index("artifact_revisions_entity_idx").on(table.workspaceId, table.entityTable, table.entityId),
  ],
);
