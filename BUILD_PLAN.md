# Scarlet Thread — Full Build-Out Plan

**Date:** 2026-08-12 (revised same date after reconciliation)
**Input:** `THEOLOGY_PRODUCT_AUDIT.md` (the "why").
**Authority:** `THEOLOGY_MASTER_BUILD_PLAN.md` is the authoritative product/architecture spec; this file is the shorter execution checklist, reconciled to its §30 findings. Where the two disagree, the master plan wins.
**Goal:** Turn Scarlet Thread from a Scripture reader + connection journal into a **formation system**: Read → Observe → Context → Interpret → Connect → Theology → Conviction → Practice → Teach.
**Current v1 stack:** Next.js 16.2 / React 19.2, Drizzle + Neon Postgres, NextAuth v5 (Google), IndexedDB offline vault with client-clock last-write-wins sync, Node test runner (35 tests at this baseline). Phase 1 retires client-clock LWW in favor of the revision/cursor/conflict protocol in §3.4; it is current behavior, not an end-state architecture choice.

---

## 0. Design tenets (fixed for every phase)

1. **Read before you write.** No commentary, context, or AI surface unlocks until the passage is marked read and one observation exists. Enforced in UI state, not honor system.
2. **Evidence and inference never share a field.** Every stored claim carries a `kind`, an `epistemicBasis`, and evidence refs. This is the single biggest schema change.
3. **Curated ≠ personal.** Curated content lives in versioned repo files compiled into immutable releases; user content lives in workspace-scoped DB rows. The UI must always show which one it is displaying. They never mix in one table — learner `user_connections` and reviewed `graph_edges` are different records.
4. **Additive contracts only.** v1 `lib/contracts.ts` stays byte-stable; new types live in versioned modules (`lib/contracts/study-v2.ts`, `content-v1.ts`, `graph-v1.ts`). Client-clock last-write-wins is retired **in Phase 1**, not at some future milestone — one person on a phone and a laptop is already a multi-device product, and long-form prose (teaching drafts) must never be silently overwritten.
5. **Fail closed.** Missing seed, missing verse map, missing production env = explicit error state, never an empty-success screen.
6. **Tests certify software; a pastor certifies theology.** Every curated lesson names its `author` in frontmatter and is approved through structured `content_reviews` records (reviewer, discipline, decision, timestamp — master plan §12.4); `publish.ts` enforces author ≠ reviewer and discipline-specific approvals before `published`. Self-attested frontmatter is not a review.
7. **One write path.** Sync push is the sole browser mutation path for learner entities (master plan §14); resource routes are read-only. The browser never both enqueues an op and calls an independent REST mutation.

---

## 1. End-state architecture

```
web/
  app/(app)/
    read/[book]/[chapter]/      existing reader (kept)
    study/[sessionId]/          NEW Passage Workspace (resumable study sessions)
    threads/[slug]/             existing (gains typed connections)
    doctrines/ [slug]/          NEW Doctrine Library
    life/ [case]/               Modern Life Lab (post-public-V1, §6)
    # Teach-back remains section 8 of study/[sessionId] for public V1.
    review/                     existing (renamed metrics, live data)
  db/schema.ts                  new tables (§3)
  lib/contracts/                versioned v2 modules, additive (§3)
  scripts/content/              NEW compiler: validate, build, publish, verify-release

content/                        NEW at repo root (master plan §11) — the single authoring source
  curriculum/genesis-foundations/   lesson MDX + frontmatter
  curriculum/matthew/
  contexts/                     PassageContext JSON per literary unit
  connections/                  curated typed graph edges JSON
  doctrines/                    doctrine articles + positions
  sources/                      master source registry
```

Curated content compiles into **immutable, checksummed catalog releases** (§5.1) consumed identically by the app, the offline downloader, and the APIs — never mutated after publish, never dependent on staying inside one Vercel deployment. User study work flows through the IndexedDB outbox → **sync push** → Postgres. Versioned v2 aggregate roots carry children such as claim evidence and ordered teaching sections; sync push is the only browser write path (tenet 7).

---

## 2. Phase 0 — Truthful & safe foundation (do first, ~1–2 weeks)

Ship nothing user-facing until these 12 gates close. Each maps to an audit finding (0.12 to the post-audit `c29de2e` commit).

