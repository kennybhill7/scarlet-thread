import { strToU8, zipSync } from "fflate";

import type {
  DailyLog,
  Entry,
  Person,
  Thread,
} from "@/lib/contracts";
import type {
  Application,
  ClaimEvidence,
  MotifCandidate,
  MotifSighting,
  StudyClaim,
  StudySession,
  TeachingDraft,
  UserConnection,
} from "@/lib/contracts/study-v2";
import { SYNC_ENTITIES_V2, type SyncEntityV2 } from "@/lib/contracts/sync-v2";

// ---------------------------------------------------------------------------
// v2 payload shape — EXPORTV2-001 (BUILD_PLAN §3.4: "Export (lib/export/
// vault.ts) includes all new entities; a claim exports as Markdown with its
// evidence list").
//
// The key set of this type is pinned to `SyncEntityV2` (`AssertVaultV2KeysMatchSyncEntitiesV2`
// below), not re-typed independently, so the concrete row-shape mapping and
// the runtime iteration in `buildVaultArchive` cannot silently drift from the
// one canonical entity vocabulary in lib/contracts/sync-v2.ts. If a ninth
// entity is ever added to `SYNC_ENTITIES_V2`, three things fail loudly
// instead of eight entities quietly continuing to export:
//   1. `VaultExportV2`'s key set no longer matches `SyncEntityV2` -> the
//      `AssertVaultV2KeysMatchSyncEntitiesV2` assignment fails `tsc`.
//   2. `V2_RENDERERS` is typed `Record<SyncEntityV2, ...>` -> the object
//      literal is missing a required key -> `tsc` fails.
//   3. Even past a type-system bypass, `buildVaultArchive`'s own runtime
//      loop over `SYNC_ENTITIES_V2` throws for any entity with no
//      registered renderer, rather than skipping it.
// ---------------------------------------------------------------------------

export interface VaultExportV2 {
  session?: StudySession[];
  claim?: StudyClaim[];
  evidence?: ClaimEvidence[];
  motif?: MotifCandidate[];
  motifSighting?: MotifSighting[];
  connection?: UserConnection[];
  application?: Application[];
  teachingDraft?: TeachingDraft[];
}

/**
 * Compile-time proof that `VaultExportV2`'s key set is EXACTLY
 * `SyncEntityV2`'s members (order-independent, both directions). Never
 * assigned to or read at runtime — its only job is to fail `tsc` the moment
 * the two lists disagree.
 */
type AssertSameKeys<A extends string, B extends string> = [A] extends [B]
  ? ([B] extends [A] ? true : never)
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AssertVaultV2KeysMatchSyncEntitiesV2: AssertSameKeys<
  keyof VaultExportV2,
  SyncEntityV2
> = true;

type VaultExport = {
  entries: Entry[];
  threads: Thread[];
  people: Person[];
  logs: DailyLog[];
  /**
   * When any v2 array below is non-empty, `workspaceId` is REQUIRED
   * (`buildVaultArchive` throws otherwise — see "Tenant isolation" below).
   * v1 entities carry no `workspaceId` of their own (the v1 route already
   * scopes them by `userId` before calling this function), so this field
   * only governs v2 filtering.
   */
  workspaceId?: string;
} & VaultExportV2;

function safeName(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*[\]#^\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function uniqueThreadFiles(threads: Thread[]) {
  const used = new Set<string>();
  const files = new Map<string, string>();

  for (const thread of threads.filter((item) => !item.deletedAt)) {
    const base = safeName(thread.title) || thread.slug;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    files.set(thread.slug, candidate);
  }

  return files;
}

function uniquePersonFiles(people: Person[]) {
  const used = new Set<string>();
  const files = new Map<string, string>();

  for (const person of people) {
    const base = safeName(person.name) || person.slug;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    files.set(person.slug, candidate);
  }

  return files;
}

