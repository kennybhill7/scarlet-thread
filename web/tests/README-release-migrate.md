# Manually verifying `scripts/release-migrate.mts` against a live Postgres

`web/tests/release-migrate.test.ts` covers everything in
`scripts/lib/releaseMigrate.ts` that does **not** need a live database
(identity-check comparison, the expand-contract SQL scan, CLI/env parsing,
phase sequencing) with dependency-injected fakes — see that file's header
comment. It is part of `npm test`.

Three things genuinely cannot be proven without a real Postgres connection,
and this document is the manual procedure for them, following the exact
precedent `web/tests/README-db-invariants.md` already set for this class of
thing (not part of `npm test`, run by hand against a disposable database):

1. **The advisory lock actually serializes two concurrent invocations** — a
   second `release-migrate` process really blocks (or times out) while the
   first holds the lock, not just that the fake `tryAcquireLock` in the unit
   tests returns the sequence of booleans I told it to.
2. **The real drizzle-orm migrator actually applies SQL** end-to-end against
   a real database, including the readiness/foreign-state check correctly
   reading a real `drizzle.__drizzle_migrations` table.
3. **The identity check actually refuses** when connected to a real database
   whose name doesn't match `--expected-db`, not just that the pure
   `checkDatabaseIdentity` function returns `{ ok: false }` in isolation.

## STATUS: written but NOT executed against a live instance

Unlike `TRIGGER-001`'s environment (documented in
`README-db-invariants.md`, which had `sudo -u postgres psql` available on a
Debian-style container), this build ran on a Windows machine. Two separate
blockers, either one sufficient on its own, meant this procedure could not
actually be exercised this session:

- **No usable local Postgres credentials.** A local `postgresql-x64-18`
  Windows service IS running (`Get-Service postgresql-x64-18` → `Running`),
  but `pg_hba.conf` requires `scram-sha-256` password auth for every host,
  and no password is known or discoverable in this environment
  (`PGPASSWORD=postgres psql ...` → `password authentication failed`). This
  is Ken's real local Postgres install, not a disposable database
  provisioned for this task, so guessing/brute-forcing its password was not
  attempted.
- **`@neondatabase/serverless`'s `Pool` cannot reach a vanilla Postgres
  instance regardless of credentials.** Its own `README.md` states: "This
  package comes configured to connect to a Neon database. But you can also
  use it to connect to your own Postgres instances if you \[run your own
  WebSocket proxy\] (see `DEPLOY.md`)." No such proxy exists in this
  environment. This is the same constraint `README-db-invariants.md`
  already flagged from the other direction — "drizzle-kit's own default
  driver also can't reach a local Postgres instance here at all (it insists
  on Neon's websocket driver)" — this script is built on that same driver
  family, deliberately (see this task's acceptance criteria and
  `release-migrate.mts`'s header comment on why `Pool` is the right choice
  for a standalone CLI process), so it inherits the same limitation for
  local-Postgres testing.

Report this gap plainly rather than fabricating a "PASS" — see
`CLAUDE.md`'s prosecute-mode standard this workspace runs under. The
procedure below is written as precisely as `README-db-invariants.md`'s own,
so whoever runs it next (Ken, or a future CI job with real Neon branch
credentials) can follow it exactly.

## Prerequisites

A **disposable** Postgres database reachable the way `@neondatabase/serverless`'s
`Pool` actually connects — i.e. either:

- **(a) A real, disposable Neon project/branch** (the realistic option —
  this is what production and preview deploys use anyway). Create a
  throwaway branch in the Neon console or via `neonctl branches create`,
  copy its pooled connection string, and use that as `DATABASE_URL` below.
  Delete the branch afterward.
- **(b) A local Neon-compatible WebSocket proxy in front of a real local
  Postgres** (e.g. the `neon-local` Docker image, or
  `@neondatabase/serverless`'s own `wsproxy` reference implementation
  linked from its `DEPLOY.md`) — more setup, only worth it for repeated
  local iteration.

Either way: **never point this at a shared/staging/production database.**
The whole point of the identity check is to refuse an unexpected target —
prove that refusal against a database you are prepared to lose, not one you
aren't.

