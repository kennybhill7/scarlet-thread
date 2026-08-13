# Scarlet Thread — Full Build-Out Plan

**Date:** 2026-08-12 (revised same date after reconciliation)
**Input:** `THEOLOGY_PRODUCT_AUDIT.md` (the "why").
**Authority:** `THEOLOGY_MASTER_BUILD_PLAN.md` is the authoritative product/architecture spec; this file is the shorter execution checklist, reconciled to its §30 findings. Where the two disagree, the master plan wins.
**Goal:** Turn Scarlet Thread from a Scripture reader + connection journal into a **formation system**: Read → Observe → Context → Interpret → Connect → Theology → Conviction → Practice → Teach.
**Stack (unchanged):** Next.js 16.2 / React 19.2, Drizzle + Neon Postgres, NextAuth v5 (Google), IndexedDB offline vault with last-write-wins sync, Node test runner (35 tests today).

---

## 0. Design tenets (fixed for every phase)

1. **Read before you write.** No commentary, context, or AI surface unlocks until the passage is marked read and one observation exists. Enforced in UI state, not honor system.
2. **Evidence and inference never share a field.** Every stored claim carries a `kind`, an `epistemicBasis`, and evidence refs. This is the single biggest schema change.
3. **Curated ≠ personal.** Curated content lives in versioned repo files compiled into immutable releases; user content lives in workspace-scoped DB rows. The UI must always show which one it is displaying. They never mix in one table — learner `user_connections` and reviewed `graph_edges` are different records.
4. **Additive contracts only.** v1 `lib/contracts.ts` stays byte-stable; new types live in versioned modules (`lib/contracts/study-v2.ts`, `content-v1.ts`, `graph-v1.ts`). Client-clock last-write-wins is retired **in Phase 1**, not at some future milestone — one person on a phone and a laptop is already a multi-device product, and long-form prose (teaching drafts) must never be silently overwritten.
5. **Fail closed.** Missing seed, missing verse map, missing production env = explicit error state, never an empty-success screen.
6. **Tests certify software; a pastor certifies theology.** Every curated lesson carries `reviewedBy` + `reviewedAt` in frontmatter, the reviewer must differ from the author, and CI enforces both before `published`.
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
    life/ [case]/               NEW Modern Life Lab
    teach/ [id]/                NEW Teach-back builder + drafts
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

Curated content compiles into **immutable, checksummed catalog releases** (§5.1) consumed identically by the app, the offline downloader, and the APIs — never mutated after publish, never dependent on staying inside one Vercel deployment. User study work flows through the IndexedDB outbox → **sync push** → Postgres path with six new sync entities; sync push is the only browser write path (tenet 7).

---

## 2. Phase 0 — Truthful & safe foundation (do first, ~1–2 weeks)

Ship nothing user-facing until these 12 gates close. Each maps to an audit finding (0.12 to the post-audit `c29de2e` commit).

| # | Gate | Where | Done when |
|---|------|-------|-----------|
| 0.1 | Neon + Google OAuth configured on Vercel | Vercel env, `lib/auth/config.ts`, `lib/auth/allowlist.ts` | Real sign-in on the preview URL; the single-email `AUTH_ALLOWED_EMAIL` allowlist extended to a controlled invite/test list; then two test Google accounts cannot see each other's entries (tenant-isolation test in `tests/`) |
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

**Exit criterion:** the Vercel URL is a working single-user app with verified account isolation. Only then is it honest to call it deployed.

---

## 3. Phase 1 — Evidence model (~4–6 weeks)

The data layer everything else stands on. All schema below is additive; existing tables untouched.

### 3.1 New reference type (contracts) — freeze this before any v2 table

```ts
/** Canonical, translation-independent range. Cross-chapter allowed (Gen 1:1–2:3). */
export interface CanonicalRange {
  versificationId: "eng-protestant-66-31102-v1";
  start: RefKey; // "1.1.1"
  end: RefKey;   // inclusive; same book, cross-chapter OK
}
```

