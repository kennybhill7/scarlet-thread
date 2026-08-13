#!/usr/bin/env node

import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(SCRIPT_DIR, "graph.config.json");
const TASKS_PATH = path.join(SCRIPT_DIR, "tasks.json");
const LEDGER_PATH = path.join(SCRIPT_DIR, "ledger.local.json");
const execFileAsync = promisify(execFile);

const VALID_STATUSES = new Set([
  "ready",
  "building",
  "awaiting_verification",
  "awaiting_audit",
  "auditing",
  "rework",
  "human_gate",
  "done",
  "blocked",
]);

const ACTIVE_STATUSES = new Set([
  "building",
  "awaiting_verification",
  "awaiting_audit",
  "auditing",
]);

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function validateDefinitions(config, definitions) {
  const errors = [];
  if (config.schemaVersion !== 1) errors.push("graph.config.json schemaVersion must be 1");
  if (!Number.isInteger(config.maxRepairCycles) || config.maxRepairCycles < 1) {
    errors.push("maxRepairCycles must be a positive integer");
  }
  if (!Array.isArray(config.humanGateCategories)) errors.push("humanGateCategories must be an array");
  if (definitions.schemaVersion !== 1) errors.push("tasks.json schemaVersion must be 1");
  if (!Array.isArray(definitions.tasks) || definitions.tasks.length === 0) {
    errors.push("tasks.json must contain at least one task");
    return errors;
  }

  const ids = new Set();
  const gateSet = new Set(config.humanGateCategories ?? []);
  for (const protectedPath of config.protectedPaths ?? []) {
    const pathError = repoPathError(protectedPath);
    if (pathError) errors.push(`invalid protected path ${protectedPath}: ${pathError}`);
  }
  for (const task of definitions.tasks) {
    if (!task.id || !/^[A-Z][A-Z0-9]*-\d{3}$/.test(task.id)) {
      errors.push(`invalid task id: ${task.id ?? "<missing>"}`);
    } else if (ids.has(task.id)) {
      errors.push(`duplicate task id: ${task.id}`);
    }
    ids.add(task.id);
    for (const key of ["title", "objective"]) {
      if (typeof task[key] !== "string" || task[key].trim() === "") {
        errors.push(`${task.id ?? "<missing>"}.${key} must be non-empty`);
      }
    }
    for (const key of ["ownedPaths", "readOnlyPaths", "acceptanceCriteria", "verification", "humanGates"]) {
      if (!Array.isArray(task[key])) errors.push(`${task.id ?? "<missing>"}.${key} must be an array`);
    }
    for (const key of ["ownedPaths", "readOnlyPaths"]) {
      for (const taskPath of task[key] ?? []) {
        const pathError = repoPathError(taskPath);
        if (pathError) errors.push(`${task.id ?? "<missing>"}.${key} has invalid path ${taskPath}: ${pathError}`);
      }
    }
    if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
      errors.push(`${task.id ?? "<missing>"} must have acceptance criteria`);
    }
    if (!Array.isArray(task.verification) || task.verification.length === 0) {
      errors.push(`${task.id ?? "<missing>"} must have verification evidence`);
    }
    for (const gate of task.humanGates ?? []) {
      if (!gateSet.has(gate)) errors.push(`${task.id ?? "<missing>"} uses unknown human gate: ${gate}`);
    }
    for (const ownedPath of task.ownedPaths ?? []) {
      for (const readOnlyPath of task.readOnlyPaths ?? []) {
        if (pathsOverlap(ownedPath, readOnlyPath)) {
          errors.push(`${task.id ?? "<missing>"} path ownership overlaps read-only path: ${ownedPath} <> ${readOnlyPath}`);
        }
      }
      for (const protectedPath of config.protectedPaths ?? []) {
        if (pathsOverlap(ownedPath, protectedPath)) {
          errors.push(`${task.id ?? "<missing>"} path ownership overlaps protected path: ${ownedPath} <> ${protectedPath}`);
        }
      }
    }
  }
  return errors;
}

function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
}

function repoPathError(value) {
  if (typeof value !== "string" || value.trim() === "") return "path must be a non-empty string";
  const normalized = value.replaceAll("\\", "/");
  if (/^(?:[a-z]:\/|\/)/i.test(normalized)) return "path must be repository-relative";
  if (normalized.split("/").includes("..")) return "path traversal is forbidden";
  if (normalizeRepoPath(normalized) === "" || normalizeRepoPath(normalized) === ".") {
    return "repository-root ownership is forbidden";
  }
  return null;
}