function passageMarkdown(
  chapter: string,
  entries: Entry[],
  threadFiles: Map<string, string>,
) {
  const lines = [
    "---",
    `chapter: ${yamlString(chapter)}`,
    "---",
    "",
    `# ${chapter}`,
    "",
  ];

  for (const entry of entries) {
    lines.push(
      `## ${entry.kind[0].toUpperCase()}${entry.kind.slice(1)}${
        entry.verse ? ` — ${entry.verse}` : ""
      }`,
      "",
      entry.body,
      "",
    );
    const linkedThreads = entry.threads.filter((slug) =>
      threadFiles.has(slug),
    );
    if (linkedThreads.length > 0) {
      lines.push(
        `Threads: ${linkedThreads
          .map((slug) => `[[02 Threads/${threadFiles.get(slug)}]]`)
          .join(" · ")}`,
        "",
      );
    }
    if (entry.answeredAt) {
      lines.push(`Answered: ${entry.answeredAt}`, "");
    }
    if (entry.inkUrl) {
      lines.push(`Ink: ${entry.inkUrl}`, "");
    }
    lines.push(`<!-- entry:${entry.id} updated:${entry.updatedAt} -->`, "");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// v2 rendering — BUILD_PLAN §3.4 ("a claim exports as Markdown with its
// evidence list", not as a bare row) and the "own tenant, own promise"
// requirement (a v2 row never crosses into a different workspace's archive).
//
// Soft-deleted v2 rows (deliberate choice, see EXPORTV2-001 commit): v1's
// export OMITS soft-deleted entries/threads (see `export.test.ts` — that
// test is read-only for this task and stays the authority for v1). v2 does
// the opposite and INCLUDES tombstoned-but-not-purged rows, clearly
// annotated `[deleted <timestamp>]` in the rendered heading. Reasoning: v1's
// deleted rows are still recoverable from the same live device (they are
// only client-hidden until GC); a v2 learner exporting their vault is far
// more likely doing so explicitly *because* they want a durable copy of
// everything that ever existed, including recently-tombstoned claims,
// applications, and drafts that have not yet been hard-purged — the "you own
// your work" promise this task exists to serve reads as "give me
// everything", not "give me only what the UI currently shows." Excluding
// them would be the wrong default for an ownership export even though it is
// the right default for a *reading-focused* vault export.
// ---------------------------------------------------------------------------

// Entity -> archive folder: Sessions, Claims (also `evidence`, nested),
// Motifs (also `motifSighting`, nested), Connections, Applications, Teaching.
// See the per-entity render* functions below for the literal paths.

function deletedNote(deletedAt: string | null | undefined) {
  return deletedAt ? ` [deleted ${deletedAt}]` : "";
}

function rangeText(range: { start: string; end: string }) {
  return range.start === range.end ? range.start : `${range.start} - ${range.end}`;
}

function renderEvidenceLine(evidence: ClaimEvidence) {
  const parts = [`type: ${evidence.evidenceType}`];
  if (evidence.canonicalReference) {
    parts.push(`ref: ${rangeText(evidence.canonicalReference)}`);
  }
  if (evidence.connectionId) parts.push(`connection: ${evidence.connectionId}`);
  if (evidence.citationId) parts.push(`citation: ${evidence.citationId}`);
  const note = evidence.note ? ` — ${evidence.note}` : "";
  return `- (${parts.join(", ")})${note}${deletedNote(evidence.deletedAt)} <!-- evidence:${evidence.id} -->`;
}

function renderClaims(
  claims: StudyClaim[],
  evidence: ClaimEvidence[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const evidenceByClaim = new Map<string, ClaimEvidence[]>();
  for (const item of evidence) {
    const group = evidenceByClaim.get(item.claimId) ?? [];
    group.push(item);
    evidenceByClaim.set(item.claimId, group);
  }

  for (const claim of claims) {
    const claimEvidenceRows = evidenceByClaim.get(claim.id) ?? [];
    const lines = [
      "---",
      `id: ${yamlString(claim.id)}`,
      `sessionId: ${yamlString(claim.sessionId)}`,
      "---",
      "",
      `# Claim — ${claim.kind}${deletedNote(claim.deletedAt)}`,
      "",
      claim.body,
      "",
      `- Passage: ${rangeText(claim.passage)}`,
      `- Epistemic basis: ${claim.epistemicBasis}`,
      `- Confidence: ${claim.confidence}`,
      `- Provenance: ${claim.provenance}`,
      `- Status: ${claim.status}`,
      `- Doctrine status: ${claim.doctrineStatus ?? "none"}`,
      "",
      "## Evidence",
      "",
      ...(claimEvidenceRows.length
        ? claimEvidenceRows.map(renderEvidenceLine)
        : ["- None yet"]),
      "",
      `<!-- claim:${claim.id} updated:${claim.updatedAt} -->`,
      "",
    ];
    files[`Bible Brain/06 Study/Claims/${safeName(claim.id)}.md`] = strToU8(
      lines.join("\n"),
    );
  }

  // Evidence citing a claim absent from this export (e.g. the claim's own
  // workspace filter excluded it, or its parent was purged upstream but this
  // row was not) is never silently dropped — it gets its own orphan file so
  // the data-ownership promise holds even for a dangling reference.
  const knownClaimIds = new Set(claims.map((claim) => claim.id));
  const orphaned = evidence.filter((item) => !knownClaimIds.has(item.claimId));
  if (orphaned.length > 0) {
    const lines = [
      "# Evidence without a matching claim in this export",
      "",
      ...orphaned.map(
        (item) => `${renderEvidenceLine(item)} (claimId: ${item.claimId})`,
      ),
      "",
    ];
    files["Bible Brain/06 Study/Claims/_orphaned-evidence.md"] = strToU8(
      lines.join("\n"),
    );
  }

  return files;
}

function renderSightingLine(sighting: MotifSighting) {
  const parts = [`unit: ${sighting.passageUnitKey}`, `range: ${rangeText(sighting.exactRange)}`];
  if (sighting.entryId) parts.push(`entry: ${sighting.entryId}`);
  if (sighting.claimId) parts.push(`claim: ${sighting.claimId}`);
  return `- (${parts.join(", ")}) — status: ${sighting.status}${deletedNote(sighting.deletedAt)} <!-- sighting:${sighting.id} -->`;
}

function renderMotifs(
  motifs: MotifCandidate[],
  sightings: MotifSighting[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const sightingsByMotif = new Map<string, MotifSighting[]>();
  for (const item of sightings) {
    const group = sightingsByMotif.get(item.candidateId) ?? [];
    group.push(item);
    sightingsByMotif.set(item.candidateId, group);
  }

  for (const motif of motifs) {
    const motifSightingRows = sightingsByMotif.get(motif.id) ?? [];
    const lines = [
      `# Motif — ${motif.label}${deletedNote(motif.deletedAt)}`,
      "",
      `- Normalized key: ${motif.normalizedKey}`,
      `- Status: ${motif.status}`,
      "",
      "## Sightings",
      "",
      ...(motifSightingRows.length
        ? motifSightingRows.map(renderSightingLine)
        : ["- None yet"]),
      "",
      `<!-- motif:${motif.id} updated:${motif.updatedAt} -->`,
      "",
    ];
    files[`Bible Brain/06 Study/Motifs/${safeName(motif.id)}.md`] = strToU8(
      lines.join("\n"),
    );
  }

  const knownMotifIds = new Set(motifs.map((motif) => motif.id));
  const orphaned = sightings.filter((item) => !knownMotifIds.has(item.candidateId));
  if (orphaned.length > 0) {
    const lines = [
      "# Sightings without a matching motif candidate in this export",
      "",
      ...orphaned.map(
        (item) => `${renderSightingLine(item)} (candidateId: ${item.candidateId})`,
      ),
      "",
    ];
    files["Bible Brain/06 Study/Motifs/_orphaned-sightings.md"] = strToU8(
      lines.join("\n"),
    );
  }

  return files;
}

function renderSessions(sessions: StudySession[]): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const session of sessions) {
    const lines = [
      `# Study Session${deletedNote(session.deletedAt)}`,
      "",
      `- Range: ${rangeText(session.range)}`,
      `- Mode: ${session.mode}`,
      `- Workflow state: ${session.workflowState}`,
      `- Connection state: ${session.connectionState}`,
      `- Current step: ${session.currentStep}`,
      `- Catalog release: ${session.catalogReleaseId ?? "none"}`,
      `- Read gate: ${session.readGateAt ?? "not yet"}`,
      "",
      `<!-- session:${session.id} updated:${session.updatedAt} -->`,
      "",
    ];
    files[`Bible Brain/06 Study/Sessions/${safeName(session.id)}.md`] = strToU8(
      lines.join("\n"),
    );
  }
  return files;
}

function renderConnections(
  connections: UserConnection[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const connection of connections) {
    const lines = [
      `# Connection — ${connection.type}${deletedNote(connection.deletedAt)}`,
      "",
      `- From: ${rangeText(connection.fromRange)}`,
      `- To: ${rangeText(connection.toRange)}`,
      `- Evidence label: ${connection.evidenceLabel}`,
      `- Status: ${connection.status}`,
      `- Thread: ${connection.threadSlug ?? "none"}`,
      "",
      "## Rationale",
      "",
      connection.rationale,
      "",
      `<!-- connection:${connection.id} updated:${connection.updatedAt} -->`,
      "",
    ];
    files[`Bible Brain/06 Study/Connections/${safeName(connection.id)}.md`] =
      strToU8(lines.join("\n"));
  }
  return files;
}

function renderApplications(
  applications: Application[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const application of applications) {
    const lines = [
      `# Application${deletedNote(application.deletedAt)}`,
      "",
      `- Session: ${application.sessionId}`,
      `- Source claim: ${application.sourceClaimId}`,
      `- Modern domain: ${application.modernDomain}`,
      `- Response type: ${application.responseType}`,
      `- Application class: ${application.applicationClass}`,
      `- Promise scope: ${application.promiseScope}`,
      `- Status: ${application.status}`,
      `- Available after: ${application.availableAfter ?? "immediately"}`,
      "",
      "## Original audience meaning",
      "",
      application.originalAudienceMeaning,
      "",
      "## Enduring principle",
      "",
      application.enduringPrinciple,
      "",
      "## Canonical bridge",
      "",
      application.canonicalBridge,
      "",
      "## Situation",
      "",
      application.situation,
      "",
      "## Faithful response",
      "",
      application.faithfulResponse,
      "",
      "## Cautions",
      "",
      application.cautions,
      "",
      `<!-- application:${application.id} updated:${application.updatedAt} -->`,
      "",
    ];
    files[`Bible Brain/06 Study/Applications/${safeName(application.id)}.md`] =
      strToU8(lines.join("\n"));
  }
  return files;
}

function renderTeachingDrafts(
  drafts: TeachingDraft[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const draft of drafts) {
    const lines = [
      `# ${draft.title}${deletedNote(draft.deletedAt)}`,
      "",
      `- Audience: ${draft.audience}`,
      `- Duration: ${draft.durationMinutes} minutes`,
      `- Status: ${draft.status}`,
      `- Session: ${draft.sessionId}`,
      "",
      "## Big idea",
      "",
      draft.bigIdea,
      "",
      "## Gospel connection",
      "",
      draft.gospelConnection,
      "",
      `<!-- teachingDraft:${draft.id} updated:${draft.updatedAt} -->`,
      "",
    ];
    files[`Bible Brain/06 Study/Teaching/${safeName(draft.id)}.md`] = strToU8(
      lines.join("\n"),
    );
  }
  return files;
}

/**
 * One renderer per `SyncEntityV2` member, keyed by the SAME runtime array
 * `buildVaultArchive` iterates. `evidence` and `motifSighting` render as
 * `null` — not absent — because BUILD_PLAN §3.4 nests them into their
 * parent's file rather than giving them one of their own; `renderClaims`/
 * `renderMotifs` already consume them. A renderer entry existing (even as
 * `null`) is what proves the entity was deliberately handled, vs. simply
 * forgotten.
 */
const V2_RENDERERS: Record<
  SyncEntityV2,
  ((data: Required<VaultExportV2>) => Record<string, Uint8Array>) | null
> = {
  session: (data) => renderSessions(data.session),
  claim: (data) => renderClaims(data.claim, data.evidence),
  evidence: null,
  motif: (data) => renderMotifs(data.motif, data.motifSighting),
  motifSighting: null,
  connection: (data) => renderConnections(data.connection),
  application: (data) => renderApplications(data.application),
  teachingDraft: (data) => renderTeachingDrafts(data.teachingDraft),
};

function filterToWorkspace<T extends { workspaceId: string }>(
  rows: T[],
  workspaceId: string,
): T[] {
  return rows.filter((row) => row.workspaceId === workspaceId);
}

function buildV2Files(data: VaultExport): Record<string, Uint8Array> {
  const hasAnyV2Data = SYNC_ENTITIES_V2.some(
    (entity) => (data[entity]?.length ?? 0) > 0,
  );
  if (!hasAnyV2Data) return {};

  if (!data.workspaceId) {
    throw new Error(
      "buildVaultArchive: workspaceId is required when any v2 entity data is provided (tenant isolation — see EXPORTV2-001).",
    );
  }
  const workspaceId = data.workspaceId;

  // Tenant isolation is enforced HERE, independent of whatever the caller
  // already scoped its query by — a hostile/mixed-workspace input can never
  // leak a row into the wrong learner's archive.
  const scoped: Required<VaultExportV2> = {
    session: filterToWorkspace(data.session ?? [], workspaceId),
    claim: filterToWorkspace(data.claim ?? [], workspaceId),
    evidence: filterToWorkspace(data.evidence ?? [], workspaceId),
    motif: filterToWorkspace(data.motif ?? [], workspaceId),
    motifSighting: filterToWorkspace(data.motifSighting ?? [], workspaceId),
    connection: filterToWorkspace(data.connection ?? [], workspaceId),
    application: filterToWorkspace(data.application ?? [], workspaceId),
    teachingDraft: filterToWorkspace(data.teachingDraft ?? [], workspaceId),
  };

  const files: Record<string, Uint8Array> = {};
  for (const entity of SYNC_ENTITIES_V2) {
    if (!(entity in V2_RENDERERS)) {
      // Unreachable under normal typechecking (see AssertVaultV2KeysMatchSyncEntitiesV2
      // above) — kept as a real runtime guard so a type-system bypass (an
      // `as any` cast feeding a 9th entity name into SYNC_ENTITIES_V2's
      // consumers) still fails loudly instead of silently exporting fewer
      // entities than the contract lists.
      throw new Error(
        `buildVaultArchive: no v2 export handling registered for entity "${entity}" — SYNC_ENTITIES_V2 has grown without a matching renderer.`,
      );
    }
    const render = V2_RENDERERS[entity];
    if (!render) continue; // evidence/motifSighting: nested into their parent's file, not standalone.
    Object.assign(files, render(scoped));
  }

  return files;
}

export function buildVaultArchive(data: VaultExport) {
  const files: Record<string, Uint8Array> = {};
  const threadFiles = uniqueThreadFiles(data.threads);
  const personFiles = uniquePersonFiles(data.people);
  const entriesByChapter = new Map<string, Entry[]>();

  for (const entry of data.entries.filter((item) => !item.deletedAt)) {
    const group = entriesByChapter.get(entry.chapter) ?? [];
    group.push(entry);
    entriesByChapter.set(entry.chapter, group);
  }

  for (const [chapter, entries] of entriesByChapter) {
    files[`Bible Brain/01 Passages/${safeName(chapter)}.md`] = strToU8(
      passageMarkdown(chapter, entries, threadFiles),
    );
  }

  for (const thread of data.threads.filter((item) => !item.deletedAt)) {
    const linked = data.entries.filter(
      (entry) => !entry.deletedAt && entry.threads.includes(thread.slug),
    );
    const body = [
      "---",
      `slug: ${yamlString(thread.slug)}`,
      "---",
      "",
      `# ${thread.title}`,
      "",
      "## In one line",
      "",
      thread.definition,
      "",
      "## What I’m seeing",
      "",
      thread.seeing,
      "",
      "## Passages",
      "",
      ...(linked.length
        ? linked.map(
            (entry) =>
              `- [[01 Passages/${safeName(entry.chapter)}]]${
                entry.verse ? ` — ${entry.verse}` : ""
              }`,
          )
        : ["- None yet"]),
      "",
    ].join("\n");
    files[
      `Bible Brain/02 Threads/${threadFiles.get(thread.slug) ?? thread.slug}.md`
    ] = strToU8(body);
  }

  for (const person of data.people) {
    files[`Bible Brain/03 People/${personFiles.get(person.slug)}.md`] = strToU8(
      [
        `# ${person.name}`,
        "",
        person.body,
        "",
        "## Chapters",
        "",
        ...person.chapters.map(
          (chapter) => `- [[01 Passages/${safeName(chapter)}]]`,
        ),
        "",
        "## Threads",
        "",
        ...person.threads
          .filter((slug) => threadFiles.has(slug))
          .map((slug) => `- [[02 Threads/${threadFiles.get(slug)}]]`),
        "",
      ].join("\n"),
    );
  }

  for (const log of data.logs) {
    files[`Bible Brain/05 Log/${safeName(log.date)}.md`] = strToU8(
      [
        "---",
        `date: ${log.date}`,
        `chapter: ${log.chapter ? yamlString(log.chapter) : "null"}`,
        "---",
        "",
        `# ${log.date}`,
        "",
        `- [${log.steps.read ? "x" : " "}] Read`,
        `- [${log.steps.observe ? "x" : " "}] Observe`,
        `- [${log.steps.link ? "x" : " "}] Link`,
        `- [${log.steps.ask ? "x" : " "}] Ask`,
        `- [${log.steps.pray ? "x" : " "}] Pray`,
        "",
        "## One sentence",
        "",
        log.sentence,
        "",
        "## What I’m carrying",
        "",
        log.carrying,
        "",
        "## Prayer",
        "",
        log.prayer,
        "",
      ].join("\n"),
    );
  }

  Object.assign(files, buildV2Files(data));

  files["Bible Brain/README.md"] = strToU8(
    [
      "# Bible Brain export",
      "",
      "This archive contains your writing and links in plain Markdown.",
      "Bible translation text is not duplicated in the export.",
      "",
      `Exported: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
  );

  return zipSync(files, { level: 6 });
}
