# Scarlet Thread runbook

Written 2026-09-25 (RELEASEOPS-001). Every command is a real script in `web/package.json` or `web/scripts/`, run from `web/`. Anything not checked against the real system is marked **UNVERIFIED**. Nothing in this file has been executed against a production or staging database: none of the migration, sync or release commands below has ever been run live (`web/tests/README-release-migrate.md` says the same about `release-migrate`).

## 0. Ground rules

- There is **one Postgres instance, and it is production** (header of `web/scripts/sync-source-registry.mts`). There is no staging database. Any command that reads `DATABASE_URL` from your shell or from `web/.env.local` is aimed at real data.
- Which scripts take their connection string from where:

| Command | Connection string comes from | Writes? |
|---|---|---|
| `npm run db:drift-check` | `DATABASE_URL` in the shell only (never reads `.env.local`, by design) | No: one SELECT |
| `npm run db:release-migrate` | `DATABASE_URL` in the shell (or `--database-url`) | Yes: applies migrations |
| `npm run db:sync-sources`, `npm run db:sync-stages`, `npm run content:build`, `npm run db:seed`, `npm run db:import-graph-edges` | `web/.env.local` (`tsx --env-file=.env.local`; fails with `.env.local: not found` if absent) | Yes |
| `npm run db:migrate` (`drizzle-kit migrate`) | drizzle config | Yes, **unguarded: not the release path** |

- Never use `npm run db:migrate` against the real database. It has none of the identity check, lock, guard or verification that `db:release-migrate` provides. It is the mechanism of the hook removed in `a1031cc` (gate 0.12).
- Migrations must never run inside a Vercel build.

## 1. Deploy (code)

1. Land the change on `master` through a pull request. The CI draft is in `docs/ci/ci.yml.draft` (not installed until Ken copies it to `.github/workflows/`; until then nothing runs automatically, and "passes locally" is the only gate). Run from `web/`: `npm run typecheck`, `npm run lint`, `npm run build`, then `npm test` (build first: the header wire tests and `tests/auth-db-failure.test.ts` need `.next/`; verified 2026-09-25, 1635 pass / 0 fail with a build present and no database or auth env).
2. Vercel deploys from `master`. **UNVERIFIED:** which Vercel project and URL is production, and whether the project's Root Directory is `web` (open item OPS-001; there is no `web/vercel.json`).
3. If the release includes a migration, do section 2 **first**, then let the deploy go out. Order: migrate, then deploy. The migrations must be additive (expand) so the old code keeps working against the new schema during the gap.
4. Smoke check after deploy (UNVERIFIED, not scripted): sign in, open `/`, open a Genesis chapter in `/read`, open the Genesis 3 study.
5. Rollback of code: promote the previous deployment in the Vercel dashboard. **UNVERIFIED** (not tried). It does not undo a migration (section 2) or a content release (section 6).

## 2. Migrate

Purpose: never again find production behind master (found 7 behind on 2026-09-17: consistent with 0006 through 0012 being unapplied; **UNVERIFIED**, nobody has queried the table). Human runs this; see section 7.

1. **Backup first.** `release-migrate` does not take or verify a backup (its own header says so). Create a Neon restore point or branch of production in the Neon console before continuing. **UNVERIFIED:** exact Neon steps and retention on this project's plan; see section 5.
2. **Drift check** (read-only):
   ```
   # from web/
   export DATABASE_URL='<connection string>'
   npm run db:drift-check
   ```
   Exit 0 in sync, 1 drift, 2 could not run. The report lists migrations not applied (`behind`), applied rows the repo does not know (`ahead`), an applied row whose hash differs from the file (`hash_mismatch`), and an unapplied migration older than an applied one (`gap`, which drizzle will never apply on its own). A CRLF-only difference is a warning, not drift (`.gitattributes` forces LF).
   It can also run from GitHub as the manual `drift-check` job in the CI draft (needs the `DRIFT_CHECK_DATABASE_URL` secret and a `production-readonly` environment; neither exists yet).
   - `behind` only: expected before a release; go on.
   - `gap`, `ahead`, `hash_mismatch`, `timestamp_mismatch`, `duplicate_applied`: **stop.** Do not run `release-migrate` until a human has read the finding. Note: `0006_typical_turbo.sql` and `0007_silly_madame_masque.sql` were edited in place by MIGORDER-001 (a pure statement reorder, see `web/tests/migration-order.test.ts`). If the database ever applied them before that edit, a `hash_mismatch` on those two is expected and is a decision for a human, not something to force through.
