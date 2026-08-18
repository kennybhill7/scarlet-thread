/**
 * v2 study vocabulary + record contracts — Phase 1 (STUDYV2-001).
 *
 * BUILD_PLAN.md §3.2: "This is the one canonical vocabulary. Postgres enums,
 * JSON payloads, and both planning documents use these snake_case serialized
 * values verbatim ... no table, contract, or doc may introduce variant
 * spellings." This module is that one source: every enum below is a
 * `readonly [...] as const` array (the runtime-checkable list a later
 * database/zod-generation task imports) with a derived union type and a type
 * guard built from the SAME array — never a hand-retyped string literal union
 * living next to it, which is exactly how vocabularies drift.
 *
 * Per tenet 4 in BUILD_PLAN.md ("Additive contracts only") and the pattern
 * `lib/contracts/range-v1.ts` already established: `lib/contracts.ts` stays
 * byte-stable; this is a new versioned module. Types and pure predicate
 * helpers only — no tables, no migration, no API, no UI (BUILD_PLAN §3.2/3.3
 * scope for this task).
 *
 * Record interfaces below use `CanonicalRangeV1` (`lib/contracts/range-v1.ts`)
 * for every passage-range field rather than a bare string, per RANGE-001.
 *
 * ---------------------------------------------------------------------------
 * Known gaps in the source docs (BUILD_PLAN.md §3.2/§3.3 and
 * THEOLOGY_MASTER_BUILD_PLAN.md §12.3), reported rather than silently
 * resolved per this task's instructions:
 *
 * 1. `study_claims.status` — BUILD_PLAN §3.3 spells out three values inline
 *    ("draft | confirmed | needs_revision") but THEOLOGY_MASTER_BUILD_PLAN.md
 *    §12.3 lists FOUR — "draft|revisited|confirmed|needs_revision" — with a
 *    `revisited` value BUILD_PLAN never mentions. This module follows
 *    BUILD_PLAN §3.2/3.3 (the section this task was told to match verbatim)
 *    and types `StudyClaimStatus` with only the three §3.3 values. Flagging
 *    for a human/planning decision rather than silently adding `revisited`.
 * 2. `applications.application_class` and `applications.promise_scope` —
 *    named as columns in both docs, but neither document enumerates their
 *    allowed values anywhere. Typed as `string` here (not a closed union)
 *    rather than inventing a vocabulary neither doc states.
 * 3. `applications.status`, `teaching_drafts.status`, `motif_candidates.status`,
 *    `motif_sightings.status` — named as columns in both docs; no document
 *    enumerates their allowed values. Typed as `string` for the same reason.
 * 4. `study_sessions.mode` / `.workflowState`, and `user_connections.status` —
 *    BUILD_PLAN §3.3 names the field but does not spell out its values;
 *    THEOLOGY_MASTER_BUILD_PLAN.md §12.3 does (`mode(encounter|deep|guided)`,
 *    `workflow_state(active|closed|archived)`, `status(draft|confirmed|revisit)`).
 *    No conflict between the two docs here (one is silent, not contradictory),
 *    so this module uses the master-plan values per BUILD_PLAN.md's own stated
 *    authority order ("Where the two disagree, the master plan wins").
 * 5. `claim_evidence` — BUILD_PLAN §3.3 lists its columns as `evidenceType
 *    (passage | context | connection | source), canonical/display reference,
 *    contentBlockId, citationId, note`. When `evidenceType` is `"connection"`,
 *    neither doc names a field that actually points at the `user_connections`
 *    (or `graph_edges`) row being cited — there is no `connectionId` column
 *    anywhere in either source. This looks like a documentation gap, not an
 *    intentional omission (the two enforced §3.2 constraints below are
 *    meaningless to check against a `claim_evidence` row that cannot identify
 *    which connection it cites). This module does not invent a field to fill
 *    it; the cross-table constraint predicates below take the connection's
 *    `evidenceLabel` as a plain argument so callers (once this field exists)
 *    can supply it after their own join.
 * ---------------------------------------------------------------------------
 */

import type { CanonicalRangeV1, DisplayReferenceV1 } from "@/lib/contracts/range-v1";

// ---------------------------------------------------------------------------
// §3.2 — the one canonical vocabulary. Seven enums, each a const array (the
// runtime-checkable source of truth) + a type derived from it + a type guard
// built from the same array.
// ---------------------------------------------------------------------------