## (a) A real migration applying end-to-end

```bash
# From web/, against a fresh disposable database with NO migrations applied yet.
export DATABASE_URL="postgres://<disposable-neon-branch-connection-string>"

npx tsx scripts/release-migrate.mts --expected-db=<the disposable database's name>
```

**What a pass looks like:** structured `[phase] LEVEL message` lines for
`identity` (ok), `lock` (acquired), `readiness` (ok), `guard` (no
destructive statements — the current 11 migrations are all additive), then
`migrate` applying all 11 files, then `verify` confirming the journal table
has 11 rows and the smoke query (`select 1 from "stages" limit 1`)
succeeds. Exit code `0`. Then, independently, `psql` into the same database
and confirm `select count(*) from drizzle.__drizzle_migrations;` returns
`11` and `\dt` shows the application tables (`stages`, `entries`, etc.)
from `db/schema.ts`.

Re-running the exact same command a second time against the now-migrated
database should print `guard: No pending migrations to scan.` /
`migrate: Nothing to apply; database already up to date.` and still exit
`0` — idempotency is part of the pass condition, not just the first run.

## (b) The identity check actually refusing

```bash
# Point at the SAME real, reachable database, but claim you expect a
# DIFFERENT name.
npx tsx scripts/release-migrate.mts --expected-db=definitely-not-the-real-name
```

**What a pass looks like:** the very first log line after `[identity] INFO
Checking database identity...` is `[identity] ERROR Database identity
mismatch: connected to "<real-name>", expected "definitely-not-the-real-name".
Refusing to proceed.`, the process exits non-zero, and — critically — no
`[lock]` line ever appears (the lock must never even be attempted). Also
confirm the no-flag-at-all case: omit `--expected-db` entirely (and unset
`RELEASE_MIGRATE_EXPECTED_DB`) and confirm the same fail-closed refusal,
with the "No expected database identity configured" reason specifically
(not a coincidental mismatch — see the corresponding unit test in
`release-migrate.test.ts` for why that distinction matters).

## (c) The lock actually blocking a concurrent second run

```bash
# Terminal 1 — hold the lock deliberately by pointing at a database whose
# smoke-query table doesn't exist yet (so it fails late, after acquiring
# the lock, giving you a window), OR by adding a temporary `await new
# Promise(r => setTimeout(r, 20000))` right after "Lock acquired." while
# testing this locally (do not commit that).
npx tsx scripts/release-migrate.mts --expected-db=<name>

# Terminal 2 — started while Terminal 1 is still holding the lock:
npx tsx scripts/release-migrate.mts --expected-db=<name> --lock-timeout-ms=5000
```

**What a pass looks like:** Terminal 2 prints `[lock] INFO Acquiring
release-migrate advisory lock...` and then, after approximately 5 seconds
(bounded by `--lock-timeout-ms`, polled every `DEFAULT_LOCK_POLL_INTERVAL_MS`
= 1000ms), `[lock] ERROR Timed out after 5000ms waiting for the
release-migrate advisory lock (key 7420991003). Another release-migrate run
is likely in progress.` and exits non-zero — it must NOT hang indefinitely
(that would mean `pg_advisory_lock` was used instead of the intended
`pg_try_advisory_lock` poll loop). Once Terminal 1 finishes (or is killed —
Postgres releases a session-level advisory lock automatically when its
session ends, which is the safety net behind the explicit `finally` release
in `runReleaseMigration`), a third invocation should acquire the lock
immediately.

Independently, while Terminal 1 holds the lock, `psql` in a third session
and run:

```sql
select locktype, mode, granted from pg_locks where locktype = 'advisory';
```

confirming a row exists for the lock key while it's held, and is gone once
released.

## If you run this and it passes

Update this section (or ask Claude to, pointing at this file) with the real
output — which of (a)/(b)/(c) were run, against what (a real Neon branch? a
local proxy?), and paste the actual terminal output the way
`README-db-invariants.md`'s "Exact steps that were run to verify this file"
section does. Until then, treat this script as typechecked, linted,
unit-tested, and built successfully, but **not yet proven against a real
database** — the gap this section documents.