| # | Gate | Where | Done when |
|---|------|-------|-----------|
| 0.1 | Neon + Google OAuth configured on Vercel | Vercel env, `lib/auth/config.ts`, `lib/auth/allowlist.ts` | Real sign-in on the preview URL; the single-email `AUTH_ALLOWED_EMAIL` allowlist extended to a controlled invite/test list; then two test Google accounts cannot see each other's entries via **application-level predicates** (tenant-isolation test in `tests/`; hostile RLS verification is the Phase 1 re-proof, §3.3) |
| 0.2 | Private seed out of build path | `lib/vault/seed.ts`, `db/seed.ts` | Seed content migrates via `db:seed` into Ken's DB row set; `data/seed/` no longer read at build |
| 0.3 | Setup-incomplete state | `app/(app)/review/page.tsx`, `lib/api/response.ts` | Missing DB/env renders a labeled setup error, never empty arrays |
| 0.4 | Offline nav for unvisited chapters | service worker + `lib/bible/loader.ts` | Unvisited dynamic chapter route works offline or shows an explicit offline notice |
| 0.5 | Verse-map fail-closed | `lib/bible/versemap.ts` | Missing alignment map disables parallel pane with a notice; test added |
| 0.6 | Non-destructive corpus generation | `tools/` scripts | Regeneration writes to a staging dir, diff-validates verse counts vs known-good before replacing |
| 0.7 | Verse selection end-to-end | `contracts.ts` `Entry.verse` already exists; wire `ChapterReader` tap-to-select → `NoteComposer` | Verse refs survive capture → sync → export; import backfills where recoverable |
| 0.8 | Sign-out + clear-local-data + cache purge | `components/auth/DeviceSessionControls.tsx`, `lib/sync/clear.ts` | Sign-out purges IndexedDB and SW caches; tested with fake-indexeddb |
| 0.9 | Security headers | `next.config.ts` | CSP, `X-Frame-Options`/`frame-ancestors`, `nosniff`, referrer-policy, permissions-policy present on all routes |
| 0.10 | Dependency audit clean | `package.json` overrides | `npm audit` 0 high; the production-path `nanoid` advisory resolved |
| 0.11 | Licensing decision | `contracts.ts` VersionMeta, Settings | KJV UK Crown-copyright question answered (geo-note or drop); licence text rendered in Settings; `CODEX_AUDIT.md` updated |
| 0.12 | Remove the `c29de2e` migrate-on-build hook | `web/vercel.json` | The `buildCommand` migrate hook is deleted (an env check is insufficient — it still migrates before the build is proven). Replacement: a serialized release job with database-identity checks, locking, backup/readiness checks, expand-contract migrations, and post-migration verification. No history rewrite; no rolling back migrations that may have already run |

**Exit criterion:** the Vercel URL is a working single-user app with verified application-level account isolation, **and zero critical/high privacy, Scripture-correctness, security, or data-loss findings remain open** in `CODEX_AUDIT.md` or `THEOLOGY_PRODUCT_AUDIT.md`. Only then is it honest to call it deployed.

---

## 3. Phase 1 — Evidence model (~4–6 weeks)

The data layer everything else stands on. All schema below is additive; existing tables untouched.

### 3.1 New reference type (contracts) — freeze this before any v2 table

The master plan §10 shapes are used verbatim — same names, same fields:

```ts
/** Canonical, translation-independent range. Cross-chapter allowed (Gen 1:1–2:3). */
export interface CanonicalRangeV1 {
  versificationId: "eng-protestant-66-31102-v1";
  start: RefKey; // "1.1.1"
  end: RefKey;   // inclusive; same book, cross-chapter OK
}

/** What the learner actually saw: canonical range mapped into one translation. */
export interface DisplayReferenceV1 {
  canonicalRange: CanonicalRangeV1;
  translationId: VersionId;
  corpusReleaseId: string;
  mappedStart: RefKey;
  mappedEnd: RefKey;
}
```

