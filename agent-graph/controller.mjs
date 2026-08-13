#!/usr/bin/env node

import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.dirname(SCRIPT_DIR);
const CONFIG_PATH = path.join(SCRIPT_DIR, "graph.config.json");
const TASKS_PATH = path.join(SCRIPT_DIR, "tasks.json");
const LEDGER_PATH = path.join(SCRIPT_DIR, "ledger.local.json");
const execFileAsync = promisify(execFile);
const LEDGER_SCHEMA_VERSION = 2;
const CONTROL_PLANE_PATHS = ["agent-graph/"];

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

const PATH_RESERVED_STATUSES = new Set([
  ...ACTIVE_STATUSES,
  "rework",
  "human_gate",
]);

async function runGit(_command, args) {
  return execFileAsync("git", args, {
    cwd: REPOSITORY_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sortForDigest(value) {
  if (Array.isArray(value)) return value.map(sortForDigest);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForDigest(value[key])]),
    );
  }
  return value;
}

function definitionDigest(config, task) {
  const canonical = JSON.stringify(sortForDigest({ config, task }));
  return createHash("sha256").update(canonical).digest("hex");
}

async function loadDefinitions(options = {}) {
  const config = await readJson(options.configPath ?? CONFIG_PATH);
  const definitions = await readJson(options.tasksPath ?? TASKS_PATH);
  const errors = validateDefinitions(config, definitions);
  if (errors.length) fail(errors.join("\n"));
  return { config, definitions };
}

function validateDefinitions(config, definitions) {
  const errors = [];
  if (config.schemaVersion !== 1) errors.push("graph.config.json schemaVersion must be 1");
  if (!Number.isInteger(config.maxRepairCycles) || config.maxRepairCycles < 1) {
    errors.push("maxRepairCycles must be a positive integer");
  }
  if (!Array.isArray(config.humanGateCategories)) errors.push("humanGateCategories must be an array");
  if (!Array.isArray(config.protectedPaths)) errors.push("protectedPaths must be an array");
  if (!Array.isArray(config.protectedBasenamePrefixes)) errors.push("protectedBasenamePrefixes must be an array");
  for (const prefix of config.protectedBasenamePrefixes ?? []) {
    if (typeof prefix !== "string" || prefix.trim() === "" || prefix.includes("/") || prefix.includes("\\")) {
      errors.push(`invalid protected basename prefix: ${prefix}`);
    }
  }
  if (definitions.schemaVersion !== 1) errors.push("tasks.json schemaVersion must be 1");
  if (!Array.isArray(definitions.tasks) || definitions.tasks.length === 0) {
    errors.push("tasks.json must contain at least one task");
    return errors;
  }

  const ids = new Set(definitions.tasks.map((task) => task.id).filter(Boolean));
  const seenIds = new Set();
  const gateSet = new Set(config.humanGateCategories ?? []);
  for (const protectedPath of config.protectedPaths ?? []) {
    const pathError = repoPathError(protectedPath);
    if (pathError) errors.push(`invalid protected path ${protectedPath}: ${pathError}`);
  }
  for (const task of definitions.tasks) {
    if (!task.id || !/^[A-Z][A-Z0-9]*-\d{3}$/.test(task.id)) {
      errors.push(`invalid task id: ${task.id ?? "<missing>"}`);
    } else if (seenIds.has(task.id)) {
      errors.push(`duplicate task id: ${task.id}`);
    }
    seenIds.add(task.id);
    for (const key of ["title", "objective"]) {
      if (typeof task[key] !== "string" || task[key].trim() === "") {
        errors.push(`${task.id ?? "<missing>"}.${key} must be non-empty`);
      }
    }
    for (const key of ["dependsOn", "ownedPaths", "readOnlyPaths", "acceptanceCriteria", "verification", "humanGates"]) {
      if (!Array.isArray(task[key])) errors.push(`${task.id ?? "<missing>"}.${key} must be an array`);
    }
    const dependencySet = new Set();
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) errors.push(`${task.id ?? "<missing>"} depends on unknown task: ${dependency}`);
      if (dependency === task.id) errors.push(`${task.id ?? "<missing>"} cannot depend on itself`);
      if (dependencySet.has(dependency)) errors.push(`${task.id ?? "<missing>"} repeats dependency: ${dependency}`);
      dependencySet.add(dependency);
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
      for (const controlPath of CONTROL_PLANE_PATHS) {
        if (pathsOverlap(ownedPath, controlPath)) {
          errors.push(`${task.id ?? "<missing>"} path ownership overlaps controller path: ${ownedPath} <> ${controlPath}`);
        }
      }
    }
  }

  const tasksById = new Map(definitions.tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`dependency cycle includes ${id}`);
      return;
    }
    if (visited.has(id) || !tasksById.has(id)) return;
    visiting.add(id);
    for (const dependency of tasksById.get(id).dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasksById.keys()) visit(id);
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
  return pathWithinScope(left, right) || pathWithinScope(right, left);
}