/** What kind of claim the learner (or imported content) is making. */
export const CLAIM_KINDS = [
  "observation",
  "question",
  "context",
  "interpretation",
  "theology",
  "conviction",
  "application",
  "teaching_seed",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export function isClaimKind(value: string): value is ClaimKind {
  return (CLAIM_KINDS as readonly string[]).includes(value);
}

/** What kind of warrant stands behind the claim. */
export const EPISTEMIC_BASES = [
  "text_explicit",
  "historical_context",
  "inference",
  "canonical_synthesis",
  "tradition",
  "prudential_judgment",
  "personal_reflection",
] as const;
export type EpistemicBasis = (typeof EPISTEMIC_BASES)[number];
export function isEpistemicBasis(value: string): value is EpistemicBasis {
  return (EPISTEMIC_BASES as readonly string[]).includes(value);
}

export const CLAIM_CONFIDENCES = ["tentative", "developing", "well_supported"] as const;
export type ClaimConfidence = (typeof CLAIM_CONFIDENCES)[number];
export function isClaimConfidence(value: string): value is ClaimConfidence {
  return (CLAIM_CONFIDENCES as readonly string[]).includes(value);
}

export const CLAIM_PROVENANCES = ["learner", "imported"] as const;
export type ClaimProvenance = (typeof CLAIM_PROVENANCES)[number];
export function isClaimProvenance(value: string): value is ClaimProvenance {
  return (CLAIM_PROVENANCES as readonly string[]).includes(value);
}

export const CONNECTION_TYPES = [
  "quotation",
  "explicit_reference",
  "allusion",
  "motif",
  "promise_fulfillment",
  "type_antitype",
  "covenant_development",
  "contrast_reversal",
  "parallel",
  "doctrinal_synthesis",
  "personal_resonance",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];
export function isConnectionType(value: string): value is ConnectionType {
  return (CONNECTION_TYPES as readonly string[]).includes(value);
}

/**
 * How firmly the evidence supports a connection. "devotional" legitimizes
 * personal resonance without letting it quietly upgrade into doctrine — see
 * the two enforced constraints below.
 */
export const EVIDENCE_LABELS = ["explicit", "strong", "plausible", "devotional"] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];
export function isEvidenceLabel(value: string): value is EvidenceLabel {
  return (EVIDENCE_LABELS as readonly string[]).includes(value);
}

