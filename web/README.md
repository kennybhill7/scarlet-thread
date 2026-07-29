# Scarlet Thread

Scarlet Thread is a private, offline-first Bible reading and study journal
built with Next.js 16, Auth.js, IndexedDB, Neon Postgres, and Drizzle. (Working
name during early development: "Bible Brain" — you may still see that string
in older commits, docs, or the `bible-brain` repo/package identifiers.)

The product behavior comes from `Daily Study Guide.md` in the repository root:

- read before writing;
- capture observations rather than summaries;
- create a thread on its third sighting;
- keep passage/thread links bidirectional;
- never punish a missed day.

Ink stays in Apple Notes and is linked from an entry. The app does not include
a drawing tool or generated Bible commentary.

## Local setup

Requirements:

- Node.js 20.9 or newer;
- npm;
- Python 3 only when rebuilding/importing source data.

Install and validate:

```powershell
cd web
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd exec drizzle-kit check
npm.cmd audit
```

Copy `.env.example` to `.env.local` and supply:

```text
DATABASE_URL=
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_ALLOWED_EMAIL=
```

`AUTH_ALLOWED_EMAIL` is the only verified Google address allowed to sign in.
Missing configuration denies access.

Database activation order:

1. Create the Neon database and set `DATABASE_URL`.
2. Run `npm.cmd run db:migrate`.
3. Configure the Google OAuth callback as
   `/api/auth/callback/google`.
4. Run the app and complete the first allowed Google sign-in so the Auth.js
   user row exists.
5. Repair all migration findings in `CODEX_AUDIT.md`, then run
   `npm.cmd run db:seed` locally.

The baseline seed is deliberately one-time: it validates the complete private
dataset before connecting, refuses a user who already has journal data, and
writes stages, threads, people, entries, and backlinks in one database
transaction. It will not overwrite an active journal.

For a disposable PostgreSQL database with all migrations already applied, the
database invariant suite is:

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f tests/db-invariants.sql
```

It proves tenant-safe backlinks, active-thread targets, the required final
backlink, active-entry targets, safe thread retirement, and restore behavior.
The migration also uses row locks so concurrent backlink/retirement and
backlink/entry-deletion requests fail closed.

Start the development server with `npm.cmd run dev`.

## Data and privacy

The source Obsidian vault and its ZIP contain personal journal material. Do not
push either to GitHub without an explicit decision about third-party storage
and repository visibility.

`web/data/seed/` is intentionally ignored. It also contains personal writing
and must never be bundled into public static assets. The database seed command
reads it locally.

The current Climb and Review pages still use that local seed bridge. They must
move to authenticated, user-scoped database queries before deployment. See
`CODEX_AUDIT.md` for the evidence-backed release gates; a successful local
build is not deployment approval.

## Sync correctness

Writing is saved to IndexedDB and queued before a network request. Accepted
operations are removed from the queue; rejected operations remain recoverable.
The server returns the complete user-owned journal snapshot on each pull.
That is deliberate: client timestamps are useful for last-write-wins conflict
resolution but are unsafe as database cursors when a device clock is skewed or
a transaction commits late. Full pulls keep this single-user dataset
eventually complete, and the server snapshot wins an exact timestamp tie so
devices converge.

## Scripture data

Shipped translations:

- Berean Standard Bible (BSB);
- King James Version (KJV);
- American Standard Version (ASV);
- Young's Literal Translation (YLT);
- Santa Biblia libre Latinoamericano (SBL).

The converted corpus lives under `public/bible/`, split by version and book.
`npm test` independently verifies every shipped book, chapter, verse count,
and declared empty verse slot.

Rebuild commands from the repository root:

```powershell
py tools/build_bible.py --force
py tools/build_spanish.py --force
```

The present builder scripts have fail-closed/atomicity findings in
`CODEX_AUDIT.md`; do not replace a known-good corpus in a release workflow
until those are resolved.

## Architecture

- `app/(app)/read/**`, `components/reader/**`, `lib/bible/**`: reading path;
- `components/notes/**`, `components/threads/**`: local-first writing path;
- `lib/sync/**`: IndexedDB queue and Postgres synchronization;
- `app/api/**`, `lib/db/**`, `db/**`: authenticated API and persistence;
- `lib/export/**`: portable linked-Markdown ZIP export;
- `lib/contracts.ts`: shared read/write contract.

The complete ownership split and phase plan are in `../BUILD_PLAN.md`.
