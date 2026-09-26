# ADR 0005: Content release pipeline

- Date: 2026-09-25
- Status: Accepted (two BUILD_PLAN 5.1 items deliberately not built: signing, revocation)

## Context

Lessons are authored as Markdown under `content/curriculum/<track>/<nn-slug>.md`. What the app serves must be checkable, reproducible, unaffected by any single Vercel deployment, and unable to ship a draft or an unsourced claim.

## Decision

Authoring to release runs through fixed gates, code in `web/scripts/content/`:

1. **Validate** (`npm run content:validate`): zod frontmatter schema (`schema.ts`, strict), passage bounds against the shipped BSB corpus, the assertion-line lint (ADR 0002), required `## Teach-Back Prompts`, non-empty `sources[]` when a `## Positions` block exists.
2. **Compile**: `compileReleaseBundle` builds one deterministic bundle `{ schemaVersion: 1, lessonCount, lessons: { slug: { frontmatter, body } } }`, slugs sorted, a duplicate slug is an error. One failing lesson refuses the whole build; nothing is partially published.
3. **Checksum**: `computeChecksum` is SHA-256 over `canonicalJsonStringify` (keys sorted recursively), so anyone holding the bundle can recompute it.
4. **Publish-status gate** (`publishGateFailures`): every lesson in `content/curriculum/` must have `status: published`. One draft or in-review lesson blocks the release entirely, including an otherwise valid one.
5. **Source-registry gate, authoring side** (`missingSourceIds`): every `sources[]` id must exist in `content/source-registry.json`.
6. **Source-registry gate, database side** (SOURCESYNC-001, `findMissingSourceIds` in `lib/db/graphEdges.ts`): every id must also be a real row in Postgres `sources`. A registry entry authored but never synced (`npm run db:sync-sources`) refuses the release before any write.
7. **Write**: `content:build` inserts one row into `catalog_releases` (`id`, `releasedAt`, `checksum`, `lessonCount`, `bundle` jsonb). Append-only by convention: no update or delete path exists in code.
8. **Read**: the workspace reads the newest release (`orderBy releasedAt desc limit 1`, `lib/content/publishedLessons.ts`) and re-validates its shape with `LessonFrontmatterSchema` before trusting it. `connectionIds[]` resolve against real `graph_edges` rows; an unresolved id is skipped with a warning, not fatal.

Recorded from the code's own comments:

- Plain Markdown with a YAML-subset frontmatter, not MDX (no MDX tooling in the repo).
- Checksummed, not cryptographically signed: solo operator, no multi-party trust boundary today. "Durable, append-only, independent of one deployment" is met by living in Postgres.

## Consequences

- Order matters and is enforced: `db:sync-sources` must run before `content:build`, or the build refuses (gate 6).
- A release is the whole catalog. Publishing lesson N+1 requires every other lesson to be published, and omitting a lesson from a new release un-publishes it (the reader takes only the newest row).
- Not built, versus BUILD_PLAN 5.1: signatures, revocation records, verification at read time (the reader does not recompute the checksum), learner-visible errata, a rollback drill. The rollback procedure in RUNBOOK.md is therefore a corrective release or manual SQL, and is UNVERIFIED.
- `content:build` inserts a new row on every run, even when the checksum equals an existing release's. Repeated runs add rows but do not change behaviour, since only the newest is read.
- `content:build`, `db:sync-sources`, `db:seed` and `db:import-graph-edges` load `web/.env.local` (`tsx --env-file=.env.local`) and fail if it is absent (observed: `node: .env.local: not found`). Whoever runs them writes to whatever database that file names, which for this project has been production (per the `sync-source-registry.mts` header).
- As of this record `content:validate` fails on the live Genesis 3 lesson (missing `## Teach-Back Prompts`, required since LESSONSHAPE-001). The lesson stays served from its existing release row; until it is completed, no new release can be built.