export const DOCTRINE_STATUSES = ["core", "conviction", "open", "disputed", "wisdom"] as const;
export type DoctrineStatus = (typeof DOCTRINE_STATUSES)[number];
export function isDoctrineStatus(value: string): value is DoctrineStatus {
  return (DOCTRINE_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// §3.2 — the two enforced constraints, as checkable predicates (not comments).
//
// "personal_resonance connections require evidence_label = 'devotional' — a
// same-row CHECK, trivially enforceable." and "devotional-labeled connections
// can never be cited as claim_evidence for a theology claim nor appear in
// curated doctrine — cross-table, so a plain PostgreSQL CHECK cannot enforce
// it." (See LESSONS.md CROSS-TABLE-INVARIANT-001 — this is that same rule.)
// These predicates are the shared logic the same-row CHECK, the deferrable
// constraint trigger, and the repository-layer validation BUILD_PLAN §3.2
// requires should all agree with; none of those other three layers are built
// in this task (types and pure helpers only).
// ---------------------------------------------------------------------------

/**
 * True unless `connection` is `personal_resonance`-typed with an
 * `evidenceLabel` other than `"devotional"`. Every other type/label
 * combination is unconstrained by this rule.
 */
export function isPersonalResonanceEvidenceLabelValid(connection: {
  type: ConnectionType;
  evidenceLabel: EvidenceLabel;
}): boolean {
  if (connection.type !== "personal_resonance") return true;
  return connection.evidenceLabel === "devotional";
}

/**
 * False when a `"devotional"`-labeled connection is cited as evidence for a
 * `"theology"` claim. Takes the connection's `evidenceLabel` and the citing
 * claim's `kind` as plain arguments (not a `ClaimEvidence` row) — see gap #5
 * above: neither source doc gives `claim_evidence` a field that identifies
 * which connection it cites, so a repository-layer caller must supply the
 * cited connection's `evidenceLabel` itself after its own join. The same
 * rule also governs curated-doctrine promotion (BUILD_PLAN §3.2: "nor appear
 * in curated doctrine") — that surface is out of this task's scope.
 */
export function canCiteConnectionEvidenceForClaim(evidenceLabel: EvidenceLabel, claimKind: ClaimKind): boolean {
  if (evidenceLabel === "devotional" && claimKind === "theology") return false;
  return true;
}

// ---------------------------------------------------------------------------
// §3.3 field-level vocabularies used by the record interfaces below. These
// are NOT part of the one canonical §3.2 list (BUILD_PLAN never calls them
// that), but they are still the runtime-checkable source for their field so
// a later db/zod task does not have to re-type them either. See gap notes
// 2-4 above for the fields with no enumerated values in either source doc.
// ---------------------------------------------------------------------------

/** BUILD_PLAN §3.3 inline list for `claim_evidence.evidenceType`. */
export const CLAIM_EVIDENCE_TYPES = ["passage", "context", "connection", "source"] as const;
export type ClaimEvidenceType = (typeof CLAIM_EVIDENCE_TYPES)[number];
export function isClaimEvidenceType(value: string): value is ClaimEvidenceType {
  return (CLAIM_EVIDENCE_TYPES as readonly string[]).includes(value);
}

/** BUILD_PLAN §3.3 inline list for `study_sessions.connectionState`. */
export const STUDY_SESSION_CONNECTION_STATES = ["unexamined", "provisional", "linked", "no_warrant_yet"] as const;
export type StudySessionConnectionState = (typeof STUDY_SESSION_CONNECTION_STATES)[number];
export function isStudySessionConnectionState(value: string): value is StudySessionConnectionState {
  return (STUDY_SESSION_CONNECTION_STATES as readonly string[]).includes(value);
}

/** THEOLOGY_MASTER_BUILD_PLAN.md §12.3 (gap #4 above: BUILD_PLAN §3.3 names the field, not its values). */
export const STUDY_SESSION_MODES = ["encounter", "deep", "guided"] as const;
export type StudySessionMode = (typeof STUDY_SESSION_MODES)[number];
export function isStudySessionMode(value: string): value is StudySessionMode {
  return (STUDY_SESSION_MODES as readonly string[]).includes(value);
}

/** THEOLOGY_MASTER_BUILD_PLAN.md §12.3 (gap #4 above). */
export const STUDY_SESSION_WORKFLOW_STATES = ["active", "closed", "archived"] as const;
export type StudySessionWorkflowState = (typeof STUDY_SESSION_WORKFLOW_STATES)[number];
export function isStudySessionWorkflowState(value: string): value is StudySessionWorkflowState {
  return (STUDY_SESSION_WORKFLOW_STATES as readonly string[]).includes(value);
}

/** BUILD_PLAN §3.3 inline list for `study_claims.status` (gap #1 above: master plan adds a fourth `revisited` value this module does not include). */
export const STUDY_CLAIM_STATUSES = ["draft", "revisited", "confirmed", "needs_revision"] as const;
export type StudyClaimStatus = (typeof STUDY_CLAIM_STATUSES)[number];
export function isStudyClaimStatus(value: string): value is StudyClaimStatus {
  return (STUDY_CLAIM_STATUSES as readonly string[]).includes(value);
}

/** THEOLOGY_MASTER_BUILD_PLAN.md §12.3 (gap #4 above). */
export const USER_CONNECTION_STATUSES = ["draft", "confirmed", "revisit"] as const;
export type UserConnectionStatus = (typeof USER_CONNECTION_STATUSES)[number];
export function isUserConnectionStatus(value: string): value is UserConnectionStatus {
  return (USER_CONNECTION_STATUSES as readonly string[]).includes(value);
}

/** BUILD_PLAN §3.3 inline list for `applications.modern_domain`. */
export const MODERN_DOMAINS = [
  "work",
  "money",
  "relationships",
  "grief",
  "anxiety",
  "leadership",
  "justice",
  "technology",
  "sexuality",
  "church",
] as const;
export type ModernDomain = (typeof MODERN_DOMAINS)[number];
export function isModernDomain(value: string): value is ModernDomain {
  return (MODERN_DOMAINS as readonly string[]).includes(value);
}

/** BUILD_PLAN §3.3 inline list for `applications.response_type` ("not every passage produces a productivity assignment"). */
export const RESPONSE_TYPES = [
  "belief",
  "repentance",
  "prayer",
  "lament",
  "worship",
  "rest",
  "relationship",
  "service",
  "action",
] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];
export function isResponseType(value: string): value is ResponseType {
  return (RESPONSE_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// §3.3 — record interfaces for the v2 entities this task owns. Every one
// carries `workspaceId` and an integer `revision` (§3.3: "Every table below
// carries workspace_id ... and an integer revision from day one"), plus the
// same soft-delete/timestamp shape `lib/contracts.ts`'s Entry/Thread already
// use (§3.3 header: "user tables workspace-scoped w/ soft delete"). Passage
// ranges use `CanonicalRangeV1`, never a bare string, per RANGE-001.
// ---------------------------------------------------------------------------

export interface StudySession {
  id: string;
  workspaceId: string;
  range: CanonicalRangeV1;
  mode: StudySessionMode;
  workflowState: StudySessionWorkflowState;
  connectionState: StudySessionConnectionState;
  /** Curated catalog/curriculum release this session is pinned to, if any. Free study has none. */
  catalogReleaseId?: string | null;
  readGateAt?: string | null;
  currentStep: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface StudyClaim {
  id: string;
  workspaceId: string;
  sessionId: string;
  kind: ClaimKind;
  epistemicBasis: EpistemicBasis;
  body: string;
  passage: CanonicalRangeV1;
  confidence: ClaimConfidence;
  provenance: ClaimProvenance;
  /** Theology claims only (BUILD_PLAN §3.3); null for every other ClaimKind. */
  doctrineStatus: DoctrineStatus | null;
  viewpointId?: string | null;
  status: StudyClaimStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ClaimEvidence {
  id: string;
  workspaceId: string;
  claimId: string;
  evidenceType: ClaimEvidenceType;
  /** Present when evidenceType anchors to a passage (passage | context | connection). */
  canonicalReference?: CanonicalRangeV1;
  displayReference?: DisplayReferenceV1;
  contentBlockId?: string | null;
  /** First-class citation id into the sources/citations model — never a pasted string (BUILD_PLAN §3.3). */
  citationId?: string | null;
  note: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface MotifCandidate {
  id: string;
  workspaceId: string;
  label: string;
  normalizedKey: string;
  /** No enumerated values in either source doc — see gap #3 above. */
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface MotifSighting {
  id: string;
  workspaceId: string;
  candidateId: string;
  /** Stable key of the curated passage_unit this sighting falls in (THEOLOGY_MASTER_BUILD_PLAN.md §12.3). Enforce one counting sighting per motif per distinct passage unit. */
  passageUnitKey: string;
  exactRange: CanonicalRangeV1;
  entryId?: string | null;
  claimId?: string | null;
  /** No enumerated values in either source doc — see gap #3 above. */
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface UserConnection {
  id: string;
  workspaceId: string;
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
  type: ConnectionType;
  evidenceLabel: EvidenceLabel;
  /** Required, minimum 20 characters (BUILD_PLAN §3.3) — enforced by repository-layer validation, not this type. */
  rationale: string;
  threadSlug?: string | null;
  status: UserConnectionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Application {
  id: string;
  workspaceId: string;
  sessionId: string;
  sourceClaimId: string;
  originalAudienceMeaning: string;
  enduringPrinciple: string;
  /** Prose bridge from original meaning to today, not a passage range. */
  canonicalBridge: string;
  /** No enumerated values in either source doc — see gap #2 above. */
  applicationClass: string;
  /** No enumerated values in either source doc — see gap #2 above. */
  promiseScope: string;
  modernDomain: ModernDomain;
  situation: string;
  responseType: ResponseType;
  faithfulResponse: string;
  cautions: string;
  availableAfter?: string | null;
  /** No enumerated values in either source doc — see gap #3 above. */
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface TeachingDraft {
  id: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  bigIdea: string;
  audience: string;
  /** The four vision formats (60-second/5-minute/15-minute/30-minute) are UI presets that set this; not a separate column (BUILD_PLAN §3.3). */
  durationMinutes: number;
  gospelConnection: string;
  /** No enumerated values in either source doc — see gap #3 above. */
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}
