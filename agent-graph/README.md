# Scarlet Thread agent graph

This package records a bounded coordination workflow for Claude and Codex. It is
a small advisory state machine, not an AI model or repository access control.

> **Trust boundary:** this local controller is a coordination ledger, not an
> identity provider. Every process running as the same Windows user can type an
> arbitrary `--actor` value or edit ignored state. Therefore only the primary
> orchestrator may execute audit or human-approval transitions, and every such
> receipt must be checked against the independent agent result. A shared local
> checkout cannot cryptographically prove "Claude" versus "Codex." Enforce that
> boundary later with separate GitHub identities, protected branches, required
> CI checks, and reviewer approval. Never treat local state alone as permission
> to merge, push, deploy, migrate, or publish.

The default assignment is:

- Claude builds one bounded task on its own branch or worktree.
- Deterministic commands verify the proposed commit.
- Codex audits that exact commit independently.
- The controller either closes the task, sends it back for repair, or stops at a
  human gate.

The state machine rejects the same actor label for builder/operator and auditor.
Three failed verification or audit cycles block the task instead of allowing an
endless, increasingly risky loop; invalidating a bad audit receipt does not
consume a repair cycle. Human-gate categories are available for doctrine,
Scripture publication, personal-data policy, licensing, production database
changes, secrets, deployment, and public release, but a gate exists only when
the reviewed task definition names it. External authorization remains required.

If an agent records a premature or falsely attributed approval, the primary
orchestrator invalidates it with an evidence receipt:

```powershell
node .\agent-graph\controller.mjs transition <task-id> invalidate-audit --actor codex-controller --evidence "independent audit result and reason"
```

## Start here

From the repository root:

```powershell
node .\agent-graph\controller.mjs validate
node .\agent-graph\controller.mjs list
node .\agent-graph\controller.mjs next builder
node .\agent-graph\controller.mjs prompt DOC-001 builder claude
```

The controller creates one atomic schema-v2 `ledger.local.json` containing both
current state and receipts. Each task state stores a SHA-256 digest of its task
definition and graph configuration. Any definition, task-set, or configuration
drift fails closed until a human reviews the change and performs an explicit
reset. The ledger is ignored because it is a local operational record. Copy
durable, redacted evidence into the relevant issue or pull request before
resetting or deleting local state; reset discards the prior local receipts.

## State flow

```text
ready/rework -> building -> awaiting_verification -> awaiting_audit -> auditing
                    ^              |                       |             |
                    +---- rework <-+-----------------------+-------------+

auditing -> done
auditing -> human_gate -> done
any active state -> blocked

ready/rework -> submit-operational -> awaiting_verification (ownedPaths is empty)
```

Use the controller to record transitions and reject invalid state changes. It
does not prevent a process from editing files, bypassing the CLI, or falsifying
actor/evidence text, so its receipts never replace protected branches, required
CI, authenticated review, or deployment controls:

```powershell
node .\agent-graph\controller.mjs transition DOC-001 claim-builder --actor claude --base <40-character-base-sha> --branch agent/DOC-001-claude
node .\agent-graph\controller.mjs transition DOC-001 submit-build --actor claude --commit <40-character-tip-sha> --branch agent/DOC-001-claude --evidence "git diff --check passed"
node .\agent-graph\controller.mjs transition DOC-001 verify-pass --actor deterministic-checks --evidence "npm test passed"
node .\agent-graph\controller.mjs transition DOC-001 claim-auditor --actor codex
node .\agent-graph\controller.mjs transition DOC-001 audit-pass --actor codex --evidence "acceptance criteria independently checked"
```

An evidence-only task with `ownedPaths: []` uses the operational flow and never
manufactures a Git commit:

```powershell
node .\agent-graph\controller.mjs transition OPS-001 submit-operational --actor <operator> --evidence "deployment and smoke-test receipt references"
```

For a gated task, the last command moves it to `human_gate`. A human then runs:

```powershell
node .\agent-graph\controller.mjs transition <task-id> approve --actor <human-name> --evidence "decision and review reference"
```

## Branch and worktree contract

1. Never let both agents edit the same checkout concurrently.
2. Use `agent/<task-id>-claude` for the builder and
   `audit/<task-id>-codex` for audit-only notes or tests.
3. At the initial claim, the builder branch must exist at the exact full base
   SHA. Submission must name its exact full branch-tip SHA.
4. The controller inspects every commit in `base..tip`, rejects merge commits,
   and requires every touched path (including both rename/copy sides) to be
   owned. Read-only, secret, protected, and controller paths fail closed.
5. A task cannot start before every `dependsOn` task is done or while another
   active/rework/human-gate task reserves an overlapping owned path.
6. The auditor reviews an immutable builder commit SHA, not a moving branch.
7. No agent pushes directly to `master` or merges its own work.
8. `web/lib/contracts.ts` remains read-only unless a task explicitly owns an
   additive contract change and both plans name the same canonical shape.
9. The real `Bible-Brain/` vault, secrets, production data, controller files,
   repository workflow controls, and local Claude
   settings are never task inputs or evidence attachments.

## What this automates -- and what it does not

It automates advisory task selection and prompts, validates transitions and
commit-range ownership, limits recorded repair attempts, and writes an atomic
locked state-and-receipt ledger. It does not authenticate actors or evidence,
execute the listed verification, authorize a merge/deployment/publication, or
prove that a human actually approved a gate. Those controls belong in CI,
protected branches, provider access policy, and named human review. It also
does not launch Claude because no Claude CLI is installed in this environment,
and guessing an unattended CLI contract would be unsafe. The prompt command
gives either interface the exact bounded assignment. Codex can also use a
durable `/goal` for one task whose stop condition and validation commands are
already defined here.

After a Claude CLI or API is deliberately installed and authenticated, add a
thin adapter that calls this controller. Keep credentials outside the repo and
retain every gate in `graph.config.json`.