Display references map through the versioned verse map per translation (SBL's Romans 14/16 divergences are already documented in `tools/versification-report.md`). Every quoted evidence record stores `translationId` + corpus release so a later text or verse-map update cannot silently change what the learner saw. Parsing/formatting joins `lib/bible/reference.ts` with tests: round-trip, canonical ordering, bounds against the real corpus, SBL mapping.

### 3.2 New enums

```ts
/** Matches master plan §12.3 claim_kind. */
export type ClaimKind =
  | "observation" | "question" | "context" | "interpretation"
  | "theology" | "conviction" | "application" | "teaching-seed";
/** What kind of warrant stands behind the claim. */
export type EpistemicBasis =
  | "text-explicit" | "historical-context" | "inference" | "canonical-synthesis"
  | "tradition" | "prudential-judgment" | "personal-reflection";
export type ClaimConfidence = "tentative" | "developing" | "well-supported";
export type ConnectionType =
  | "quotation" | "explicit-reference" | "allusion" | "motif"
  | "promise-fulfillment" | "type-antitype" | "covenant-development"
  | "contrast" | "doctrinal-synthesis" | "devotional-resonance";
/** How firmly the evidence supports a connection. "devotional" legitimizes
 *  personal resonance without letting it quietly upgrade into doctrine. */
export type EvidenceLabel = "explicit" | "strong" | "plausible" | "devotional";
/** Matches master plan doctrine_status. */
export type DoctrineStatus = "core" | "conviction" | "open" | "disputed" | "wisdom";
```

### 3.3 New tables (Drizzle; user tables workspace-scoped w/ soft delete, curated tables are read-only release indexes)

**User-owned (synced).** Every table below carries `workspace_id` (one personal workspace per user, backfilled) and an integer `revision` from day one, and Phase 1 turns on transaction-scoped RLS (`set_config('app.workspace_id', ..., true)` per master plan §12.1) plus account-scoped IndexedDB — the Phase 0 two-account isolation test needs both, so neither waits for an invited user.

- `study_sessions` — id, workspaceId, canonical range, mode, workflowState, connectionState (unexamined | provisional | linked | no_warrant_yet), optional pinned catalog/curriculum release, readGateAt, currentStep. The workspace routes by **sessionId**, not book/chapter: multiple studies of the same passage, resumability, and revision history all need it.
- `study_claims` — id, workspaceId, sessionId, kind (ClaimKind), epistemicBasis (EpistemicBasis), body, passage (CanonicalRange), confidence (ClaimConfidence), doctrineStatus (theology claims only), viewpoint (nullable), status (draft | confirmed | needs_revision). Indexes on (workspaceId, passage), (workspaceId, kind). The learner's **first observation is preserved permanently** — later understanding creates revisions (`artifact_revisions`), never rewrites history. `conviction` claims are private-by-design: excluded from analytics/learning measures, never auto-shared or exported into teaching material.
- `claim_evidence` — claimId, workspaceId, kind ("passage" | "citation" | "connection" | "claim"), ref — where "citation" is a first-class `citationId` into the sources/citations model (§3.3 curated), not a pasted string. One claim, many evidence rows. An `interpretation` with zero evidence rows renders with a visible **"unsupported"** badge — the structural fix for audit gap #1.
- `motif_candidates` + `motif_sightings` — the radar and sightings 1–2 live here (label, normalized key, exact range, status), **before** any thread exists. Promotion on the third genuine sighting creates the thread and links earlier sightings transactionally; dismissal never deletes the underlying observation.
- `user_connections` — id, workspaceId, fromRange, toRange, type (ConnectionType), evidenceLabel (EvidenceLabel), rationale (required, min 20 chars), threadSlug (nullable), status. Unique on (workspaceId, fromRange, toRange, type). **Learner-authored only**: reviewed edges live in curated `graph_edges` (below) and radar output lives in `motif_candidates` — the three provenances never share a table. Every connection renders both passages side by side; the evidence label keeps "these verses sound similar" from quietly becoming "the Bible teaches this."
- `applications` — id, workspaceId, sessionId, originalMeaning, enduringPrinciple, discontinuity, domain ("work" | "money" | "relationships" | "grief" | "anxiety" | "leadership" | "justice" | "technology" | "sexuality" | "church"), responseType ("belief" | "repentance" | "prayer" | "lament" | "worship" | "rest" | "relationship" | "service" | "action" — not every passage produces a productivity assignment), concreteResponse, misuseWarning, status, reviewAt. All guardrail fields are **columns, not free text**. Partial drafts always save locally; completeness is enforced only at the explicit **finalize** transition. Sensitive domains never render medical, mental-health, legal, financial, abuse, or crisis advice — referral language only.
- `teaching_drafts` — id, workspaceId, sessionId, format (60-second explanation | 5-minute table talk | 15-minute small-group lesson | 30-minute teaching), bigIdea, outline (jsonb points w/ refs), gospelConnection, objection + answer, illustration, application, notJustified, discussionQuestion, prayer, audience, deliveredAt (nullable). Same draft/finalize rule. Software flags missing evidence or structure; it never scores theological correctness.

**Thread-invariant correction (staged migration):** `lib/api/entries.ts` currently requires ≥1 thread per entry and migration `0003_enforce_active_thread_links.sql` enforces it — which contradicts the third-sighting rule (sightings 1–2 of a new motif have no thread yet). Relax the entry/sync schemas and the 0003 triggers in one coordinated migration so drafts can exist unlinked; the enforced rule moves to the session transition into `linked`. Rollback + import test before accepting unthreaded records.

**Curated (no userId; `/content` is the single authoring source):** the compiler emits immutable, checksummed release bundles (master plan §12.4 `catalog_releases`); the DB rows below are read-only release indexes, never independently edited. Corrections ship as a new release + a signed revocation record — published artifacts are never mutated.

- `passage_contexts` — unit (CanonicalRange), genre, authorAudience, historicalSetting, literaryStructure, beforeAfter, disputedNotes, sourceIds[].
- `sources` + `citations` — source: id, author, title, publisher, edition, year, url, licence, accessedAt; citation: sourceId, locator (page/section), passage range, note. Published releases snapshot their bibliography so editing a source later cannot alter historical content.
- `graph_edges` (+ `graph_edge_evidence`) — the reviewed canonical graph: fromRange, toRange, type (ConnectionType), evidenceLabel, rationale block, viewpoint, release, review status. Personal overlays stay in `user_connections`; they are never written here.
- `doctrines` — slug, title, definition, status (DoctrineStatus), coreRefs[], development (jsonb per-stage), formulations (jsonb: named tradition → position + best texts), misunderstandings[], sourceIds[].

### 3.4 Sync + API — one write path

- Extend `SyncEntity` with the six new entities — `"session" | "claim" | "motif" | "connection" | "application" | "teachingDraft"` — and add the matching arrays to `SyncResponse` (additive; related offline creations sync as a bounded atomic group per master plan §14).
- **All browser writes go through sync push** (tenet 7). New v2 routes are **read-only** resource endpoints (`/api/v2/workspaces/[id]/claims`, `/connections`, `/applications`, `/teach`); conflict resolution invokes the same authoritative revision/idempotency transaction as sync. No independent REST mutations.
- Phase 1 also lands the sync v2 substance this depends on: per-entity `revision`, `artifact_revisions` for prose-conflict preservation, tombstones, idempotent receipts, and the local rule that entity + outbox op write in one IndexedDB transaction. Phone + laptop is already multi-device; this is not deferrable.
- `NoteComposer` gains the `teaching` kind (already in the enum; audit gap #6) and a "promote to claim" action that upgrades an observation into a typed `StudyClaim` with evidence.
- Export (`lib/export/vault.ts`) includes all new entities; a claim exports as Markdown with its evidence list.

### 3.5 Radar upgrade

`Thread radar` keeps its lexical engine but its output changes shape: it emits **motif candidates**, never `Connection` rows — a theological edge exists only after the learner has compared both texts and typed a rationale. Accepting a candidate walks through the side-by-side comparison first. Add the missing dedicated tests: repeated-word detection, third-sighting threshold, candidate dedup vs existing motifs and connections.

**Phase 1 tests:** CanonicalRange round-trip + SBL mapping, claim-evidence badge logic, connection uniqueness + required rationale, application finalize-completeness (drafts save partial), prose-conflict preservation, sync round-trip for all six entities, tenant isolation (RLS + app predicates) on every read route and the sync path. Target: 35 → ~60 tests.

---

## 4. Phase 2 — Passage Workspace (~3–4 weeks)

One route: `app/(app)/study/[sessionId]/page.tsx` — a session pins its canonical passage range and (when curriculum-attached) a catalog release. Eight sections driven by the session's `currentStep` state machine, each carrying its product name so the flow feels like one unfolding conversation, not a long form.

**Gating principle (revised per master plan §30.6):** the strict gate is *learner attempt before curated help* — you must try before the reviewed material reveals. Producing an artifact is **not** forced at every step: Theology does not require a Connection first (the session may honestly record `no_warrant_yet`), because forcing a connection trains users to invent one.

| Section | Curated help unlocks after | Reads | Writes |
|---------|---------------------------|-------|--------|
| 1. Read — **The Quiet Page** | — (always first; Scripture alone: no commentary, no AI, no sample answer, no writing until the text loads correctly) | BookData, translations, verse selection | ReadingProgress, readGateAt |
| 2. Observe — **The Evidence Desk** | passage marked read | prior claims for the range | StudyClaim(observation) w/ supporting verses, questions |
| 3. Context — **The Context Window** | ≥1 observation | curated `passage_contexts` + sources; "no curated context yet" for uncovered units | original-audience attempt (StudyClaim interpretation), then reveal |
| 4. Connect — **The Scarlet Thread Map** | an attempted comparison | motif candidates, curated connections, user threads | Connection (typed + evidence-labeled, both passages side-by-side) or `no_warrant_yet` |
| 5. Theology — **The Theology Table** | ≥1 claim (connection optional) | doctrine stubs touching this passage | StudyClaim(theology) w/ evidence + DoctrineStatus |
| 6. Conviction — **The Conviction Room** | optional, never gated | nothing curated — the learner and the text | StudyClaim(conviction): private, unscored, excluded from analytics, never auto-shared |
| 7. Apply — **The Practice Bridge** | ≥1 theology claim | domain + response-type lists | Application (drafts save anytime; bridge fields checked at finalize) |
| 8. Teach — **Teach It Back** | ≥1 finalized application | user's own claims for the session | TeachingDraft in one of the four formats |

Component layout: `components/workspace/{WorkspaceShell,ReadPane,ObservePane,ContextPane,ConnectPane,TheologyPane,ConvictionPane,ApplyPane,TeachPane}.tsx`, reusing `Sheet`, `Chip`, `Field`, `ThreadPicker`. Mobile-first: sections are an accordion, not tabs, so the flow reads top-to-bottom like the method itself. Visual grammar: sparse, quiet screens before observation, increasing richness as understanding develops; connection lines drawn as thread, not network-diagram edges (palette decision — parchment/crimson/gold vs the workspace dark-theme default — is an open product call for Ken).

Also in Phase 2:

- **Connection Explorer:** upgrade `threads/[slug]` and the Mountain to filter by ConnectionType, doctrine, person, stage; curated edges render in a distinct style from user edges (tenet 3).
- **Language fix:** Review page copy "Where God has been working" → "What has been recurring in your study" (audit gap #9); `ThreadStrength` doc comment updated to match.
- **Playwright e2e:** one script drives the full loop Read → Teach on a seeded account; runs in CI against a local Postgres.

---

## 5. Phase 3 — Pilot curriculum: Genesis 1–12 + Matthew 1–7 (~4–6 weeks, content-bound)

The mountain's 11 stages each hold one anchor chapter today (audit gap #4). Fix by depth in a bounded pilot, not shallow breadth across 66. Scope (per master plan §8): **15 Genesis 1–12 units and 15 Matthew 1–7 units** — full Matthew, the larger Modern Life Lab library, and further books come only after learners demonstrate the method works.

### 5.1 Content pipeline and release machinery (this is executable work, not an assertion)

- Author lessons as MDX in `content/curriculum/<track>/<nn-slug>.mdx` with zod-validated frontmatter: `passage`, `stage`, `bigIdea`, `contextId`, `connectionIds[]`, `doctrineSlugs[]`, `sources[]`, `reviewedBy`, `reviewedAt`, `status: draft | reviewed | published`.
- Build the compiler in `web/scripts/content/`: `validate.ts` (schema + ref resolution), `build.ts` (emits the bundle), `publish.ts` (writes a **signed, checksummed catalog-release manifest** to durable append-only storage that does not depend on any single Vercel deployment), `verify-release.ts` (download + checksum verification, used by the app and the offline downloader). Corrections and withdrawals ship as a new release plus a signed revocation record; rollback and reconstruction of an old study against its pinned release are tested, not assumed. This machinery is a **prerequisite of first publication**, not post-launch hardening.
- CI rules in `validate.ts`: every published lesson must have ≥1 source, all cited refs resolvable against the corpus, a teach-back prompt set, and a reviewer who is **not the author**. Connections are validated when present but **never required** — a lesson may honestly teach a passage with no warranted canonical connection (`no_warrant_yet` is a valid outcome, for lessons as for learners). Worked application examples must follow the Practice Bridge shape, but not every lesson must contain one.
- Lesson counts: Genesis 1–12 = 15 units (creation, fall, Cain, flood, Babel, call of Abram — the existing Bible-Brain vault notes are the raw material); Matthew 1–7 = 15 units through the Sermon on the Mount.

### 5.2 Each lesson ships

Context (curated `passage_contexts` row) · literary design notes · 3–5 curated typed connections · doctrine touchpoints · a guarded application worked example · a teach-back prompt set (explain w/o notes, 5-minute outline, likely objection, one thing this passage does **not** teach).

### 5.3 Governance (decide before the first lesson is written)

Write `content/GOVERNANCE.md`: statement of faith + interpretive method; single-tradition vs comparative stance (recommendation: teach one evangelical-protestant baseline, *show* named alternative positions on secondary/open-hand doctrines); doctrine-tier assignments; review roles (a qualified pastor/elder — the one dependency Ken cannot self-supply — and the reviewer must be **independent of the author**, with disputed views represented by someone competent in them, not merely named); correction/errata process that is *exercised* before launch, not just documented; source licensing rules; pastoral-safety boundaries (mental health, abuse, medical, legal, financial → resource referral, never counsel).

Teaching influences (Mitchell: sustained exposition, gospel center, discipleship; Daniels: Understand → Interpret → Apply → Explain; BibleProject: literary design + unified story) inform the *method*. No living teacher's voice, persona, or material is reproduced.

---

## 6. Phase 4 — Doctrine, life, and teaching surfaces (~3–4 weeks)

- **Doctrine Library** (`app/(app)/doctrines/`): renders curated `doctrines`; each shows its DoctrineStatus badge (core | conviction | open | disputed | wisdom), whole-Bible development mapped onto the 11 stages, named positions where traditions differ with their strongest biblical arguments, and "your claims touching this doctrine" from the user's StudyClaims.
- **Modern Life Lab** (`app/(app)/life/`): curated case studies (`content/cases/`) asking the learner to supply principle → context → competing wisdom → faithful action → possible misuse; answers save as Applications. Launch with ~10 cases across the domain list.
- **Teach-back Mode** (`app/(app)/teach/`): builds on TeachingDrafts. Four exercises per passage: blind explain (textarea, no notes visible), 5-minute lesson builder (outline points must cite refs), objection drill, negative-claim ("what this passage does not justify"). Completion feeds a **retrieval review** queue — extend `/api/review` with spaced re-teach prompts (7/30/90-day), measured by completed explanations, never streaks.
- **Review page** goes fully live-data (audit gap #6 closed in Phase 0/1; here it gains claim-kind breakdowns and teach-back coverage per stage).

**Phase 4 acceptance = the audit rubric:** a learner can distinguish the claim kinds and their epistemic bases, defend a connection from both passages (or honestly decline one), name where interpreters disagree, apply without bypassing the original audience, teach a cited 5-minute lesson, and name one unwarranted claim.

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
| 4 Doctrine/Life/Teach | 3–4 wks | Audit rubric demonstrable end-to-end on Genesis 3 and Matthew 5 |
| 5 Public release readiness | 3–4 wks | Deletion/recovery/restore/rollback drills pass; accessibility verified; legal + disclosure pages live; monitoring carries no study content |
| 6 AI coach | not committed MVP scope | Estimate only after provider privacy controls, citation verification, evals, red-teaming, and pastoral-safety review are scoped — fail-closed + citation-required tests are the floor, not the whole job |

Total for Phases 0–5: roughly 5–7 months part-time, with Phase 3 the least compressible because it is theology authorship + external review, not code. Phases 1–2 can overlap Phase 3 authoring since the content pipeline (§5.1) only needs the schema from Phase 1.

**What defers and what does not.** Correctly deferred past public V1: cohorts, public sharing, editorial dashboards, coaching roles, AI. **Not deferrable:** transaction-scoped RLS and account-scoped local storage (the Phase 0 isolation test and any invited tester need them), conflict-preserving sync (one person on phone + laptop is already multi-device), and immutable catalog releases (a prerequisite of publishing the first lesson, not a scale feature).

**Risk register:** (1) reviewer availability and independence is the critical external dependency — recruit before Phase 3 starts; (2) KJV licensing may force a geo-restriction — decide in Phase 0, not after launch; (3) scope creep toward a commentary feed — tenet 1 and the attempt-gates are the defense; (4) curated/user blending — enforced by separate tables (`user_connections` vs `graph_edges`) and visual provenance, test it; (5) gold-plating the deferrable list above before the method is validated — the "not deferrable" boundary is the discipline in both directions.