Display references map through the versioned verse map per translation (SBL's Romans 14/16 divergences are already documented in `tools/versification-report.md`). Every quoted evidence record stores a `DisplayReferenceV1` — translation + corpus release included — so a later text or verse-map update cannot silently change what the learner saw. Parsing/formatting joins `lib/bible/reference.ts` with tests: round-trip, canonical ordering, bounds against the real corpus, SBL mapping.

**Contract/storage boundary:** TypeScript, API, and sync DTO keys use camelCase. Postgres columns and compiled release-document keys use snake_case. Serialized enum values use the same snake_case literal on both sides. `canonicalRange` maps to `canonical_range = {versification_id,start,end}` and `displayReference` maps to `display_reference = {canonical_range,translation_id,corpus_release_id,mapped_start,mapped_end}`. Repository/compiler mappers are the sole conversion boundary; direct casts between DTOs and storage rows are forbidden. Round-trip fixtures must prove no field, inclusive endpoint, or versification/release identifier is lost.

### 3.2 New enums

**This is the one canonical vocabulary.** Postgres enums, JSON payloads, and both planning documents use these snake_case serialized values verbatim (master plan §7 and §12 use the same list); no table, contract, or doc may introduce variant spellings.

```ts
export type ClaimKind =
  | "observation" | "question" | "context" | "interpretation"
  | "theology" | "conviction" | "application" | "teaching_seed";
/** What kind of warrant stands behind the claim. */
export type EpistemicBasis =
  | "text_explicit" | "historical_context" | "inference" | "canonical_synthesis"
  | "tradition" | "prudential_judgment" | "personal_reflection";
export type ClaimConfidence = "tentative" | "developing" | "well_supported";
export type ClaimProvenance = "learner" | "imported";
export type ConnectionType =
  | "quotation" | "explicit_reference" | "allusion" | "motif"
  | "promise_fulfillment" | "type_antitype" | "covenant_development"
  | "contrast_reversal" | "parallel" | "doctrinal_synthesis"
  | "personal_resonance";
/** How firmly the evidence supports a connection. "devotional" legitimizes
 *  personal resonance without letting it quietly upgrade into doctrine. */
export type EvidenceLabel = "explicit" | "strong" | "plausible" | "devotional";
/** Matches master plan doctrine_status.
 *  core       = historic essentials of the Christian faith;
 *  conviction = the product's disclosed adopted secondary conclusion where
 *               faithful traditions differ; alternatives remain visible;
 *  open       = intentionally unresolved because evidence underdetermines it
 *               or editorial ratification is incomplete;
 *  disputed   = actively contested interpretive/historical propositions shown
 *               comparatively with named positions and competent review;
 *  wisdom     = prudential judgment applying Scripture, not doctrine. */
export type DoctrineStatus = "core" | "conviction" | "open" | "disputed" | "wisdom";
export type ClaimStatus = "draft" | "revisited" | "confirmed" | "needs_revision";
export type ConnectionStatus = "draft" | "revisited" | "confirmed";
export type ApplicationStatus = "draft" | "finalized" | "revisited" | "needs_revision";
export type TeachingDraftStatus = "draft" | "draft_complete" | "rehearsed" | "self_reviewed";
export type ThreadOrigin = "starter" | "imported" | "learner_promoted";
export type WorkflowState = "active" | "closed" | "archived";
/** Derived projection; never stored on study_sessions. */
export type ThreadResolution = "unexamined" | "provisional" | "linked" | "needs_connection";
export type ComparisonOutcome = "connection_created" | "no_warrant_yet" | "substantive_uncertainty";
export type FormationAttemptStage = "observe" | "interpret" | "apply";
export type RevealArtifact =
  | "scripture_loaded" | "read_marker" | "observation_claim" | "observation_uncertainty"
  | "interpretation_claim" | "interpretation_uncertainty" | "comparison_attempt"
  | "finalized_application" | "application_uncertainty" | "teaching_draft";
export interface RevealAfter {
  surface:
    | "observe_help" | "context_help" | "connection_help" | "theology_help"
    | "application_help" | "teach_builder" | "teach_feedback";
  requiresAll?: RevealArtifact[];
  requiresAny?: RevealArtifact[];
}
```

Canonical DTO/storage mappings for every disputed field are fixed before migrations:

| DTO / contract | Postgres / release storage |
|---|---|
| `canonicalRange`, `displayReference` | `canonical_range`, `display_reference` |
| `workflowState`, `resumeStep` | `workflow_state`, `resume_step` |
| derived `threadResolution` | no session column; query projection from normalized artifacts |
| `claimKind`, `epistemicBasis`, `doctrineStatus`, `status` | `claim_kind`, `epistemic_basis`, `doctrine_status`, `status` |
| `sourceRange`, `destinationRange`, `passageScopeKey` | `source_range`, `destination_range`, `passage_scope_key` |
| `comparisonAttemptId`, `formationAttemptId` | `comparison_attempt_id`, `formation_attempt_id` |
| `bigIdea`, `durationMinutes`, `gospelConnection`, `sortOrder` | `big_idea`, `duration_minutes`, `gospel_connection`, `sort_order` |

The v2 Zod schemas, Drizzle repositories, sync payloads, export, and import share fixtures for this map; no alternate `revisit`, `connection_identified`, `uncertain`, `current_step`, or camelCase storage alias is accepted.

**Enforced constraints, not conventions:** `personal_resonance` connections require `evidence_label = 'devotional'` — a same-row `CHECK`, trivially enforceable. The second rule — devotional-labeled connections can never be cited as `claim_evidence` for a theology claim nor appear in curated doctrine — is **cross-table, so a plain PostgreSQL `CHECK` cannot enforce it**: implement it as a deferrable constraint trigger (or a schema design that makes the invalid row unrepresentable), plus repository-layer validation, content CI, and tests. All three layers are required work, not options.

### 3.3 New tables (Drizzle; user tables workspace-scoped w/ soft delete, curated tables are read-only release indexes)

**User-owned (synced).** Every table below carries `workspace_id` (one personal workspace per user, backfilled). Every aggregate root carries an integer `revision`; each child row also retains its row revision, and a child edit advances the owning root revision. The bullets use camelCase for DTO properties and backticked snake_case for exact Postgres columns; repository mappers implement the §3.1 boundary. Isolation lands in two verifiable steps: **Phase 0** proves application-level isolation (route/repository workspace predicates, two test accounts, no cross-reads); **Phase 1** adds transaction-scoped RLS (`set_config('app.workspace_id', ..., true)` per master plan §12.1) plus account-scoped IndexedDB and re-proves isolation with hostile two-user tests — RLS is defense in depth on top of the Phase 0 predicates, not the thing the Phase 0 test waits for.

- `study_sessions` — exact storage is `id`, `workspace_id`, `created_by`, `mode`, `workflow_state` (WorkflowState), canonical range, optional `passage_unit_id`, optional `catalog_release_id`, `read_gate_at`, `resume_step`, `revision`, timestamps, `deleted_at`. The DTO uses `workspaceId`, `createdBy`, `workflowState`, `passageUnitId`, `catalogReleaseId`, `readGateAt`, and `resumeStep`. Session lifecycle is the only stored state: **there is no `thread_resolution` column**. `ThreadResolution` is a query projection with precedence: `linked` when an active normalized `study_thread_sightings` row exists; else `provisional` when an active motif sighting exists; else `needs_connection` when a persisted comparison attempt has no created connection; else `unexamined`. `resumeStep` is navigation preference only and never gate evidence. The workspace routes by **sessionId**, not book/chapter.
- `study_claims` — id, workspaceId, sessionId, kind (ClaimKind), epistemicBasis (EpistemicBasis), body, passage (CanonicalRangeV1), confidence (ClaimConfidence), provenance (ClaimProvenance), doctrineStatus (theology claims only), viewpoint (nullable), status (ClaimStatus: draft | revisited | confirmed | needs_revision) — quoted evidence carries DisplayReferenceV1. Indexes on (workspaceId, passage), (workspaceId, kind). The learner's **first observation is preserved permanently** via **append-only `artifact_revisions` rows** — an integer revision counter alone is not the guarantee; every edit inserts the prior body as an immutable row. `conviction` claims are private-by-design, and that privacy is an **enforced, tested policy across five surfaces**: analytics/learning measures, server logs/telemetry, automatic or bulk sharing, AI retrieval (Phase 6 corpus assembly must filter them), and teaching promotion — each exclusion has its own test. The line is **automatic vs deliberate**: no system ever shares, aggregates, or promotes a conviction claim on the learner's behalf, but the learner may explicitly share one specific conviction artifact by their own deliberate act (via the master plan §12.1 `shareable_artifacts` registry) — opt-in per artifact, never a default, never in bulk.
- `claim_evidence` — exact storage shape: `id`, `workspace_id`, `claim_id`, `evidence_type`, nullable `canonical_range`, nullable `display_reference`, nullable `content_block_id`, nullable `citation_id`, `note`, `revision`; DTO mapping is id, workspaceId, claimId, evidenceType, canonicalRange, displayReference, contentBlockId, citationId, note, revision. The `study_claim` aggregate atomically owns its complete evidence set; an evidence edit advances the claim root revision. Citations are first-class IDs into the sources/citations model, never pasted strings. One claim, many evidence rows. An `interpretation` with zero evidence rows renders with a visible **"unsupported"** badge — the structural fix for audit gap #1.
- `thread_profiles`, `motif_candidates`, `motif_sightings`, and `study_thread_sightings` — `thread_profiles` adds v2 metadata to an existing thread slug, including `origin` (ThreadOrigin: starter | imported | learner_promoted), without changing the frozen v1 Thread contract. Exact thread-sighting storage is `id`, `workspace_id`, `session_id`, `thread_slug`, `passage_scope_key`, `canonical_range`, nullable `source_claim_id`, nullable `motif_sighting_id`, `status(active|dismissed)`, `revision`, timestamps. Composite FKs bind session, thread, claim, and motif sighting to the same workspace; a partial unique index permits one active row per `(workspace_id, session_id, thread_slug, passage_scope_key)`. `linked` is derived only from an active row. A starter/imported established thread may be linked on **any genuine sighting**. Only creation of a `learner_promoted` thread requires three active motif sightings across three distinct canonical passage scopes, explicit learner confirmation, and one transaction that creates the v1 Thread, profile, normalized sightings, and reverse-edge backfill. Dismissal never deletes the underlying observation.
- `comparison_attempts` — exact storage is `id`, `workspace_id`, `session_id`, `source_range`, `destination_range`, `outcome` (ComparisonOutcome: connection_created | no_warrant_yet | substantive_uncertainty), nonblank `rationale`, nullable `user_connection_id`, `status` (ConnectionStatus), `revision`, timestamps, `deleted_at`. A workspace-scoped FK and outcome check require a live `user_connection_id` exactly for `connection_created`; other outcomes require null. Edge deletion/replacement must update the comparison in the same transaction or fail. `no_warrant_yet` is legal **only** in `comparison_attempts.outcome`. A reasoned `substantive_uncertainty` row is an honest attempt and may unlock reviewed comparison help without manufacturing an edge.
- `formation_attempts` — exact storage is `id`, `workspace_id`, `session_id`, `stage` (FormationAttemptStage: observe | interpret | apply), nonblank `body`, fixed `outcome = substantive_uncertainty`, `revision`, timestamps, `deleted_at`. This record exists only when the learner has made a substantive attempt but cannot yet warrant a StudyClaim or Application; the body must explain the uncertainty. It may satisfy only its matching reveal predicate and never fabricates a claim, connection, or completion.
- `user_connections` — id, workspaceId, fromRange, toRange, type (ConnectionType), evidenceLabel (EvidenceLabel, with the §3.2 personal_resonance/devotional constraints), rationale (required, min 20 chars), threadSlug (nullable), status (ConnectionStatus: draft | revisited | confirmed). Unique on (workspaceId, fromRange, toRange, type). **Learner-authored only**: reviewed edges live in curated `graph_edges` (below) and radar output lives in `motif_candidates` — the three provenances never share a table. Every connection renders both passages side by side; the evidence label keeps "these verses sound similar" from quietly becoming "the Bible teaches this."
- `applications` — id, workspaceId, sessionId, sourceClaimId, and the master plan §12.3 bridge fields verbatim: `original_audience_meaning`, `enduring_principle`, `canonical_bridge`, `application_class`, `promise_scope`, `modern_domain` (work | money | relationships | grief | anxiety | leadership | justice | technology | sexuality | church | formation), `situation`, `response_type` (belief | repentance | prayer | lament | worship | rest | relationship | service | action — not every passage produces a productivity assignment), `faithful_response`, `cautions`, optional `available_after`, status (ApplicationStatus: draft | finalized | revisited | needs_revision), revision. All bridge fields are **columns, not free text**. Partial drafts always save locally; completeness is enforced only at the explicit **finalize** transition. Sensitive domains never render medical, mental-health, legal, financial, abuse, or crisis advice — referral language only.
- `teaching_drafts` + `teaching_sections` — exact draft storage is `id`, `workspace_id`, `session_id`, `title`, `big_idea`, `audience`, `duration_minutes`, `gospel_connection`, `status` (TeachingDraftStatus: draft | draft_complete | rehearsed | self_reviewed), `revision`, timestamps; its DTO maps to workspaceId, sessionId, bigIdea, durationMinutes, gospelConnection. Exact section storage is `id`, `workspace_id`, `draft_id`, `kind`, `sort_order`, `body`, `revision`; its DTO maps to workspaceId, draftId, sortOrder, revision. The `teaching_draft` aggregate atomically owns its complete ordered sections; section edits/reorders advance the draft root revision. Kinds are outline | context | connection | theology | illustration | objection | application | not_justified | discussion | prayer. The four vision formats — 60-second, 5-minute, 15-minute, 30-minute — are UI presets that set `durationMinutes`, not a column. A `connection` section may cite a persisted `comparison_attempts` row with outcome `no_warrant_yet` in place of an edge; the outcome is never an ungrounded teaching assertion. UI label `Self-reviewed` maps only to `self_reviewed` after the learner completes the rubric; independent qualified review lives in separate `teaching_reviews`. Software flags missing evidence or structure; it never scores theological correctness.

**Preserve the v1 Entry invariant:** `lib/api/entries.ts`, v1 sync validation, and migration `0003_enforce_active_thread_links.sql` continue to require at least one active thread for every v1 Entry. Do not weaken that API or trigger. Provisional motif sightings and unlinked deep-study work live in the new v2 session/claim tables, while any Entry created by explicit legacy capture or promotion still receives an established thread. Session closure, thread linkage, and comparison outcome are separate v2 facts; no migration rewrites v1 Entry semantics.

**Curated (no userId; `/content` is the single authoring source):** the compiler emits immutable, checksummed release bundles (master plan §12.4 `catalog_releases`); the DB rows below are read-only release indexes, never independently edited. Corrections ship as a new release + a signed revocation record — published artifacts are never mutated.

- `passage_contexts` — unit (CanonicalRangeV1), genre, authorAudience, historicalSetting, literaryStructure, beforeAfter, disputedNotes, sourceIds[].
- `sources` + `citations` — source: id, author, title, publisher, edition, year, url, licence, accessedAt; citation: sourceId, locator (page/section), passage range, note. Published releases snapshot their bibliography so editing a source later cannot alter historical content.
- `graph_edges` (+ `graph_edge_evidence`) — the reviewed canonical graph: fromRange, toRange, type (ConnectionType), evidenceLabel, rationale block, viewpoint, release, review status. Personal overlays stay in `user_connections`; they are never written here.
- `doctrines` — slug, title, definition, status (DoctrineStatus), coreRefs[], development (jsonb per-stage), formulations (jsonb: named tradition → position + best texts), misunderstandings[], sourceIds[].

### 3.4 Sync + API — one write path

- Freeze the existing v1 `SyncEntity`, v1 payload/response schema, and v1 Entry behavior. Add `SyncEntityV2` in `lib/contracts/sync-v2.ts`; do not append v2 literals to `lib/contracts.ts` or make old clients parse them.
- Canonical v2 aggregate roots are `study_session | study_claim | motif_candidate | comparison_attempt | user_connection | formation_attempt | application | teaching_draft`. Atomic boundaries are exact: `study_claim` owns all `claim_evidence`; `teaching_draft` owns all ordered `teaching_sections`; `comparison_attempt` atomically owns optional `user_connection` creation; learner motif promotion atomically owns the candidate/sightings, new v1 Thread + `thread_profile`, every `study_thread_sighting`, and reverse-edge backfill. Evidence, ordered sections, and promotion children never sync independently or become partly visible. Session and established-thread-sighting set operations may share a bounded `mutationGroupId`, but each has its own revision and tombstone.
- **All browser writes go through sync push** (tenet 7). New v2 routes are **read-only** resource endpoints (`/api/v2/workspaces/[id]/study-sessions`, `/claims`, `/comparison-attempts`, `/formation-attempts`, `/connections`, `/applications`, `/teaching-drafts`); conflict resolution invokes the same authoritative revision/idempotency transaction as sync. No independent REST mutations. Teach remains a pane inside `/study/[sessionId]`; the read-only `/teaching-drafts` resource is not a UI route.
- Phase 1 also lands the sync v2 substance this depends on: per-entity `revision`, `artifact_revisions` for prose-conflict preservation, tombstones, idempotent receipts, and the local rule that entity + outbox op write in one IndexedDB transaction. Phone + laptop is already multi-device; this is not deferrable.
- `NoteComposer` gains the `teaching` kind (already in the enum; audit gap #6) and a "promote to claim" action that upgrades an observation into a typed `StudyClaim` with evidence.
- Export (`lib/export/vault.ts`) includes all new entities; a claim exports as Markdown with its evidence list.

### 3.5 Radar upgrade

`Thread radar` keeps its lexical engine but its output changes shape: it emits **motif candidates**, never `Connection` rows — a theological edge exists only after the learner has compared both texts and typed a rationale. Accepting a candidate walks through the side-by-side comparison first. Add the missing dedicated tests: repeated-word detection, third-sighting threshold, candidate dedup vs existing motifs and connections.

**Phase 1 tests:** CanonicalRangeV1/DisplayReferenceV1 round-trip + SBL mapping, DTO/storage mapping, claim-evidence badge logic, connection uniqueness + required rationale, application finalize-completeness (drafts save partial), prose-conflict preservation, aggregate-atomic sync round-trip for every `SyncEntityV2`, v1 compatibility fixtures, and tenant isolation (RLS + app predicates) on every read route and the sync path. Target: 35 → ~60 tests.

---

## 4. Phase 2 — Passage Workspace (~3–4 weeks)

One route: `app/(app)/study/[sessionId]/page.tsx` — a session pins its canonical passage range and (when curriculum-attached) a catalog release. Eight sections share one resumable workspace. Define `RevealAfter` in the v2 workspace contract as a named server-computed predicate over persisted artifacts. `resumeStep` only restores navigation; it and client booleans are never reveal authority.

**Gating principle (revised per master plan §30.6):** the strict gate is *learner attempt before curated help* — you must try before the reviewed material reveals. Producing a claim is **not** forced at every step: a persisted, nonblank `formation_attempts` row with `outcome = substantive_uncertainty` satisfies only its matching Observe/Interpret/Apply `RevealAfter`; a comparison attempt with `substantive_uncertainty` satisfies Connect. Theology does not require a Connection first, because forcing a connection trains users to invent one.

| Section | Curated help unlocks after | Reads | Writes |
|---------|---------------------------|-------|--------|
| 1. Read — **The Quiet Page** | — (always first; Scripture alone: no commentary, no AI, no sample answer, no writing until the text loads correctly) | BookData, translations, verse selection | ReadingProgress, readGateAt |
| 2. Observe — **The Evidence Desk** | `RevealAfter(observe_help)`: successful Scripture load + persisted read marker | prior claims for the range | StudyClaim(observation) with evidence, or FormationAttempt(observe, substantive_uncertainty) |
| 3. Context — **The Context Window** | neutral facts after `RevealAfter(context_help)`; literary/interpretive conclusions after a persisted interpretation claim or FormationAttempt(interpret, substantive_uncertainty) | claim-class-filtered `passage_contexts` + sources; "no curated context yet" for uncovered units | interpretation attempt, then matching reveal |
| 4. Connect — **The Scarlet Thread Map** | `RevealAfter(connection_help)`: persisted ComparisonAttempt with nonblank rationale, including substantive uncertainty | motif candidates, curated connections, user threads | UserConnection or ComparisonAttempt(`no_warrant_yet` | `substantive_uncertainty`) |
| 5. Theology — **The Theology Table** | `RevealAfter(theology_help)`: persisted interpretation claim or FormationAttempt(interpret, substantive_uncertainty); connection optional | doctrine stubs touching this passage | StudyClaim(theology) w/ evidence + DoctrineStatus |
| 6. Conviction — **The Conviction Room** | optional, never gated | nothing curated — the learner and the text | StudyClaim(conviction): private, unscored, excluded from analytics; never shared automatically or in bulk — only by the learner's explicit per-artifact act |
| 7. Apply — **The Practice Bridge** | `RevealAfter(application_help)`: persisted interpretation claim or FormationAttempt(interpret, substantive_uncertainty) | domain + response-type lists | Application (drafts save anytime; bridge fields checked at finalize) or FormationAttempt(apply, substantive_uncertainty) |
| 8. Teach — **Teach It Back** | `RevealAfter(teach_builder)`: finalized Application or FormationAttempt(apply, substantive_uncertainty); `RevealAfter(teach_feedback)` additionally requires a persisted TeachingDraft | user's own claims for the session | TeachingDraft in one of the four formats |

Component layout: `components/workspace/{WorkspaceShell,ReadPane,ObservePane,ContextPane,ConnectPane,TheologyPane,ConvictionPane,ApplyPane,TeachPane}.tsx`, reusing `Sheet`, `Chip`, `Field`, `ThreadPicker`. Mobile-first: sections are an accordion, not tabs, so the flow reads top-to-bottom like the method itself. Visual grammar: sparse, quiet screens before observation, increasing richness as understanding develops; connection lines drawn as thread, not network-diagram edges. **Theme decision (Ken, 2026-08-13): use both.** The app shell stays midnight navy; the Quiet Page offers warm parchment; crimson marks active thread connections; muted gold is reserved for provenance/status indicators, never body text. Ship three themes — System, Midnight, Parchment — all passing accessible-contrast checks (the A-040 token fixes apply to every theme).

Also in Phase 2:

- **Connection Explorer:** upgrade `threads/[slug]` and the Mountain to filter by ConnectionType, doctrine, person, stage; curated edges render in a distinct style from user edges (tenet 3).
- **Language fix:** Review page copy "Where God has been working" → "What has been recurring in your study" (audit gap #9); `ThreadStrength` doc comment updated to match.
- **Playwright e2e:** one script drives the full loop Read → Teach on a seeded account; runs in CI against a local Postgres.

---

## 5. Phase 3 — Pilot curriculum: Genesis 1–12 + Matthew 1–7 (~4–6 weeks, content-bound)

The mountain's 11 stages each hold one anchor chapter today (audit gap #4). Fix by depth in a bounded pilot, not shallow breadth across 66. Scope (per master plan §8): **15 Genesis 1–12 units and 15 Matthew 1–7 units** — full Matthew, the larger Modern Life Lab library, and further books come only after learners demonstrate the method works.

### 5.1 Content pipeline and release machinery (this is executable work, not an assertion)

- Author lessons as MDX in `content/curriculum/<track>/<nn-slug>.mdx` with zod-validated frontmatter: `passage`, `stage`, `bigIdea`, `contextId`, `connectionIds[]`, `doctrineSlugs[]`, `sources[]`, `author`, `status: draft | in_review | published`. Review decisions are **not** frontmatter self-attestation: they are structured `content_reviews` records (master plan §12.4 — concrete node/release FK, reviewer, discipline, decision, notes, timestamp), and `publish.ts` enforces author ≠ reviewer plus discipline-specific approvals from those records.
- Build the compiler in `web/scripts/content/`: `validate.ts` (schema + ref resolution), `build.ts` (emits the bundle), `publish.ts` (writes a **signed, checksummed catalog-release manifest** to durable append-only storage that does not depend on any single Vercel deployment), `verify-release.ts` (download + checksum verification, used by the app and the offline downloader). Corrections and withdrawals ship as a new release plus a signed revocation record; rollback and reconstruction of an old study against its pinned release are tested, not assumed. This machinery is a **prerequisite of first publication**, not post-launch hardening.
- CI rules in `validate.ts`: every published lesson must have ≥1 source, all cited refs resolvable against the corpus, a teach-back prompt set, and a reviewer who is **not the author**. Connections are validated when present but **never required** — a lesson may honestly teach a passage with no warranted canonical connection and records a reviewed `connectionOmissionNote`; the database literal `no_warrant_yet` remains reserved for a learner's `comparison_attempts.outcome`. Worked application examples must follow the Practice Bridge shape, but not every lesson must contain one.
- Lesson counts: Genesis 1–12 = 15 units (creation, fall, Cain, flood, Babel, call of Abram — the existing Bible-Brain vault notes are the raw material); Matthew 1–7 = 15 units through the Sermon on the Mount.

### 5.2 Each lesson ships

Context (curated `passage_contexts` row) · literary design notes · **0–5 curated typed connections — only where warranted; a lesson with none records a reviewed `connectionOmissionNote` instead** · doctrine touchpoints · a guarded application worked example · a teach-back prompt set (explain w/o notes, 5-minute outline, likely objection, one thing this passage does **not** teach, and "defend one connection or explain why none is warranted").

### 5.3 Governance (decide before the first lesson is written)

Write `content/GOVERNANCE.md`: statement of faith + interpretive method; single-tradition vs comparative stance (recommendation: teach one evangelical-protestant baseline, *show* named alternative positions for conviction, open, and disputed matters); DoctrineStatus assignments; review roles (a qualified pastor/elder — the one dependency Ken cannot self-supply — and the reviewer must be **independent of the author**, with disputed views represented by someone competent in them, not merely named); correction/errata process that is *exercised* before launch, not just documented; source licensing rules; pastoral-safety boundaries (mental health, abuse, medical, legal, financial → resource referral, never counsel).

Teaching influences (Mitchell: sustained exposition, gospel center, discipleship; Daniels: Understand → Interpret → Apply → Explain; BibleProject: literary design + unified story) inform the *method*. No living teacher's voice, persona, or material is reproduced.

---

## 6. Phase 4 — Doctrine and teaching surfaces (~3–4 weeks)

- **Doctrine Library** (`app/(app)/doctrines/`): renders curated `doctrines`; each shows its DoctrineStatus badge (core | conviction | open | disputed | wisdom), whole-Bible development mapped onto the 11 stages, named positions where traditions differ with their strongest biblical arguments, and "your claims touching this doctrine" from the user's StudyClaims.
- **Modern Life Lab — explicitly NOT built in this phase.** Per master plan §8.5 it is six labs built **after public V1 ships** — post-cohort AND post-release, not merely post-validation. The design is recorded here only so it isn't reinvented: curated case studies in `content/life-labs/` use the complete canonical Application bridge (`original_audience_meaning`, `enduring_principle`, `canonical_bridge`, `application_class`, `promise_scope`, `modern_domain`, `situation`, `response_type`, `faithful_response`, `cautions`) and explicitly test possible misuse; answers save as Applications at `app/(app)/life/`.
- **Teach-back Mode** (section 8 within `app/(app)/study/[sessionId]/` for public V1): builds on TeachingDrafts. Four exercises per passage: blind explain (textarea, no notes visible), 5-minute lesson builder (outline points must cite refs), objection drill, negative-claim ("what this passage does not justify"). Completion feeds a **retrieval review** queue — extend `/api/review` with spaced re-teach prompts (7/30/90-day), measured by completed explanations, never streaks. Product states stop at Draft complete, Rehearsed, and **Self-reviewed** until an independent qualified human actually reviews the artifact.
- **Review page** goes fully live-data (audit gap #6 closed in Phase 0/1; here it gains claim-kind breakdowns and teach-back coverage per stage).

**Phase 4 acceptance = the audit rubric plus transfer:** a learner can distinguish the claim kinds and their epistemic bases, defend a connection from both passages (or honestly decline one), name where interpreters disagree, apply without bypassing the original audience, teach a cited 5-minute lesson, name one unwarranted claim — and **use the method on an unfamiliar passage no curriculum covers** (master plan §7 transfer test). Completed lessons that look good are not the metric; a reusable method is.

---

## 7. Phase 5 — Public release readiness (~3–4 weeks)

Scarlet Thread is eventually offered to the world, so shipping to strangers is a phase with its own gates, not an afterthought:

- **Account lifecycle:** recovery, full deletion (server + local + caches, verified), data export on the way out, device list + revocation.
- **Legal/operational:** privacy policy, terms, translation-licence disclosures, theological-position disclosure, support channel, incident-response runbook.
- **Durability drills:** backup restoration actually exercised; catalog-release rollback actually exercised; sync-conflict, account-switch, and content-rollback browser tests green.
- **Accessibility verification:** keyboard, screen-reader, contrast, and reduced-motion passes across the reading and workspace surfaces.
- **Operational monitoring:** error tracking and uptime/latency alerts that carry zero personal study content (conviction claims are already excluded from all telemetry by design).

Deferred past public V1 (correctly): cohorts, public sharing, editorial dashboards, coaching roles.

---

## 8. Phase 6 — Optional cited AI coach (only after Phase 3 content exists)

Constraints before capability: retrieval **only** over the curated content + licensed sources; every substantive claim cites a sourceId or passage; Scripture quotes rendered distinctly from interpretation; disputed doctrines answered with named positions; **fails closed** ("the curated library doesn't cover this yet") when retrieval is empty; coaches with questions before answers; never impersonates any teacher. Build as `/api/coach` with the source registry as the retrieval corpus; log every citation for audit. This is deliberately last — an assistant grounded in nothing would reintroduce every gap the schema just closed.

---

## 9. Sequencing, effort, and checkpoints

**First implementation slice after Phase 0:** the **Genesis 3 module end-to-end** (master plan §32) — one bounded passage from read gate through teach-back, offline, synced, exported, and published through the release pipeline. It deliberately touches every plane before broad build-out; Phases 1–2 below are built *through* that slice, not before it.

| Phase | Calendar (solo, part-time) | Hard exit gate |
|-------|---------------------------|----------------|
| 0 Foundation | 1–2 wks | Two-account isolation test green on Vercel; gates 0.1–0.12 closed (0.12: migrate-on-build hook removed) |
| 1 Evidence model | 4–6 wks | ~60 tests green; teaching entries creatable; radar emits motif candidates; workspace_id + revision + RLS + account-scoped IndexedDB + conflict-preserving sync live |
| 2 Passage Workspace | 3–4 wks | Genesis 3 vertical slice passes end-to-end (incl. sync-conflict, export, reload, release-pipeline publish + rollback); Playwright full-loop e2e green |
| 3 Pilot curriculum | 4–6 wks (content-bound) | 15 Genesis + 15 Matthew 1–7 units published through the release pipeline with independent reviewer sign-off; correction/withdrawal exercised once |
| 4 Doctrine/Teach | 3–4 wks | Audit rubric demonstrable end-to-end on Genesis 3 and Matthew 5; no Life Lab implied before post-public-V1 |
| 4.5 Founding cohort | 4+ wks (calendar, external) | A free external cohort runs the Genesis pilot; cohort learners pass the unfamiliar-passage transfer test; their feedback triages into fixes before hardening |
| 5 Public release readiness | 3–4 wks | Deletion/recovery/restore/rollback drills pass; accessibility verified; legal + disclosure pages live; monitoring carries no study content; conviction-exclusion tests green on all five surfaces |
| 6 AI coach | not committed MVP scope | Estimate only after provider privacy controls, citation verification, evals, red-teaming, and pastoral-safety review are scoped — fail-closed + citation-required tests are the floor, not the whole job |

Total for Phases 0–5: roughly 5–7 months part-time, with Phase 3 the least compressible because it is theology authorship + external review, not code. Phases 1–2 can overlap Phase 3 authoring since the content pipeline (§5.1) only needs the schema from Phase 1.

**What defers and what does not.** Correctly deferred past public V1: cohorts, public sharing, editorial dashboards, coaching roles, AI, and the Modern Life Labs. **Not deferrable:** application-level isolation predicates (Phase 0 — what the two-account test proves), transaction-scoped RLS + account-scoped local storage (Phase 1 — the hostile defense-in-depth re-proof, per §3.3), conflict-preserving sync (one person on phone + laptop is already multi-device), and immutable catalog releases (a prerequisite of publishing the first lesson, not a scale feature).

**Risk register:** (1) reviewer availability and independence is the critical external dependency — recruit before Phase 3 starts; (2) KJV licensing may force a geo-restriction — decide in Phase 0, not after launch; (3) scope creep toward a commentary feed — tenet 1 and the attempt-gates are the defense; (4) curated/user blending — enforced by separate tables (`user_connections` vs `graph_edges`) and visual provenance, test it; (5) gold-plating the deferrable list above before the method is validated — the "not deferrable" boundary is the discipline in both directions.
