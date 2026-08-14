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

## Open, not yet retro'd

- `P0-001`'s audit found a latent evaluator gap (`ne()`/`<>` with a NULL
  operand would be misinterpreted, not rejected, if ever introduced) —
  worth a `GENERAL_LEDGER.md` entry once `P0-002` closes it: a name like
  **FAIL-CLOSED-COVERAGE-GAP** for "a validator's default-safe behavior
  only covers operators actually exercised today; an unused-but-latent
  operator can silently misbehave the moment someone starts using it."
  Draft after `P0-002` lands so it's grounded in the fix, not speculation.
