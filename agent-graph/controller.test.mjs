import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyTransition,
  assertChangedPathsAllowed,
  assertDefinitionIntegrity,
  initialState,
  inspectCommitRange,
  parseNameStatus,
  pathsOverlap,
  renderPrompt,
  resolveClaim,
  resolveCommit,
  validateDefinitions,
  validateSubmission,
  withLedgerLock,
} from "./controller.mjs";
import config from "./graph.config.json" with { type: "json" };
import definitions from "./tasks.json" with { type: "json" };

const BASE = "a".repeat(40);
const MID = "b".repeat(40);
const TIP = "c".repeat(40);
const OTHER = "d".repeat(40);

function fixture(taskId = "DOC-001", customDefinitions = definitions) {
  const state = initialState(config, customDefinitions);
  const task = customDefinitions.tasks.find((candidate) => candidate.id === taskId);
  return { task, taskState: state.tasks[task.id], state, definitions: customDefinitions };
}

function transition(context, action, flags) {
  return applyTransition({
    task: context.task,
    taskState: context.taskState,
    state: context.state,
    definitions: context.definitions,
    config,
    action,
    flags,
  });
}

function claim(context, actor = "claude") {
  return transition(context, "claim-builder", {
    actor,
    base: BASE,
    branch: "agent/" + context.task.id + "-" + actor,
  });
}

function rangeGit(options = {}) {
  return async (_command, args) => {
    if (args[0] === "rev-parse") return { stdout: (options.resolvedTip ?? TIP) + "\n" };
    if (args[0] === "show-ref") return { stdout: (options.branchTip ?? TIP) + "\n" };
    if (args[0] === "merge-base") {
      if (options.ancestor === false) throw new Error("not an ancestor");
      return { stdout: "" };
    }
    if (args[0] === "rev-list" && args[1] === "--merges") {
      return { stdout: options.merges ? options.merges + "\n" : "" };
    }
    if (args[0] === "rev-list" && args[1] === "--reverse") {
      return { stdout: (options.commits ?? [TIP]).join("\n") + "\n" };
    }
    if (args[0] === "diff-tree") {
      return { stdout: options.changes?.[args.at(-1)] ?? "M\0BUILD_PLAN.md\0" };
    }
    throw new Error("unexpected git command: " + args.join(" "));
  };
}

test("tracked graph definitions are valid and encode ordering and the correct P0 gates", () => {
  assert.deepEqual(validateDefinitions(config, definitions), []);
  assert.deepEqual(definitions.tasks.find((task) => task.id === "DOC-002").dependsOn, ["DOC-001"]);
  assert.deepEqual(definitions.tasks.find((task) => task.id === "OPS-001").dependsOn, ["AUD-001"]);
  const p0 = definitions.tasks.find((task) => task.id === "P0-001");
  assert.deepEqual(p0.humanGates, []);
  assert.equal(p0.ownedPaths.some((ownedPath) => ownedPath.endsWith("/")), false);
  assert.deepEqual(
    p0.ownedPaths.filter((ownedPath) => ownedPath.startsWith("web/app/api/")),
    [
      "web/app/api/entries/route.ts",
      "web/app/api/entries/[id]/route.ts",
      "web/app/api/sync/pull/route.ts",
      "web/app/api/sync/push/route.ts",
    ],
  );
});

test("initial state binds every task to the reviewed definition and graph config", () => {
  const state = initialState(config, definitions);
  assert.equal(state.schemaVersion, 2);
  assert.match(state.tasks["DOC-001"].definitionDigest, /^[0-9a-f]{64}$/);
  assert.equal(state.tasks["DOC-001"].baseSha, null);
  assert.equal(state.tasks["DOC-001"].expectedBranch, null);
  assert.equal(state.tasks["DOC-001"].submittedTipSha, null);
});

test("definition or configuration drift fails closed", () => {
  const ledger = { schemaVersion: 2, state: initialState(config, definitions), receipts: [] };
  assert.doesNotThrow(() => assertDefinitionIntegrity(config, definitions, structuredClone(ledger)));

  const changedDefinitions = structuredClone(definitions);
  changedDefinitions.tasks[0].objective += " changed";
  assert.throws(
    () => assertDefinitionIntegrity(config, changedDefinitions, structuredClone(ledger)),
    /definition or graph configuration changed/,
  );

  const changedConfig = structuredClone(config);
  changedConfig.maxRepairCycles += 1;
  assert.throws(
    () => assertDefinitionIntegrity(changedConfig, definitions, structuredClone(ledger)),
    /definition or graph configuration changed/,
  );
});

