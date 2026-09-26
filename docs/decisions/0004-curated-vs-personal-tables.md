# ADR 0004: Curated tables and personal tables are different kinds of table

- Date: 2026-09-25
- Status: Accepted

## Context

Two kinds of data live in one Postgres database: learner work (private, mutable, synced from devices) and curated content (authored in `/content`, identical for everyone, meant to be trustworthy and stable). Mixing them in one table would let a learner's private connection show up as "reviewed", or let a content correction overwrite a learner's data.

## Decision

Personal (learner-owned) tables in `web/db/schema.ts`:

- Scoped by `userId` (v1: `entries`, `threads`, `reading_progress`, ...) or `workspaceId` (v2: `study_sessions`, `study_claims`, `user_connections`, `claim_evidence`, `motif_candidates`, ...), with tenant-safe composite unique keys and composite foreign keys (for example `user_connections_id_workspace_idx`, so a claim cannot cite another workspace's connection).
- Soft-deletable (`deletedAt`, via the shared `timestamps` helper) and carry a `revision` for optimistic concurrency where synced.
- Written only through sync push (ADR 0003).

Curated tables:

- Currently three: `sources`, `graph_edges`, `catalog_releases` (schema comments at `GRAPHEDGES-001` and `CONTENTPIPE-001`).
- Deliberately have no `userId`/`workspaceId` and no soft delete. `/content` is the single authoring source; the rows are release indexes, "never independently edited". A correction ships as a new release row, not a mutation.
- Written only by scripts a human runs (`db:import-graph-edges`, `db:sync-sources`, `content:build`), never by app routes.

The two never share a table. A learner's own connection is a `user_connections` row (with the same-row CHECK that `personal_resonance` requires `evidence_label = 'devotional'`); `graph_edges` is the reviewed/imported graph. `scripts/import-cross-references.mts` states the rule: "Personal overlays stay in `user_connections`; they are never written here."

## Consequences

- The ownership question for any new table has a one-line answer. Place data (`places`, `place_passages`) is planned as curated, compiled release rows (product plan section C.1), not hand-edited.
- Because curated tables have no soft delete, a bad curated row is fixed by a new release or by a human running SQL (RUNBOOK.md, emergency rollback). There is no in-app undo.
- `graph_edges` today holds bulk-imported rows (`type = parallel`, evidence from vote counts) and lacks the fields a reviewed edge needs (rationale, viewpoint, release id, review status); the plan schedules that as CURATEDEDGES-002. Until then a row's presence in `graph_edges` does not mean a human reviewed it.
- `study_sessions.catalog_release_id` exists but is a plain text column with no foreign key; whether the reader honours a pinned id (versus always taking the newest release) was not verified. `publishedLessons.ts` orders by `releasedAt desc limit 1`.
