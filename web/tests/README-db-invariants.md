# Running `db-invariants.sql`

`tests/db-invariants.sql` proves database-level invariants (Postgres
triggers and CHECK constraints that Drizzle cannot express in
`db/schema.ts`) against a real, disposable Postgres instance. It is not
part of `npm test` — it needs a live database and is run manually.

The whole file is one transaction (`BEGIN; ... ROLLBACK;`): every fixture
row it inserts is rolled back at the end, so it never leaves data behind
and is safe to re-run.

## What it covers

- Migration `0003_enforce_active_thread_links.sql` — the `entries` /
  `entry_threads` / `threads` active-link invariant (orphan rejection,
  cross-tenant backlink rejection, retired-thread rejection, deferred
  restore ordering).
- Migration `0007_silly_madame_masque.sql` — the three deferrable
  constraint triggers that keep a `devotional`-labeled `user_connections`
  row from ever backing a `theology`-kind `study_claims` row via
  `claim_evidence`, no matter which of the three tables changes first
  (added by TRIGGER-001; see the file's own comments for the fixture
  breakdown against each acceptance criterion).

## Prerequisites

A local (or otherwise disposable — never a shared/staging/production
database) Postgres instance and the `psql` client. Nothing else; this
does not go through `drizzle-kit` or the app's Neon serverless driver.

```bash
# Debian/Ubuntu-style, if postgres isn't already running:
service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
```

## KNOWN ISSUE: migrations 0006 and 0007 don't apply cleanly in file order

**This is a pre-existing defect in `db/migrations/`, discovered while
building TRIGGER-001's fixtures. `db/migrations/` is a read-only path for
this task, so it is documented here rather than fixed.**

Both `0006_typical_turbo.sql` and `0007_silly_madame_masque.sql` emit
their `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements for
composite `(id, workspace_id)` references *before* the
`CREATE UNIQUE INDEX ..._id_workspace_idx` statements those foreign keys
depend on. Concretely:

- `0006_typical_turbo.sql` line ~150 adds
  `applications_session_workspace_fk` (and two more) referencing
  `study_sessions("id","workspace_id")`, but
  `study_sessions_id_workspace_idx` isn't created until line ~170.
- `0007_silly_madame_masque.sql` line ~38 adds
  `teaching_sections_draft_workspace_fk` referencing
  `teaching_drafts("id","workspace_id")`, but
  `teaching_drafts_id_workspace_idx` isn't created until line ~55.

Applying either file as-is with `psql -f` fails with:

```
ERROR:  there is no unique constraint matching given keys for referenced table "study_sessions"
```

(or `"teaching_drafts"` for 0007). This reproduces with `npm run
db:migrate` too — not just raw `psql -f` — since it's a statement-order
problem, not a transaction-wrapping one; drizzle-kit's own default driver
also can't reach a local Postgres instance here at all (it insists on
Neon's websocket driver — a separate, unrelated blocker), so raw `psql -f`
is the only way this was actually exercised.

**Workaround for running the fixtures locally (do not commit this — it
is not a fix to the migration files, just a way to stand up a working
schema for this manual verification):** for these two files only, apply
every statement *except* the `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN
KEY` ones first, then apply the deferred `FOREIGN KEY` statements last.
No statement's content changes, only the order they run in. A small
Python one-liner does this without hand-editing:

```bash
python3 - "$FILE" <<'EOF' > /tmp/reordered.sql
import re, sys
content = open(sys.argv[1]).read()
parts = content.split("--> statement-breakpoint\n")
fks = [p for p in parts if re.match(r'^ALTER TABLE .* ADD CONSTRAINT .*FOREIGN KEY', p.strip())]
rest = [p for p in parts if p not in fks]
print("--> statement-breakpoint\n".join(rest + fks), end="")
EOF
```

A real fix belongs in a follow-up task against `db/migrations/` itself
(out of TRIGGER-001's scope): either hand-reorder the generated SQL, or
regenerate with a `drizzle-kit` version/flag that emits unique indexes
before the foreign keys that reference them.

## Exact steps that were run to verify this file

```bash
# 1. Disposable database
sudo -u postgres psql -c "DROP DATABASE IF EXISTS trigger001_test;" \
                       -c "CREATE DATABASE trigger001_test;"

# 2. Migrations 0000-0005 and 0007's/0006's non-FK statements, in order,
#    then the two files' FK statements last (see workaround above).
#    From web/:
for f in db/migrations/0000_solid_mojo.sql \
         db/migrations/0001_deep_quasimodo.sql \
         db/migrations/0002_magical_stranger.sql \
         db/migrations/0003_enforce_active_thread_links.sql \
         db/migrations/0004_minimize_sync_receipts.sql \
         db/migrations/0005_tenant_scope_sync_receipts.sql \
         /tmp/0006_reordered.sql \
         /tmp/0007_reordered.sql; do
  psql -h localhost -U postgres -d trigger001_test -v ON_ERROR_STOP=1 -f "$f"
done

# 3. The fixtures themselves
psql -h localhost -U postgres -d trigger001_test -v ON_ERROR_STOP=1 -f tests/db-invariants.sql
```

## What a pass looks like

`psql -f tests/db-invariants.sql` prints a sequence of `BEGIN`, `INSERT`,
`DO`, `UPDATE`, `SET CONSTRAINTS` lines and ends with `ROLLBACK` — **no
`ERROR` line anywhere in the output**. Every intentionally-rejected write
in the file is wrapped in its own `DO $$ BEGIN ... EXCEPTION WHEN
check_violation THEN NULL; END; $$;` block, so an expected rejection is
caught internally and never surfaces as a top-level `ERROR`; if a rejection
that should have happened does *not* happen, the block's own `RAISE
EXCEPTION 'Expected ... rejection'` fires instead and *does* surface as a
top-level `ERROR`, aborting the whole script (`psql`'s exit code will also
be non-zero). So: clean output ending in `ROLLBACK` = pass; any `ERROR` =
a real invariant failure.

This was confirmed to have real teeth, not just to run cleanly: with each
of the three new devotional/theology triggers disabled one at a time
(`ALTER TABLE ... DISABLE TRIGGER ...`), the script failed loudly at the
exact fixture written to catch that trigger, and passed clean with all
three enabled. The full clean run (0003's fixtures plus TRIGGER-001's) and
all three single-trigger-disabled mutants were run against a real Postgres
16 engine as part of building this file.