test("legacy ledgers fail closed and require an explicit reviewed reset", () => {
  const ledger = { schemaVersion: 1, state: { schemaVersion: 1, tasks: {} }, receipts: [] };
  assert.throws(
    () => assertDefinitionIntegrity(config, definitions, ledger),
    /ledger schema mismatch.*explicitly reviewed reset/,
  );
});

test("dependency cycles and controller ownership are rejected", () => {
  const cyclic = structuredClone(definitions);
  cyclic.tasks.find((task) => task.id === "DOC-001").dependsOn = ["DOC-002"];
  assert.match(validateDefinitions(config, cyclic).join("\n"), /dependency cycle/);

  const controllerOwner = structuredClone(definitions);
  controllerOwner.tasks[0].ownedPaths = ["agent-graph/controller.mjs"];
  assert.match(validateDefinitions(config, controllerOwner).join("\n"), /protected path|controller path/);
});

test("a task cannot start until dependencies are done", () => {
  const context = fixture("DOC-002");
  assert.throws(() => claim(context), /waiting for dependency DOC-001/);
  context.state.tasks["DOC-001"].status = "done";
  claim(context);
  assert.equal(context.taskState.status, "building");
});

test("overlapping active path ownership is locked", () => {
  for (const reservedStatus of ["building", "rework", "human_gate"]) {
    const customDefinitions = structuredClone(definitions);
    const doc2 = customDefinitions.tasks.find((task) => task.id === "DOC-002");
    doc2.dependsOn = [];
    const context = fixture("DOC-002", customDefinitions);
    context.state.tasks["DOC-001"].status = reservedStatus;
    assert.throws(() => claim(context), /overlaps paths reserved by DOC-001/);
  }
});

test("builder claim captures base, exact branch, definition digest, and submitted tip", () => {
  const context = fixture();
  claim(context);
  assert.equal(context.taskState.baseSha, BASE);
  assert.equal(context.taskState.expectedBranch, "agent/DOC-001-claude");
  assert.match(context.taskState.definitionDigest, /^[0-9a-f]{64}$/);

  const receipt = transition(context, "submit-build", {
    actor: "claude",
    commit: TIP,
    evidence: "checks",
  });
  assert.equal(context.taskState.submittedTipSha, TIP);
  assert.equal(receipt.baseSha, BASE);
  assert.equal(receipt.expectedBranch, "agent/DOC-001-claude");
  assert.equal(receipt.submittedTipSha, TIP);
});

test("builder cannot audit its own commit", () => {
  const context = fixture();
  claim(context);
  transition(context, "submit-build", { actor: "claude", commit: TIP, evidence: "checks" });
  transition(context, "verify-pass", { actor: config.defaultRoles.verifier, evidence: "tests pass" });
  assert.throws(
    () => transition(context, "claim-auditor", { actor: "claude" }),
    /different actors/,
  );
});

test("ungated audited work completes", () => {
  const context = fixture();
  claim(context);
  transition(context, "submit-build", { actor: "claude", commit: TIP, evidence: "checks" });
  transition(context, "verify-pass", { actor: config.defaultRoles.verifier, evidence: "tests pass" });
  transition(context, "claim-auditor", { actor: "codex" });
  transition(context, "audit-pass", { actor: "codex", evidence: "criteria pass" });
  assert.equal(context.taskState.status, "done");
});

