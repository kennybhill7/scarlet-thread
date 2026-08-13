import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyTransition, initialState, pathsOverlap, renderPrompt, resolveCommit, validateDefinitions, withLedgerLock } from "./controller.mjs";
import config from "./graph.config.json" with { type: "json" };
import definitions from "./tasks.json" with { type: "json" };

function fixture(taskId = "DOC-001") {
  const task = definitions.tasks.find((candidate) => candidate.id === taskId);
  const state = initialState({ tasks: [task] }).tasks[task.id];
  return { task, state };
}

test("tracked graph definitions are valid", () => {
  assert.deepEqual(validateDefinitions(config, definitions), []);
});
test("builder cannot audit its own commit", () => {
  const { task, state } = fixture();
  applyTransition({ task, taskState: state, config, action: "claim-builder", flags: { actor: "claude" } });
  applyTransition({ task, taskState: state, config, action: "submit-build", flags: { actor: "claude", commit: "a".repeat(40), evidence: "checks" } });
  applyTransition({ task, taskState: state, config, action: "verify-pass", flags: { actor: config.defaultRoles.verifier, evidence: "tests pass" } });
  assert.throws(
    () => applyTransition({ task, taskState: state, config, action: "claim-auditor", flags: { actor: "claude" } }),
    /different actors/,
  );
});

test("ungated audited work completes", () => {
  const { task, state } = fixture();
  applyTransition({ task, taskState: state, config, action: "claim-builder", flags: { actor: "claude" } });
  applyTransition({ task, taskState: state, config, action: "submit-build", flags: { actor: "claude", commit: "a".repeat(40), evidence: "checks" } });
  applyTransition({ task, taskState: state, config, action: "verify-pass", flags: { actor: config.defaultRoles.verifier, evidence: "tests pass" } });
  applyTransition({ task, taskState: state, config, action: "claim-auditor", flags: { actor: "codex" } });
  applyTransition({ task, taskState: state, config, action: "audit-pass", flags: { actor: "codex", evidence: "criteria pass" } });
  assert.equal(state.status, "done");
});

test("gated work stops for an independent human", () => {
  const { task, state } = fixture("OPS-001");
  applyTransition({ task, taskState: state, config, action: "claim-builder", flags: { actor: "claude" } });
  applyTransition({ task, taskState: state, config, action: "submit-build", flags: { actor: "claude", commit: "a".repeat(40), evidence: "receipts" } });
  applyTransition({ task, taskState: state, config, action: "verify-pass", flags: { actor: config.defaultRoles.verifier, evidence: "checks" } });
  applyTransition({ task, taskState: state, config, action: "claim-auditor", flags: { actor: "codex" } });
  applyTransition({ task, taskState: state, config, action: "audit-pass", flags: { actor: "codex", evidence: "audit" } });
  assert.equal(state.status, "human_gate");
  assert.throws(
    () => applyTransition({ task, taskState: state, config, action: "approve", flags: { actor: "codex", evidence: "self approval" } }),
    /independent/,
  );
  applyTransition({ task, taskState: state, config, action: "approve", flags: { actor: "ken", evidence: "approved deployment receipt" } });
  assert.equal(state.status, "done");
});

test("three failed cycles block instead of looping forever", () => {
  const { task, state } = fixture();
  for (let cycle = 1; cycle <= config.maxRepairCycles; cycle += 1) {
    applyTransition({ task, taskState: state, config, action: "claim-builder", flags: { actor: "claude" } });
    applyTransition({ task, taskState: state, config, action: "submit-build", flags: { actor: "claude", commit: String(cycle).repeat(40), evidence: "attempt" } });
    applyTransition({ task, taskState: state, config, action: "verify-fail", flags: { actor: config.defaultRoles.verifier, evidence: `failure ${cycle}` } });
  }
  assert.equal(state.status, "blocked");
  assert.equal(state.repairCycles, 3);
});

test("prompt includes ownership and acceptance criteria", () => {
  const { task, state } = fixture();
  const prompt = renderPrompt(task, state, "builder", "claude", config);
  assert.match(prompt, /Owned paths:/);
  assert.match(prompt, /Acceptance criteria:/);
  assert.match(prompt, /Global verification:/);
  assert.match(prompt, /Protected inputs/);
  assert.match(prompt, /Do not merge/);
});

test("prompt rejects an unknown role", () => {
  const { task, state } = fixture();
  assert.throws(() => renderPrompt(task, state, "owner", "someone", config), /role must be/);
});

test("a premature completed audit can be invalidated back to rework", () => {
  const { task, state } = fixture();
  state.status = "done";
  state.builderActor = "claude";
  state.auditorActor = "codex";
  applyTransition({
    task,
    taskState: state,
    config,
    action: "invalidate-audit",
    flags: { actor: "codex-controller", evidence: "independent audit contradicted the recorded pass" },
  });
  assert.equal(state.status, "rework");
  assert.equal(state.repairCycles, 1);
  assert.equal(state.auditorActor, null);
});

test("nested owned and read-only paths are rejected", () => {
  assert.equal(pathsOverlap("web/lib/", "web/lib/contracts.ts"), true);
  const copy = structuredClone(definitions);
  copy.tasks[0].ownedPaths = ["web/lib/"];
  copy.tasks[0].readOnlyPaths = ["web/lib/contracts.ts"];
  assert.match(validateDefinitions(config, copy).join("\n"), /overlaps read-only/);
});

test("only the configured deterministic verifier can advance verification", () => {
  const { task, state } = fixture();
  applyTransition({ task, taskState: state, config, action: "claim-builder", flags: { actor: "claude" } });
  applyTransition({ task, taskState: state, config, action: "submit-build", flags: { actor: "claude", commit: "a".repeat(40), evidence: "checks" } });
  assert.throws(
    () => applyTransition({ task, taskState: state, config, action: "verify-pass", flags: { actor: "claude", evidence: "self verified" } }),
    /configured deterministic verifier/,
  );
});

test("submitted commits resolve only from the exact existing agent branch tip", async () => {
  assert.match(await resolveCommit("HEAD", "agent/GRAPH-001-codex", "agent/GRAPH-001-codex"), /^[0-9a-f]{40}$/);
  await assert.rejects(
    () => resolveCommit("HEAD", "HEAD", "agent/GRAPH-001-codex"),
    /must be exactly agent\/GRAPH-001-codex/,
  );
  await assert.rejects(
    () => resolveCommit("abcdef1", "agent/GRAPH-001-codex", "agent/GRAPH-001-codex"),
    /existing Git objects/,
  );
});

test("absolute and traversal task paths are rejected", () => {
  const copy = structuredClone(definitions);
  copy.tasks[0].ownedPaths = ["../Bible-Brain/"];
  copy.tasks[1].ownedPaths = ["C:/outside/repo"];
  copy.tasks[2].ownedPaths = ["./"];
  copy.tasks[3].ownedPaths = ["."];
  const errors = validateDefinitions(config, copy).join("\n");
  assert.match(errors, /path traversal is forbidden/);
  assert.match(errors, /path must be repository-relative/);
  assert.equal((errors.match(/repository-root ownership is forbidden/g) ?? []).length, 2);
});

test("ledger locking rejects a concurrent writer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "scarlet-graph-"));
  const ledgerPath = path.join(directory, "ledger.json");
  let release;
  const first = withLedgerLock(ledgerPath, () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(() => withLedgerLock(ledgerPath, async () => {}), /locked by another controller/);
  release();
  await first;
  await rm(directory, { recursive: true, force: true });
});
