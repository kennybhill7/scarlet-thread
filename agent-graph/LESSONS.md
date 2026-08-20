# Scarlet Thread — project lessons

Project-specific occurrences of the patterns catalogued in
`C:\Users\kenny\.claude\lessons\GENERAL_LEDGER.md` (cross-project, on this
machine). Every builder's spec step should read both before starting;
every retro after a task reaches `done` or `blocked` should update both —
the occurrence here, the pattern there. See that directory's `README.md`
for the exact premortem/retro prompts.

| Task | Pattern | What happened | Commit(s) |
|---|---|---|---|
| P0UI-001 (round 1) | TOCTOU-001 | Export re-checked pending writes after the archive arrived; clear-device did not — a note saved during the sign-out round trip was destroyed unsynced while the flow reported success. | `6861666` |
| P0UI-001 (round 2) | TOCTOU-001, SCOPE-BOUNDARY-001 | The re-check was added as the first statement of the destroy path, closing the round-1 gap — but a second tab holding an open connection kept the delete queued in the browser; closing that tab (which the app's own copy told the user to do) fired it. Root fix needs a lock taken by the writer module, outside this task's owned paths. | `2ec3457` |
| SEC-001 (round 2) | SELF-FULFILLING-TEST-001 | The wire suite's expected header values were derived from the same exported constant a deleted rule would also remove, so de-registering the `/sw.js` rule passed the wire suite and failed only the unit tests. | `658cc3d` |
| SEC-001 (round 3) | SILENT-SKIP-001 | The wire suite — the only real-response evidence for the header policy — skips by default when no production build exists, and `npm test` has no build step; no CI exists to force it. | `658cc3d` (finding, not yet fixed — see `SEC-002`) |
| BUILD_PLAN / THEOLOGY docs | CROSS-TABLE-INVARIANT-001 | The devotional/personal_resonance exclusion rule spans two tables; an ordinary `CHECK` constraint can't see across them. | `aade632` (doc fix), schema fix pending |
| `queue.state.json` seed | ORPHAN-REFERENCE-001 | `P0-002` was referenced in the shared queue state before its definition was committed to `tasks.json` on the same branch. The first live cloud worker run correctly declined to improvise and reported the gap. | `38c54ae` (fix) |
| Interactive controller state | GITIGNORED-COORDINATION-STATE-001 | `agent-graph/state.local.json` (git-ignored) held all task-lifecycle state; a scheduled cloud worker on a fresh clone could not see any of it. `queue.state.json`, committed on `ops/agent-queue`, was introduced to fix this. | `8f844dc` |
| P0-002 | FAIL-CLOSED-COVERAGE-GAP (candidate) | The PocketPg WHERE evaluator's `<>` operator was `!equal(left, right) && left !== null` — Postgres three-valued NULL logic requires *both* sides non-null for `<>` to be true/false rather than UNKNOWN, but the old code only checked the left side, so a NULL right operand made `<>` return true for every non-null left value. No production code calls `ne()`/`<>` today (confirmed by grep), so this was purely latent; fixed to `left !== null && right !== null && left !== right` with a direct unit test (`EVAL1`) against `evaluatePredicate`. Also closed 5 audit-identified gaps in the tenant-isolation attack matrix (mixed-batch partial rejection, in-batch duplicate-id dedupe, person/log slug-collision squats, soft-deleted-entry id-squat) — all test-only, no production code touched. | `c2324d2` |
| TRIGGER-001 | CROSS-TABLE-INVARIANT-001 | Extended `db-invariants.sql` with fixtures proving migration 0007's three deferrable constraint triggers for the devotional/theology rule against a real Postgres 16 engine (previously only proven by SQL-text assertion + a JS truth table in `schema-followups.test.ts`, per SCHEMAFU-001's own notes). All three rejection paths (insert, connection relabel, claim retype), both allowed cases, and the deferred-until-commit healing case were run for real; mutation-tested by disabling each trigger individually and confirming each disable breaks exactly its own fixture. | `a1bbbcc` |
| TRIGGER-001 | SILENT-SKIP-001 | `db-invariants.sql` is not wired into `npm test` or CI (same as before this task) — it only runs if a human remembers to `psql -f` it against a disposable database. Nothing structural stops it from silently never running again, the same shape SEC-001/round-3 already flagged for the header wire suite. Documented the exact run command and pass/fail signature in the new `README-db-invariants.md` so a human has no ambiguity about how to invoke it, but did not add CI wiring (out of this task's owned paths). | `a1bbbcc` (mitigated by documentation, not closed) |
| TRIGGER-001 | SCOPE-BOUNDARY-001 | While standing up a real Postgres instance to run the new fixtures, discovered that `db/migrations/0006_typical_turbo.sql` and `0007_silly_madame_masque.sql`, as shipped, each add a composite `(id, workspace_id)` foreign key *before* the `CREATE UNIQUE INDEX` statement that FK depends on — so applying either file via plain `psql -f` (or `npm run db:migrate`, which hits the identical statement-order problem) fails outright on a fresh database with "there is no unique constraint matching given keys". `db/migrations/` is a read-only path for TRIGGER-001, so this was not fixed here: worked around only in an uncommitted local scratch copy (statement order changed, content untouched) to actually exercise the new fixtures, and documented in `README-db-invariants.md` with the exact repro and workaround for a human/follow-up task. | `a1bbbcc` (finding, not fixed — real fix belongs in a follow-up task against `db/migrations/`) |

## Open, not yet retro'd

- The `FAIL-CLOSED-COVERAGE-GAP` pattern above is now grounded in a landed
  fix (`P0-002`, commit `c2324d2`) rather than speculation. Ready for a
  human to review and promote into `GENERAL_LEDGER.md` — the general shape
  is "a validator's default-safe behavior only covers operators/branches
  actually exercised today; an unused-but-latent one can silently
  misbehave the moment something starts exercising it," which is broader
  than just SQL operators and likely recurs in schema validators, permission
  checks, and parsers elsewhere.

- New candidate pattern from TRIGGER-001, not yet in `GENERAL_LEDGER.md`:
  **GENERATED-MIGRATION-FK-ORDER-001** — a drizzle-kit-generated migration
  file placed `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements
  referencing a composite `(id, workspace_id)` pair *before* the
  `CREATE UNIQUE INDEX ..._id_workspace_idx` statement that composite FK
  needs, in both `0006_typical_turbo.sql` and `0007_silly_madame_masque.sql`
  independently — the same mistake made twice, which suggests it is a
  systematic hazard of this project's `workspaceId`-scoped composite-FK
  pattern (now used by most v2 tables) rather than a one-off typo. Applying
  either file with plain `psql -f`, or via `npm run db:migrate`, fails on a
  fresh database. The general shape, if a human confirms it recurs: "a
  generated migration file that adds a composite foreign key can silently
  place it before the unique index backing the referenced side, and nothing
  in the generate step or CI catches the ordering until someone actually
  tries to apply the file end-to-end on an empty database" — worth checking
  whether `db:generate`'s output should be lint-checked for this shape, or
  whether newer tables should stop relying on hand-verified statement order
  entirely. Not yet promoted; a human should review before it goes into
  `GENERAL_LEDGER.md`. Full repro and a non-committed workaround are in
  `web/tests/README-db-invariants.md`. Fixing the two migration files
  themselves is out of TRIGGER-001's scope (`db/migrations/` was a
  read-only path) and should be its own follow-up task.

## TASKDEF-PATHS-001 — a task definition that names a file which does not exist

**Occurred:** 2026-08-20, V2VAULT-001.

I wrote `readOnlyPaths` naming `web/tests/sync-store.test.ts` and
`web/tests/clear-device.test.ts`. Neither exists; the real files are
`local-store.test.ts` and `device-clear.test.ts`. The builder found the real
ones, treated them as the intended targets, left them untouched, and flagged
the drift instead of guessing silently. That is the right handling and it cost
it time it should not have had to spend.

**Why it matters:** a builder that quietly resolves a wrong path might resolve
it to the wrong file. A builder that treats a non-existent path as "nothing to
read" might skip a constraint the task depended on. Either way the failure is
silent.

**How to apply:** before seeding a task, verify every path in `ownedPaths` and
`readOnlyPaths` actually resolves - a single `git ls-files` check. For a path
that is meant to be NEW, say so explicitly in the task so the builder knows the
absence is intended rather than a typo.