test("evidence-only operational work uses no fake commit and keeps duties separate", () => {
  const context = fixture("OPS-001");
  context.state.tasks["AUD-001"].status = "done";
  assert.throws(() => claim(context), /evidence-only/);

  transition(context, "submit-operational", { actor: "ops", evidence: "deployment receipts" });
  assert.equal(context.taskState.status, "awaiting_verification");
  assert.equal(context.taskState.operatorActor, "ops");
  assert.equal(context.taskState.submittedTipSha, null);

  transition(context, "verify-pass", { actor: config.defaultRoles.verifier, evidence: "receipts checked" });
  assert.throws(() => transition(context, "claim-auditor", { actor: "ops" }), /different actors/);
  transition(context, "claim-auditor", { actor: "codex" });
  transition(context, "audit-pass", { actor: "codex", evidence: "audit" });
  assert.equal(context.taskState.status, "human_gate");
  assert.throws(
    () => transition(context, "approve", { actor: "ops", evidence: "self approval" }),
    /independent/,
  );
  transition(context, "approve", { actor: "ken", evidence: "approved deployment receipt" });
  assert.equal(context.taskState.status, "done");
});

test("repository-owning work cannot use the operational shortcut", () => {
  const context = fixture();
  assert.throws(
    () => transition(context, "submit-operational", { actor: "claude", evidence: "claim" }),
    /must use the builder flow/,
  );
});

test("three failed repair cycles block instead of looping forever", () => {
  const context = fixture();
  for (let cycle = 1; cycle <= config.maxRepairCycles; cycle += 1) {
    claim(context);
    transition(context, "submit-build", { actor: "claude", commit: String(cycle).repeat(40), evidence: "attempt" });
    transition(context, "verify-fail", {
      actor: config.defaultRoles.verifier,
      evidence: "failure " + cycle,
    });
  }
  assert.equal(context.taskState.status, "blocked");
  assert.equal(context.taskState.repairCycles, 3);
});

test("invalidating an audit does not consume a repair cycle", () => {
  const context = fixture();
  context.taskState.status = "done";
  context.taskState.builderActor = "claude";
  context.taskState.auditorActor = "codex";
  context.taskState.repairCycles = 2;
  transition(context, "invalidate-audit", {
    actor: "codex-controller",
    evidence: "independent audit contradicted the recorded pass",
  });
  assert.equal(context.taskState.status, "rework");
  assert.equal(context.taskState.repairCycles, 2);
  assert.equal(context.taskState.auditorActor, null);
});

test("prompts expose immutable review bindings and advisory boundaries", () => {
  const context = fixture();
  const prompt = renderPrompt(context.task, context.taskState, "builder", "claude", config);
  assert.match(prompt, /Definition digest:/);
  assert.match(prompt, /Claimed base:/);
  assert.match(prompt, /Expected branch:/);
  assert.match(prompt, /Submitted tip:/);
  assert.match(prompt, /Protected inputs/);
  assert.match(prompt, /Do not merge/);

  const ops = fixture("OPS-001");
  const operatorPrompt = renderPrompt(ops.task, ops.taskState, "operator", "ops", config);
  assert.match(operatorPrompt, /do not create or submit a repository commit/i);
  assert.match(operatorPrompt, /Do not treat.*authorization/i);
});

test("prompt rejects an unknown role", () => {
  const context = fixture();
  assert.throws(
    () => renderPrompt(context.task, context.taskState, "owner", "someone", config),
    /role must be/,
  );
});

test("nested owned and read-only paths are rejected", () => {
  assert.equal(pathsOverlap("web/lib/", "web/lib/contracts.ts"), true);
  assert.equal(pathsOverlap("BUILD_PLAN.md", "BUILD_PLAN.md/unexpected"), false);
  const copy = structuredClone(definitions);
  copy.tasks[0].ownedPaths = ["web/lib/"];
  copy.tasks[0].readOnlyPaths = ["web/lib/contracts.ts"];
  assert.match(validateDefinitions(config, copy).join("\n"), /overlaps read-only/);
});