3. **Release migrate:**
   ```
   npm run db:release-migrate -- --expected-db=<database name>
   ```
   Phases (from `web/scripts/release-migrate.mts` and `web/scripts/lib/releaseMigrate.ts`): identity (`current_database()` must equal `--expected-db`; refuses if none configured), advisory lock (bounded wait, `--lock-timeout-ms`, default 30000), readiness (Postgres major version floor 14; journal state not foreign), guard (regex scan of pending SQL for `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... TYPE`, `DROP CONSTRAINT`; refuses unless `--allow-breaking`), migrate (drizzle programmatic migrator; all pending in one transaction), verify (journal row count and a `select 1 from "stages"` smoke query). Non-zero exit means stop and read the log.
   - `--allow-breaking` only after a human has read each flagged statement and confirmed the code being deployed no longer needs what is dropped.
   - **The first live run applies several migrations at once** (0006 through 0012 if the 2026-09-17 finding still holds), including the hand-written triggers in 0007. Take the backup in step 1 and expect it to be the first real test of this script. The manual live-database checks (lock contention, identity refusal, real apply) in `web/tests/README-release-migrate.md` have never been run. Consider running them on a disposable Neon branch first. That README still says "11 migrations"; there are 13.
4. **Verify:** run `npm run db:drift-check` again. It must exit 0. Optionally confirm in `psql`: `select count(*) from drizzle.__drizzle_migrations;` equals the number of entries in `web/db/migrations/meta/_journal.json` (13 as of this writing).
5. Rolling a migration back: there are no down migrations. Recovery is restoring from the section 1 backup, or a new forward migration. Migrations should be additive (expand, then contract in a later release).

## 3. Release content (lessons)

Content lives in `content/curriculum/<track>/<nn-slug>.md`. Pipeline and gates are in `docs/decisions/0005-content-release-pipeline.md`. Human runs this (section 7).