function initialTaskState(config, task) {
  return {
    status: "ready",
    repairCycles: 0,
    definitionDigest: definitionDigest(config, task),
    builderActor: null,
    operatorActor: null,
    auditorActor: null,
    baseSha: null,
    expectedBranch: null,
    submittedTipSha: null,
    lastEvidence: null,
  };
}

function initialState(config, definitions) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    tasks: Object.fromEntries(
      definitions.tasks.map((task) => [
        task.id,
        initialTaskState(config, task),
      ]),
    ),
  };
}

function assertDefinitionIntegrity(config, definitions, ledger) {
  if (ledger.schemaVersion !== LEDGER_SCHEMA_VERSION || ledger.state?.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    fail(`ledger schema mismatch; run an explicitly reviewed reset to create schema ${LEDGER_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(ledger.receipts)) fail("ledger receipts must be an array");
  if (!ledger.state?.tasks || typeof ledger.state.tasks !== "object") fail("ledger state tasks must be an object");

  const definitionIds = definitions.tasks.map((task) => task.id).sort();
  const stateIds = Object.keys(ledger.state.tasks).sort();
  if (JSON.stringify(definitionIds) !== JSON.stringify(stateIds)) {
    fail("task definitions changed after ledger creation; review the change and reset explicitly");
  }
  for (const task of definitions.tasks) {
    const taskState = ledger.state.tasks[task.id];
    const expectedDigest = definitionDigest(config, task);
    if (taskState.definitionDigest !== expectedDigest) {
      fail(`${task.id} definition or graph configuration changed after ledger creation; review the change and reset explicitly`);
    }
    if (!VALID_STATUSES.has(taskState.status)) fail(`${task.id} has invalid status: ${taskState.status}`);
  }
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
  const ledgerPath = options.ledgerPath ?? LEDGER_PATH;
  const { config, definitions } = await loadDefinitions(options);

  let ledger;
  if (existsSync(ledgerPath)) {
    ledger = await readJson(ledgerPath);
  } else {
    ledger = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      state: initialState(config, definitions),
      receipts: [],
    };
    if (options.persistInitial) await writeJsonAtomic(ledgerPath, ledger);
  }

  assertDefinitionIntegrity(config, definitions, ledger);
  return { config, definitions, state: ledger.state, ledger, ledgerPath };
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
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) fail("--commit must be a full 40-character git commit SHA");
  return commit.toLowerCase();
}

function requireBase(flags) {
  const base = flags.base?.trim();
  if (!base || !/^[0-9a-f]{40}$/i.test(base)) fail("--base must be a full 40-character git commit SHA");
  return base.toLowerCase();
}

async function gitOutput(gitRunner, args, errorMessage) {
  try {
    const result = await gitRunner("git", args);
    return result.stdout.trim();
  } catch {
    fail(errorMessage);
  }
}

async function resolveCommit(commit, branch, expectedBranch, gitRunner = runGit) {
  if (!commit?.trim() || !/^[0-9a-f]{40}$/i.test(commit.trim())) {
    fail("--commit must be a full 40-character git commit SHA");
  }
  if (!branch?.trim()) fail("--branch is required so the submitted SHA can be checked against its branch tip");
  if (branch.trim() !== expectedBranch) fail(`--branch must be exactly ${expectedBranch}`);
  const resolved = (await gitOutput(
    gitRunner,
    ["rev-parse", "--verify", `${commit.trim()}^{commit}`],
    "--commit must name an existing Git commit",
  )).toLowerCase();
  const branchTip = (await gitOutput(
    gitRunner,
    ["show-ref", "--verify", "--hash", `refs/heads/${branch.trim()}`],
    `--branch must name the existing local branch ${expectedBranch}`,
  )).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(resolved)) fail("Git did not resolve the submitted commit to a full object ID");
  if (resolved !== commit.trim().toLowerCase()) fail("submitted commit did not resolve to the exact full object ID supplied");
  if (resolved !== branchTip) fail(`submitted commit ${resolved} is not the tip of ${branch}`);
  return resolved;
}

async function resolveClaim(base, branch, expectedBranch, gitRunner = runGit) {
  if (!base?.trim() || !/^[0-9a-f]{40}$/i.test(base.trim())) {
    fail("--base must be a full 40-character git commit SHA");
  }
  if (branch?.trim() !== expectedBranch) fail(`--branch must be exactly ${expectedBranch}`);
  const resolvedBase = (await gitOutput(
    gitRunner,
    ["rev-parse", "--verify", `${base.trim()}^{commit}`],
    "--base must name an existing Git commit",
  )).toLowerCase();
  const branchTip = (await gitOutput(
    gitRunner,
    ["show-ref", "--verify", "--hash", `refs/heads/${expectedBranch}`],
    `--branch must name the existing local branch ${expectedBranch}`,
  )).toLowerCase();
  if (resolvedBase !== base.trim().toLowerCase()) fail("claimed base did not resolve to the exact full object ID supplied");
  if (branchTip !== resolvedBase) {
    fail(`builder branch ${expectedBranch} must point at claimed base ${resolvedBase} when claimed`);
  }
  return { baseSha: resolvedBase, expectedBranch };
}

function pathWithinScope(filePath, scopePath) {
  const file = normalizeRepoPath(filePath);
  const scope = normalizeRepoPath(scopePath);
  const directoryScope = scopePath.replaceAll("\\", "/").endsWith("/");
  return file === scope || (directoryScope && file.startsWith(`${scope}/`));
}

function parseNameStatus(output, commitSha) {
  if (!output) return [];
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[A-Z][0-9]*$/.test(status)) fail(`could not parse changed paths for commit ${commitSha}`);
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    const paths = tokens.slice(index, index + pathCount);
    if (paths.length !== pathCount || paths.some((candidate) => candidate === "")) {
      fail(`could not parse changed paths for commit ${commitSha}`);
    }
    index += pathCount;
    changes.push({ commitSha, status, paths });
  }
  return changes;
}

function assertChangedPathsAllowed(task, config, changes) {
  if (task.ownedPaths.length === 0) fail(`${task.id} is evidence-only and cannot submit a Git commit`);
  if (changes.length === 0) fail("submitted commit range contains no changed paths");

  for (const change of changes) {
    for (const changedPath of change.paths) {
      const pathError = repoPathError(changedPath);
      if (pathError) fail(`commit ${change.commitSha} contains invalid path ${changedPath}: ${pathError}`);
      const basename = normalizeRepoPath(changedPath).split("/").at(-1);
      if ((config.protectedBasenamePrefixes ?? []).some((prefix) => basename.startsWith(prefix.toLowerCase()))) {
        fail(`commit ${change.commitSha} touches protected path ${changedPath}`);
      }
      if ((config.protectedPaths ?? []).some((protectedPath) => pathWithinScope(changedPath, protectedPath))) {
        fail(`commit ${change.commitSha} touches protected path ${changedPath}`);
      }
      if (CONTROL_PLANE_PATHS.some((controlPath) => pathWithinScope(changedPath, controlPath))) {
        fail(`commit ${change.commitSha} touches controller path ${changedPath}`);
      }
      if ((task.readOnlyPaths ?? []).some((readOnlyPath) => pathWithinScope(changedPath, readOnlyPath))) {
        fail(`commit ${change.commitSha} touches read-only path ${changedPath}`);
      }
      if (!(task.ownedPaths ?? []).some((ownedPath) => pathWithinScope(changedPath, ownedPath))) {
        fail(`commit ${change.commitSha} touches out-of-scope path ${changedPath}`);
      }
    }
  }
}

async function inspectCommitRange(baseSha, tipSha, gitRunner = runGit) {
  await gitOutput(
    gitRunner,
    ["merge-base", "--is-ancestor", baseSha, tipSha],
    `submitted tip ${tipSha} is not descended from claimed base ${baseSha}`,
  );
  const merges = await gitOutput(
    gitRunner,
    ["rev-list", "--merges", `${baseSha}..${tipSha}`],
    "could not inspect submitted commit ancestry",
  );
  if (merges) fail(`submitted range contains merge commits: ${merges.split(/\s+/).join(", ")}`);
  const commitOutput = await gitOutput(
    gitRunner,
    ["rev-list", "--reverse", `${baseSha}..${tipSha}`],
    "could not enumerate submitted commit range",
  );
  const commits = commitOutput ? commitOutput.split(/\s+/) : [];
  if (commits.length === 0) fail("submitted tip must contain at least one commit after the claimed base");
  if (commits.some((commit) => !/^[0-9a-f]{40}$/i.test(commit))) fail("Git returned an invalid commit ID for the submitted range");

  const changes = [];
  for (const commit of commits) {
    const result = await gitRunner("git", [
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "-r",
      "-z",
      "-M",
      "-C",
      commit,
    ]);
    changes.push(...parseNameStatus(result.stdout, commit.toLowerCase()));
  }
  return { commits: commits.map((commit) => commit.toLowerCase()), changes };
}

async function validateSubmission(task, taskState, config, commit, branch, gitRunner = runGit) {
  if (!taskState.baseSha || !taskState.expectedBranch) fail("builder claim is missing its immutable base or branch binding");
  const tipSha = await resolveCommit(commit, branch, taskState.expectedBranch, gitRunner);
  const range = await inspectCommitRange(taskState.baseSha, tipSha, gitRunner);
  assertChangedPathsAllowed(task, config, range.changes);
  return { tipSha, ...range };
}

function taskById(definitions, id) {
  const task = definitions.tasks.find((candidate) => candidate.id === id);
  if (!task) fail(`unknown task: ${id}`);
  return task;
}

function assertDependenciesDone(task, state) {
  for (const dependency of task.dependsOn ?? []) {
    if (state.tasks[dependency]?.status !== "done") {
      fail(`${task.id} is waiting for dependency ${dependency} to reach done`);
    }
  }
}

function taskPathsOverlap(leftTask, rightTask) {
  return leftTask.ownedPaths.some((leftPath) =>
    rightTask.ownedPaths.some((rightPath) => pathsOverlap(leftPath, rightPath))
  );
}

function assertNoActivePathConflict(task, state, definitions) {
  for (const otherTask of definitions.tasks) {
    if (otherTask.id === task.id) continue;
    if (!PATH_RESERVED_STATUSES.has(state.tasks[otherTask.id]?.status)) continue;
    if (taskPathsOverlap(task, otherTask)) {
      fail(`${task.id} overlaps paths reserved by ${otherTask.id} (${state.tasks[otherTask.id].status})`);
    }
  }
}

function assertTaskCanStart(task, state, definitions) {
  assertDependenciesDone(task, state);
  assertNoActivePathConflict(task, state, definitions);
}

function assertStatus(taskState, allowed, action) {
  if (!allowed.includes(taskState.status)) {
    fail(`${action} requires ${allowed.join(" or ")}; current status is ${taskState.status}`);
  }
}

function sendToRework(taskState, config, evidence, options = {}) {
  if (options.countRepair !== false) taskState.repairCycles += 1;
  taskState.lastEvidence = evidence;
  taskState.auditorActor = null;
  if (taskState.repairCycles >= config.maxRepairCycles) {
    taskState.status = "blocked";
  } else {
    taskState.status = "rework";
  }
}

export function applyTransition({ task, taskState, state, definitions, config, action, flags }) {
  const before = taskState.status;
  const actor = requireActor(flags);
  let evidence = flags.evidence?.trim() || null;

  switch (action) {
    case "claim-builder": {
      assertStatus(taskState, ["ready", "rework"], action);
      if (task.ownedPaths.length === 0) fail(`${task.id} is evidence-only; use submit-operational`);
      assertTaskCanStart(task, state, definitions);
      const baseSha = requireBase(flags);
      const expectedBranch = flags.branch?.trim();
      if (!expectedBranch) fail("--branch is required");
      if (expectedBranch !== `agent/${task.id}-${actor}`) {
        fail(`--branch must be exactly agent/${task.id}-${actor}`);
      }
      if (before === "rework") {
        if (actor !== taskState.builderActor) fail("only the assigned builder may reclaim this repair");
        if (baseSha !== taskState.baseSha || expectedBranch !== taskState.expectedBranch) {
          fail("repair claims must retain the original base and expected branch");
        }
      } else {
        taskState.builderActor = actor;
        taskState.baseSha = baseSha;
        taskState.expectedBranch = expectedBranch;
        taskState.submittedTipSha = null;
      }
      taskState.status = "building";
      taskState.operatorActor = null;
      taskState.auditorActor = null;
      taskState.submittedTipSha = null;
      break;
    }
    case "submit-build":
      assertStatus(taskState, ["building"], action);
      if (actor !== taskState.builderActor) fail("only the assigned builder may submit the build");
      assertDependenciesDone(task, state);
      taskState.submittedTipSha = requireCommit(flags);
      evidence = requireEvidence(flags);
      taskState.lastEvidence = evidence;
      taskState.status = "awaiting_verification";
      break;
    case "submit-operational":
      assertStatus(taskState, ["ready", "rework"], action);
      if (task.ownedPaths.length !== 0) fail(`${task.id} owns repository paths and must use the builder flow`);
      assertTaskCanStart(task, state, definitions);
      if (before === "rework" && actor !== taskState.operatorActor) {
        fail("only the assigned operator may resubmit this repair");
      }
      evidence = requireEvidence(flags);
      taskState.builderActor = null;
      taskState.operatorActor = actor;
      taskState.auditorActor = null;
      taskState.baseSha = null;
      taskState.expectedBranch = null;
      taskState.submittedTipSha = null;
      taskState.lastEvidence = evidence;
      taskState.status = "awaiting_verification";
      break;
    case "verify-pass":
      assertStatus(taskState, ["awaiting_verification"], action);
      if (actor !== config.defaultRoles?.verifier) fail("only the configured deterministic verifier may pass verification");
      assertDependenciesDone(task, state);
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
      assertDependenciesDone(task, state);
      if (actor === taskState.builderActor || actor === taskState.operatorActor) {
        fail("builder/operator and auditor must be different actors");
      }
      taskState.auditorActor = actor;
      taskState.status = "auditing";
      break;
    case "audit-pass":
      assertStatus(taskState, ["auditing"], action);
      if (actor !== taskState.auditorActor) fail("only the assigned auditor may pass the audit");
      assertDependenciesDone(task, state);
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
      assertDependenciesDone(task, state);
      if (actor === taskState.builderActor || actor === taskState.operatorActor || actor === taskState.auditorActor) {
        fail("human approval must be independent of builder, operator, and auditor identities");
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
      sendToRework(taskState, config, evidence, { countRepair: false });
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
    definitionDigest: taskState.definitionDigest,
    baseSha: taskState.baseSha,
    expectedBranch: taskState.expectedBranch,
    submittedTipSha: taskState.submittedTipSha,
    evidence,
    repairCycles: taskState.repairCycles,
  };
}

function eligibleForRole(task, state, definitions, role) {
  const status = state.tasks[task.id].status;
  if (role === "builder") {
    if (task.ownedPaths.length === 0 || (status !== "ready" && status !== "rework")) return false;
  } else if (role === "operator") {
    if (task.ownedPaths.length !== 0 || (status !== "ready" && status !== "rework")) return false;
  } else if (role === "auditor") {
    return status === "awaiting_audit";
  } else if (role === "human") {
    return status === "human_gate";
  } else {
    fail("role must be builder, operator, auditor, or human");
  }
  try {
    assertTaskCanStart(task, state, definitions);
    return true;
  } catch {
    return false;
  }
}

function renderPrompt(task, taskState, role, actor, config = { globalVerification: [], protectedPaths: [] }) {
  if (!["builder", "operator", "auditor", "human"].includes(role)) fail("role must be builder, operator, auditor, or human");
  const common = [
    `Task: ${task.id} -- ${task.title}`,
    `Actor: ${actor}`,
    `Role: ${role}`,
    `Current state: ${taskState.status}`,
    `Definition digest: ${taskState.definitionDigest}`,
    `Claimed base: ${taskState.baseSha ?? "not claimed"}`,
    `Expected branch: ${taskState.expectedBranch ?? "not claimed"}`,
    `Submitted tip: ${taskState.submittedTipSha ?? "not submitted"}`,
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
  } else if (role === "operator") {
    common.push(
      "Perform only the named external operation and capture the listed evidence; do not create or submit a repository commit.",
      "Do not treat this local receipt as authentication, deployment authorization, or human approval.",
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
    console.log("Commands: validate | list | next <builder|operator|auditor|human> | prompt <task-id> <role> [actor] | transition <task-id> <action> --actor <name> [--base <sha> --commit <sha> --branch <branch>] [--evidence <text>] | reset --actor <human> --evidence <reason>. Shared-local actor and evidence labels are advisory; external controls must authorize audit, approval, merge, and deployment.");
    return;
  }

  if (command === "validate") {
    const { definitions } = await loadDefinitions();
    console.log(`Valid graph: ${definitions.tasks.length} tasks`);
    return;
  }

  if (command === "reset") {
    const flags = parseFlags(args);
    const actor = requireActor(flags);
    const evidence = requireEvidence(flags);
    await withLedgerLock(LEDGER_PATH, async () => {
      const { config, definitions } = await loadDefinitions();
      const receipt = { timestamp: new Date().toISOString(), action: "reset", actor, evidence };
      await writeJsonAtomic(LEDGER_PATH, {
        schemaVersion: LEDGER_SCHEMA_VERSION,
        state: initialState(config, definitions),
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
    await withLedgerLock(LEDGER_PATH, async () => {
      const graph = await loadGraph({ persistInitial: true });
      const task = taskById(graph.definitions, id);
      const taskState = graph.state.tasks[id];
      const actor = requireActor(flags);
      if (action === "claim-builder" && taskState.status === "ready") {
        const claim = await resolveClaim(flags.base, flags.branch, `agent/${id}-${actor}`);
        flags.base = claim.baseSha;
        flags.branch = claim.expectedBranch;
      }
      if (action === "submit-build") {
        const submission = await validateSubmission(task, taskState, graph.config, flags.commit, flags.branch);
        flags.commit = submission.tipSha;
      }
      const receipt = applyTransition({
        task,
        taskState,
        state: graph.state,
        definitions: graph.definitions,
        config: graph.config,
        action,
        flags,
      });
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
    const nextTask = graph.definitions.tasks.find((task) => eligibleForRole(task, graph.state, graph.definitions, role));
    console.log(nextTask ? `${nextTask.id}\t${nextTask.title}` : `No task is ready for role: ${role}`);
    return;
  }

  if (command === "prompt") {
    const [id, role, actor = graph.config.defaultRoles?.[role] ?? role] = args;
    if (!id || !role) fail("prompt requires <task-id> <builder|operator|auditor|human> [actor]");
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

export {
  assertChangedPathsAllowed,
  assertDefinitionIntegrity,
  definitionDigest,
  initialState,
  inspectCommitRange,
  loadGraph,
  parseNameStatus,
  pathsOverlap,
  renderPrompt,
  resolveClaim,
  resolveCommit,
  validateDefinitions,
  validateSubmission,
  withLedgerLock,
  writeJsonAtomic,
};
