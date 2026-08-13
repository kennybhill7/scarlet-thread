# Scarlet Thread agent graph

This package coordinates Claude and Codex without giving either agent unchecked
control of the repository. It is a small state machine, not an AI model.

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

The builder and auditor must be different actors. Three failed verification or
audit cycles block the task instead of allowing an endless, increasingly risky
loop. Doctrine, Scripture publication, personal-data policy, licensing,
production database changes, secrets, deployment, and public release always
require a named human decision.

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

The controller creates one atomic `ledger.local.json` containing both current
state and receipts. It is ignored because it is a local operational record.
Copy durable, redacted
evidence into the relevant issue or pull request before deleting local state.

## State flow

```text
ready/rework -> building -> awaiting_verification -> awaiting_audit -> auditing
                    ^              |                       |             |
                    +---- rework <-+-----------------------+-------------+

auditing -> done
auditing -> human_gate -> done
any active state -> blocked
```

Use the controller for transitions so the separation-of-duties and evidence
rules cannot be skipped:

```powershell
node .\agent-graph\controller.mjs transition DOC-001 claim-builder --actor claude
node .\agent-graph\controller.mjs transition DOC-001 submit-build --actor claude --commit <sha> --branch agent/DOC-001-claude --evidence "git diff --check passed"
node .\agent-graph\controller.mjs transition DOC-001 verify-pass --actor verifier --evidence "npm test passed"
node .\agent-graph\controller.mjs transition DOC-001 claim-auditor --actor codex
node .\agent-graph\controller.mjs transition DOC-001 audit-pass --actor codex --evidence "acceptance criteria independently checked"
```

For a gated task, the last command moves it to `human_gate`. A human then runs:

```powershell
node .\agent-graph\controller.mjs transition <task-id> approve --actor <human-name> --evidence "decision and review reference"
```

## Branch and worktree contract

1. Never let both agents edit the same checkout concurrently.
2. Use `agent/<task-id>-claude` for the builder and
   `audit/<task-id>-codex` for audit-only notes or tests.
3. The auditor reviews an immutable builder commit SHA, not a moving branch.
4. No agent pushes directly to `master` or merges its own work.
5. `web/lib/contracts.ts` remains read-only unless a task explicitly owns an
   additive contract change and both plans name the same canonical shape.
6. The real `Bible-Brain/` vault, secrets, production data, and local Claude
   settings are never task inputs or evidence attachments.

## What this automates -- and what it does not

It automates task selection, prompts, state transitions, retry limits, an
atomic locked state-and-receipt ledger,
and human-gate enforcement. It deliberately does not launch Claude because no
Claude CLI is installed in this environment, and guessing an unattended CLI
contract would be unsafe. The prompt command gives either interface the exact
bounded assignment. Codex can also use a durable `/goal` for one task whose stop
condition and validation commands are already defined here.

After a Claude CLI or API is deliberately installed and authenticated, add a
thin adapter that calls this controller. Keep credentials outside the repo and
retain every gate in `graph.config.json`.