1. `npm run content:validate` (read-only). Must pass. It also validates `content/connections/*.json` against the source registry.
2. Confirm `web/.env.local` exists and its `DATABASE_URL` is the database you mean (it is production; there is no other).
3. `npm run db:sync-sources`: upserts `content/source-registry.json` into Postgres `sources`. **Must come before the build:** `content:build` refuses if any lesson source id has no `sources` row. Idempotent.
4. `npm run db:sync-stages`: upserts the 11 Mountain stages from `content/lens/eleven-stages.json` into Postgres `stages`, keyed on slug (SYNCSTAGES-001). Writes only `stages`; refuses and writes nothing unless the file passes the same checks `db:seed` applies (exactly 11 stages, unique slugs and stage numbers 1-11, valid chapters, reciprocal mirrors). Idempotent; stages removed from the file are not deleted. `stages` has no foreign keys, so it depends on no other sync; run it whenever the stage file changes.
5. `npm run content:build`: validates, compiles, checksums (SHA-256) and inserts one `catalog_releases` row. Refuses unless every lesson has `status: published`. Prints the checksum and `Wrote catalog_releases row <id>`. Every run inserts a new row, even if nothing changed.
6. **Connections (CURATEDEDGES-002):** reviewed connection rows live in `content/connections/*.json`. After migration 0013 is applied, run `npm run db:sync-connections` (upserts them into `graph_edges` with review_status=reviewed), **after** `db:sync-sources` (it pre-checks source ids) and **before** `content:build` (which refuses if a lesson's `connectionIds[]` has no reviewed row in the DB).
7. `npm run db:import-graph-edges` is the one-time bulk OpenBible import, not part of a normal release.
8. Verify (UNVERIFIED, manual): in `psql`, `select id, released_at, lesson_count, checksum from catalog_releases order by released_at desc limit 3;` The newest row is what the app serves. Then open the affected lesson in the app. Nothing at read time recomputes the checksum.

**`db:seed` is not a content-release step.** It is a ONE-TIME import of the owner's journal (threads, people, entries) that also writes the stages, and it refuses outright ("Seed target already contains journal data") on any account with a single entry, thread or person. Do not use it to push stage title/summary changes; use `npm run db:sync-stages` (step 4).

## 4. Rotate database credentials

**UNVERIFIED end to end.** Written from general Neon and Vercel practice, not from anything in the repo, and not rehearsed. The repo facts: the app reads `DATABASE_URL` (`web/lib/db/index.ts`), and the local scripts read it from `web/.env.local` or the shell.

1. In the Neon console, reset the password of the application role (or create a new role, then drop the old one after step 5). Copy the new pooled connection string.
2. Update `DATABASE_URL` in Vercel (Production; and Preview if it is set there). Redeploy production so running instances pick it up.
3. Update `web/.env.local` on any machine that has one, and the `DRIFT_CHECK_DATABASE_URL` GitHub secret if it exists.
4. Verify: `DATABASE_URL=<new> npm run db:drift-check` exits 0 or reports only expected drift, and sign-in works on the deployed site.
5. Revoke the old credential.
6. Also rotate, on the same schedule and in the same way: `AUTH_SECRET`, `AUTH_GOOGLE_SECRET` (Google Cloud console). **UNVERIFIED:** whether changing `AUTH_SECRET` signs everyone out (sessions are database-backed per the product plan; not checked).
7. If any secret was ever pasted into a chat, log or commit, treat it as leaked and rotate immediately. Do not put a real connection string in any file under version control.

## 5. Backup and restore drill (PLACEHOLDER, not yet drilled)

Nothing here has been tried. Fill in after the first drill.

- Backup mechanism to confirm: Neon point-in-time restore or branch. Retention window on the current Neon plan: **UNVERIFIED**.
- Learner-data escape hatch that exists in the app: the vault export at `GET /api/export` (`web/app/api/export/route.ts`, `web/lib/export/vault.ts`, v1 and v2), which contains the learner's own claims including private ones. It is a per-user export, not a database backup.
- Drill to design (monthly, per plan risk G8): restore into a new Neon branch, point a throwaway `DATABASE_URL` at it, run `npm run db:drift-check` (expect exit 0), open the app against it locally, record the time taken. Record date, result and time here:

| Date | Restored from | Drift check result | App opened OK | Minutes | Notes |
|---|---|---|---|---|---|
| (none yet) | | | | | |

## 6. Emergency rollback of a content release

The reader serves only the newest `catalog_releases` row (`orderBy releasedAt desc limit 1`, `web/lib/content/publishedLessons.ts`). Rows are never updated by code. No revocation record exists. **UNVERIFIED:** neither option below has been run.

- **Preferred: corrective release.** Revert the content change in git, then section 3. This adds a new newest row with the old content. It needs `content:validate` to pass, which today it does not (see section 3, step 1).
- **Fast: remove the bad row (human decision, manual SQL).** Identify it with the query in section 3, step 8, then in `psql` delete that one row by id. The app then serves the previous newest row. This breaks the "append-only" convention on purpose, so record what was deleted and why (row id, checksum, reason) in `AGENT_STATUS.md`. If it was the only row, learners see the "no curated content yet" state until a new release is built.
- Does not affect learner data. It does not undo a migration.

## 7. What agents may and may not do

Agents may: edit code, tests, `content/` and `docs/` on an `agent/*` branch or worktree; run `typecheck`, `lint`, `npm test`, `content:validate` and `build` locally; write migration files via `drizzle-kit generate` (which touches no database); open pull requests for Ken.

Agents may not:

- Edit `.github/` (workflows are drafted under `docs/ci/` and installed by Ken).
- Run any command that connects to a real database: `db:drift-check`, `db:release-migrate`, `db:migrate`, `db:sync-sources`, `db:sync-stages`, `db:seed`, `db:import-graph-edges`, `content:build`, `db:studio`. Do not search for or read `.env*` files or credentials.
- Change Vercel, Neon or Google Cloud settings, or rotate any credential.
- Merge to `master`, push, or deploy.
- Edit an already-applied migration file. It changes its hash, and drizzle would not notice, only the drift check would (`0006`/`0007` were already edited once, see section 2). Add a new migration instead.
- Mark a lesson `published` or set `assertionReviewed` (ADR 0002): those are Ken's calls.

## 8. Human gates (Ken)

| Gate | Why a human |
|---|---|
| Any run of `db:release-migrate` on the real database | Irreversible without a restore; first live run of an untested script |
| Backup / restore point before each migration | The script does not take one |
| `--allow-breaking` | Only a human can judge what the running code still needs |
| Resolving any drift finding other than plain `behind` | Needs judgment about which side is right |
| `db:sync-sources`, `content:build` | Writes to the only (production) database |
| Flipping a lesson to `status: published`; approving tone and evidence labels | Assertion line and pastoral judgment (ADR 0001, ADR 0002) |
| Emergency deletion of a `catalog_releases` row | Breaks the append-only convention |
| Installing `docs/ci/ci.yml.draft` into `.github/workflows/`; creating the `production-readonly` environment and `DRIFT_CHECK_DATABASE_URL` secret | Agents may not touch `.github/` or repository settings |
| Vercel Root Directory (OPS-001), Ignored Build Step for `agent/*`, Preview env vars | Dashboard settings; see the comment block at the end of `docs/ci/ci.yml.draft` (UNVERIFIED) |
| Credential rotation | Section 4 |

## 9. Open items this runbook depends on

- Which URL is production and who can sign in today: UNVERIFIED (product plan, open questions).
- No staging database. A disposable Neon branch is the only safe place to rehearse `release-migrate`.
- No observability: a production error is invisible today (product plan section 1.7). Smoke checks above are manual.
- Migration 0013 (and later) must be applied to production by a human before the connection/place sync scripts can run; nothing applies migrations automatically.