function pathsOverlap(left, right) {
  const a = normalizeRepoPath(left);
  const b = normalizeRepoPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function initialState(definitions) {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    tasks: Object.fromEntries(
      definitions.tasks.map((task) => [
        task.id,
        {
          status: "ready",
          repairCycles: 0,
          builderActor: null,
          auditorActor: null,
          commitSha: null,
          lastEvidence: null,
        },
      ]),
    ),
  };
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function withLedgerLock(ledgerPath, operation) {
  const lockPath = `${ledgerPath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") fail(`graph ledger is locked by another controller: ${lockPath}`);
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function loadGraph(options = {}) {
  const configPath = options.configPath ?? CONFIG_PATH;
  const tasksPath = options.tasksPath ?? TASKS_PATH;
  const ledgerPath = options.ledgerPath ?? LEDGER_PATH;
  const config = await readJson(configPath);
  const definitions = await readJson(tasksPath);
  const errors = validateDefinitions(config, definitions);
  if (errors.length) fail(errors.join("\n"));

  let ledger;
  if (existsSync(ledgerPath)) {
    ledger = await readJson(ledgerPath);
  } else {
    ledger = { schemaVersion: 1, state: initialState(definitions), receipts: [] };
    await writeJsonAtomic(ledgerPath, ledger);
  }

  const state = ledger.state;

  for (const task of definitions.tasks) {
    state.tasks[task.id] ??= initialState({ tasks: [task] }).tasks[task.id];
  }
  for (const [id, taskState] of Object.entries(state.tasks)) {
    if (!definitions.tasks.some((task) => task.id === id)) fail(`state contains unknown task: ${id}`);
    if (!VALID_STATUSES.has(taskState.status)) fail(`${id} has invalid status: ${taskState.status}`);
  }
  if (!Array.isArray(ledger.receipts)) fail("ledger receipts must be an array");
  return { config, definitions, state, ledger, ledgerPath };
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function requireActor(flags) {
  const actor = flags.actor?.trim();
  if (!actor) fail("--actor is required");
  return actor;
}

function requireEvidence(flags) {
  const evidence = flags.evidence?.trim();
  if (!evidence) fail("--evidence is required");
  return evidence;
}

function requireCommit(flags) {
  const commit = flags.commit?.trim();
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) fail("--commit must resolve to a full 40-character git commit SHA");
  return commit.toLowerCase();
}

async function resolveCommit(commit, branch, expectedBranch) {
  if (!commit?.trim()) fail("--commit is required");
  if (!branch?.trim()) fail("--branch is required so the submitted SHA can be checked against its branch tip");
  if (branch.trim() !== expectedBranch) fail(`--branch must be exactly ${expectedBranch}`);
  let resolved;
  let branchTip;
  try {
    ({ stdout: resolved } = await execFileAsync("git", ["rev-parse", "--verify", `${commit.trim()}^{commit}`]));
    ({ stdout: branchTip } = await execFileAsync("git", ["show-ref", "--verify", "--hash", `refs/heads/${branch.trim()}`]));
  } catch {
    fail("--commit and --branch must name existing Git objects");
  }
  resolved = resolved.trim().toLowerCase();
  branchTip = branchTip.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(resolved)) fail("Git did not resolve the submitted commit to a full object ID");
  if (resolved !== branchTip) fail(`submitted commit ${resolved} is not the tip of ${branch}`);
  return resolved;
}

function taskById(definitions, id) {
  const task = definitions.tasks.find((candidate) => candidate.id === id);
  if (!task) fail(`unknown task: ${id}`);
  return task;
}

function assertStatus(taskState, allowed, action) {
  if (!allowed.includes(taskState.status)) {
    fail(`${action} requires ${allowed.join(" or ")}; current status is ${taskState.status}`);
  }
}

function sendToRework(taskState, config, evidence) {
  taskState.repairCycles += 1;
  taskState.lastEvidence = evidence;
  taskState.auditorActor = null;
  if (taskState.repairCycles >= config.maxRepairCycles) {
    taskState.status = "blocked";
  } else {
    taskState.status = "rework";
  }
}

export function applyTransition({ task, taskState, config, action, flags }) {
  const before = taskState.status;
  const actor = requireActor(flags);
  let evidence = flags.evidence?.trim() || null;

  switch (action) {
    case "claim-builder":
      assertStatus(taskState, ["ready", "rework"], action);
      taskState.status = "building";
      taskState.builderActor = actor;
      taskState.auditorActor = null;
      taskState.commitSha = null;
      break;
    case "submit-build":
      assertStatus(taskState, ["building"], action);
      if (actor !== taskState.builderActor) fail("only the assigned builder may submit the build");
      taskState.commitSha = requireCommit(flags);
      evidence = requireEvidence(flags);
      taskState.lastEvidence = evidence;
      taskState.status = "awaiting_verification";
      break;
    case "verify-pass":
      assertStatus(taskState, ["awaiting_verification"], action);
      if (actor !== config.defaultRoles?.verifier) fail("only the configured deterministic verifier may pass verification");
      evidence = requireEvidence(flags);
      taskState.lastEvidence = evidence;
      taskState.status = "awaiting_audit";
      break;
    case "verify-fail":
      assertStatus(taskState, ["awaiting_verification"], action);
      if (actor !== config.defaultRoles?.verifier) fail("only the configured deterministic verifier may fail verification");
      evidence = requireEvidence(flags);
      sendToRework(taskState, config, evidence);
      break;
    case "claim-auditor":
      assertStatus(taskState, ["awaiting_audit"], action);
      if (actor === taskState.builderActor) fail("builder and auditor must be different actors");
      taskState.auditorActor = actor;
      taskState.status = "auditing";
      break;
    case "audit-pass":
      assertStatus(taskState, ["auditing"], action);
      if (actor !== taskState.auditorActor) fail("only the assigned auditor may pass the audit");
      evidence = requireEvidence(flags);
      taskState.lastEvidence = evidence;
      taskState.status = task.humanGates.length > 0 ? "human_gate" : "done";
      break;
    case "audit-fail":
      assertStatus(taskState, ["auditing"], action);
      if (actor !== taskState.auditorActor) fail("only the assigned auditor may fail the audit");
      evidence = requireEvidence(flags);
      sendToRework(taskState, config, evidence);
      break;
    case "approve":
      assertStatus(taskState, ["human_gate"], action);
      if (actor === taskState.builderActor || actor === taskState.auditorActor) {
        fail("human approval must be independent of builder and auditor identities");
      }
      evidence = requireEvidence(flags);
      taskState.lastEvidence = evidence;
      taskState.status = "done";
      break;
    case "block":
      if (!ACTIVE_STATUSES.has(taskState.status) && !["ready", "rework", "human_gate"].includes(taskState.status)) {
        fail(`block is not allowed from ${taskState.status}`);
      }
      evidence = requireEvidence(flags);
      taskState.lastEvidence = evidence;
      taskState.status = "blocked";
      break;
    case "invalidate-audit":
      assertStatus(taskState, ["auditing", "human_gate", "done"], action);
      evidence = requireEvidence(flags);
      sendToRework(taskState, config, evidence);
      break;
    default:
      fail(`unknown transition: ${action}`);
  }

  return {
    timestamp: new Date().toISOString(),
    taskId: task.id,
    action,
    actor,
    from: before,
    to: taskState.status,
    commitSha: taskState.commitSha,
    evidence,
    repairCycles: taskState.repairCycles,
  };
}

function eligibleForRole(status, role) {
  if (role === "builder") return status === "ready" || status === "rework";
  if (role === "auditor") return status === "awaiting_audit";
  if (role === "human") return status === "human_gate";
  fail("role must be builder, auditor, or human");
}

function renderPrompt(task, taskState, role, actor, config = { globalVerification: [], protectedPaths: [] }) {
  if (!["builder", "auditor", "human"].includes(role)) fail("role must be builder, auditor, or human");
  const common = [
    `Task: ${task.id} -- ${task.title}`,
    `Actor: ${actor}`,
    `Role: ${role}`,
    `Current state: ${taskState.status}`,
    `Immutable review commit: ${taskState.commitSha ?? "not created yet"}`,
    ...(taskState.lastEvidence ? [`Last evidence or repair request: ${taskState.lastEvidence}`] : []),
    "",
    "Objective:",
    task.objective,
    "",
    `Owned paths: ${task.ownedPaths.length ? task.ownedPaths.join(", ") : "none (operational task)"}`,
    `Read-only paths: ${task.readOnlyPaths.length ? task.readOnlyPaths.join(", ") : "none"}`,
    "",
    "Acceptance criteria:",
    ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Verification evidence required:",
    ...task.verification.map((check) => `- ${check}`),
    ...(config.globalVerification?.length
      ? ["", "Global verification:", ...config.globalVerification.map((check) => `- ${check}`)]
      : []),
    ...(config.protectedPaths?.length
      ? ["", `Protected inputs (never edit or attach): ${config.protectedPaths.join(", ")}`]
      : []),
    "",
  ];

  if (role === "builder") {
    common.push(
      "Work only in the owned paths. Preserve unrelated user changes. Do not commit secrets or personal vault data.",
      "Run the listed checks, commit the bounded change on an agent branch, and report the exact SHA and evidence.",
      "Do not merge, deploy, migrate production data, or claim a human-gated decision.",
    );
  } else if (role === "auditor") {
    common.push(
      "Audit the exact immutable commit independently. Inspect the diff and rerun relevant checks; do not trust the builder summary.",
      "Return PASS only if every acceptance criterion is evidenced. Otherwise return FAIL with file/line receipts and the smallest repair request.",
      "Do not edit the builder branch, merge, deploy, or approve a human gate.",
    );
  } else {
    common.push(
      `Human gates: ${task.humanGates.join(", ") || "none"}`,
      "Review the evidence and record an explicit decision. Approval is never inferred from silence.",
    );
  }
  return common.join("\n");
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "help") {
    console.log("Commands: validate | list | next <builder|auditor|human> | prompt <task-id> <role> [actor] | transition <task-id> <action> --actor <name> [--commit <sha> --branch <branch>] [--evidence <text>] | reset --actor <human> --evidence <reason>. Shared-local actor labels are advisory; only the primary orchestrator may record audit/approval transitions.");
    return;
  }

  if (command === "validate") {
    const { definitions } = await loadGraph();
    console.log(`Valid graph: ${definitions.tasks.length} tasks`);
    return;
  }

  if (command === "reset") {
    const flags = parseFlags(args);
    const actor = requireActor(flags);
    const evidence = requireEvidence(flags);
    await withLedgerLock(LEDGER_PATH, async () => {
      const { definitions, ledgerPath } = await loadGraph();
      const receipt = { timestamp: new Date().toISOString(), action: "reset", actor, evidence };
      await writeJsonAtomic(ledgerPath, {
        schemaVersion: 1,
        state: initialState(definitions),
        receipts: [receipt],
      });
    });
    console.log("Local graph state reset");
    return;
  }

  if (command === "transition") {
    const [id, action, ...flagArgs] = args;
    if (!id || !action) fail("transition requires <task-id> <action>");
    const flags = parseFlags(flagArgs);
    if (action === "submit-build") {
      const actor = requireActor(flags);
      flags.commit = await resolveCommit(flags.commit, flags.branch, `agent/${id}-${actor}`);
    }
    await withLedgerLock(LEDGER_PATH, async () => {
      const graph = await loadGraph();
      const task = taskById(graph.definitions, id);
      const receipt = applyTransition({ task, taskState: graph.state.tasks[id], config: graph.config, action, flags });
      graph.state.updatedAt = receipt.timestamp;
      graph.ledger.state = graph.state;
      graph.ledger.receipts.push(receipt);
      await writeJsonAtomic(graph.ledgerPath, graph.ledger);
      console.log(`${id}: ${receipt.from} -> ${receipt.to}`);
    });
    return;
  }

  const graph = await loadGraph();
  if (command === "list") {
    for (const task of graph.definitions.tasks) {
      const state = graph.state.tasks[task.id];
      console.log(`${task.id}\t${state.status}\trepairs=${state.repairCycles}\t${task.title}`);
    }
    return;
  }

  if (command === "next") {
    const [role] = args;
    const nextTask = graph.definitions.tasks.find((task) => eligibleForRole(graph.state.tasks[task.id].status, role));
    console.log(nextTask ? `${nextTask.id}\t${nextTask.title}` : `No task is ready for role: ${role}`);
    return;
  }

  if (command === "prompt") {
    const [id, role, actor = graph.config.defaultRoles?.[role] ?? role] = args;
    if (!id || !role) fail("prompt requires <task-id> <builder|auditor|human> [actor]");
    const task = taskById(graph.definitions, id);
    console.log(renderPrompt(task, graph.state.tasks[id], role, actor, graph.config));
    return;
  }

  fail(`unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`agent-graph: ${error.message}`);
    process.exitCode = 1;
  });
}

export { initialState, pathsOverlap, renderPrompt, resolveCommit, validateDefinitions, withLedgerLock, writeJsonAtomic };