test("absolute, traversal, and repository-root task paths are rejected", () => {
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

test("only the configured deterministic verifier can advance verification", () => {
  const context = fixture();
  claim(context);
  transition(context, "submit-build", { actor: "claude", commit: TIP, evidence: "checks" });
  assert.throws(
    () => transition(context, "verify-pass", { actor: "claude", evidence: "self verified" }),
    /configured deterministic verifier/,
  );
});

test("commit resolution is hermetic and rejects a mismatched branch tip", async () => {
  assert.equal(
    await resolveCommit(TIP, "agent/DOC-001-claude", "agent/DOC-001-claude", rangeGit()),
    TIP,
  );
  await assert.rejects(
    () => resolveCommit(TIP, "wrong", "agent/DOC-001-claude", rangeGit()),
    /must be exactly/,
  );
  await assert.rejects(
    () => resolveCommit("abcdef1", "agent/DOC-001-claude", "agent/DOC-001-claude", rangeGit()),
    /full 40-character/,
  );
  await assert.rejects(
    () => resolveCommit(TIP, "agent/DOC-001-claude", "agent/DOC-001-claude", rangeGit({ branchTip: OTHER })),
    /is not the tip/,
  );
});

test("claim resolution requires the exact branch to start at the exact base", async () => {
  const claimGit = async (_command, args) => {
    if (args[0] === "rev-parse" || args[0] === "show-ref") return { stdout: BASE + "\n" };
    throw new Error("unexpected git command");
  };
  assert.deepEqual(
    await resolveClaim(BASE, "agent/DOC-001-claude", "agent/DOC-001-claude", claimGit),
    { baseSha: BASE, expectedBranch: "agent/DOC-001-claude" },
  );
  await assert.rejects(
    () => resolveClaim(
      BASE,
      "agent/DOC-001-claude",
      "agent/DOC-001-claude",
      rangeGit({ resolvedTip: BASE, branchTip: TIP }),
    ),
    /must point at claimed base/,
  );
});

test("name-status parsing preserves both rename sides", () => {
  assert.deepEqual(parseNameStatus("R100\0old/name.ts\0new/name.ts\0", TIP), [
    { commitSha: TIP, status: "R100", paths: ["old/name.ts", "new/name.ts"] },
  ]);
});

test("a valid full-range owned-path submission passes", async () => {
  const context = fixture();
  claim(context);
  const result = await validateSubmission(
    context.task,
    context.taskState,
    config,
    TIP,
    "agent/DOC-001-claude",
    rangeGit(),
  );
  assert.deepEqual(result.commits, [TIP]);
  assert.equal(result.tipSha, TIP);
});

test("full-range inspection catches an out-of-scope change later reverted", async () => {
  const context = fixture();
  claim(context);
  const git = rangeGit({
    commits: [MID, TIP],
    changes: {
      [MID]: "M\0web/app/page.tsx\0",
      [TIP]: "M\0BUILD_PLAN.md\0",
    },
  });
  await assert.rejects(
    () => validateSubmission(context.task, context.taskState, config, TIP, "agent/DOC-001-claude", git),
    /out-of-scope path web\/app\/page.tsx/,
  );
});

test("both old and new rename paths must be owned", async () => {
  for (const rename of [
    "R100\0CODEX_AUDIT.md\0BUILD_PLAN.md\0",
    "R100\0BUILD_PLAN.md\0CODEX_AUDIT.md\0",
  ]) {
    const context = fixture();
    claim(context);
    await assert.rejects(
      () => validateSubmission(
        context.task,
        context.taskState,
        config,
        TIP,
        "agent/DOC-001-claude",
        rangeGit({ changes: { [TIP]: rename } }),
      ),
      /read-only path CODEX_AUDIT.md/,
    );
  }
});

test("read-only, secret basename, and control-plane changes fail closed", () => {
  const task = definitions.tasks.find((candidate) => candidate.id === "DOC-001");
  for (const [changedPath, pattern] of [
    ["web/lib/contracts.ts", /read-only path/],
    ["BUILD_PLAN.md/unexpected", /out-of-scope path/],
    ["web/.env.preview", /protected path/],
    ["web/AGENTS.md", /protected path/],
    ["agent-graph/tasks.json", /protected path|controller path/],
  ]) {
    assert.throws(
      () => assertChangedPathsAllowed(task, config, [{ commitSha: TIP, status: "M", paths: [changedPath] }]),
      pattern,
    );
  }
});

test("merge commits and non-descendant tips fail closed", async () => {
  await assert.rejects(
    () => inspectCommitRange(BASE, TIP, rangeGit({ merges: MID })),
    /contains merge commits/,
  );
  await assert.rejects(
    () => inspectCommitRange(BASE, TIP, rangeGit({ ancestor: false })),
    /not descended from claimed base/,
  );
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
