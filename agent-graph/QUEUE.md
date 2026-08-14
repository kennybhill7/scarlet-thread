# Night queue — how the cloud worker uses this branch

`ops/agent-queue` is the **only** branch the scheduled cloud worker reads and
writes for coordination. It exists because `agent-graph/state.local.json` is
machine-local and git-ignored: a cloud run on Anthropic's infrastructure cannot
see it, so without a shared file the worker would have no idea what is already
done and would redo finished tasks.

## Files

- `agent-graph/tasks.json` — task definitions. Source of truth for scope.
  Owned/read-only paths and acceptance criteria are binding on the worker.
- `agent-graph/queue.state.json` — shared, committed run state (below).
- `agent-graph/state.local.json` — **still local-only and git-ignored.** The
  interactive session keeps using it. The two are reconciled by a human or by
  the next interactive session; the shared file is advisory, exactly as
  `graph.config.json` says of shared state.

## `queue.state.json` contract

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "ISO-8601",
  "lease": {                  // prevents two overlapping runs doing the same task
    "taskId": "SEC-002",      // null when free
    "runId": "cloud-<uuid>",
    "takenAt": "ISO-8601",
    "expiresAt": "ISO-8601"   // takenAt + 90 minutes
  },
  "tasks": {
    "SEC-002": {
      "status": "ready|building|submitted|blocked|done",
      "branch": "agent/SEC-002-cloud",
      "commitSha": "…",
      "attempts": 0,
      "lastRunId": "cloud-…",
      "lastEvidence": "…",
      "notes": "…"
    }
  }
}
```

**Lease rule:** a run may only work a task if `lease.taskId` is null or
`lease.expiresAt` is in the past. It takes the lease, pushes that commit
**before** starting work, and releases the lease in the same push as its result.
If pushing the lease fails, the run stops — losing a race is not a reason to
work anyway.

**Attempt cap:** three failed attempts on one task sets `status: "blocked"`.
The worker never resets an attempt counter and never unblocks a task; that is a
human decision, mirroring the interactive controller where `blocked` is terminal.

## Hard limits on the worker

- Never pushes `master`. Never merges. Never force-pushes anything.
- Never touches `protectedPaths` from `graph.config.json` (vault, `.env*`,
  `.claude/`, `.github/`, `.gitignore`, `AGENTS.md`, `agent-graph/` — the one
  exception being `queue.state.json`, which is how it reports).
- Never works a task whose `humanGates` is non-empty.
- Never claims a deterministic check passed without pasting its real output.
- One task per run. Stop when it is submitted, even if time remains.
