import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_CONFIDENCES,
  CLAIM_KINDS,
  CLAIM_PROVENANCES,
  CONNECTION_TYPES,
  DOCTRINE_STATUSES,
  EPISTEMIC_BASES,
  EVIDENCE_LABELS,
  canCiteConnectionEvidenceForClaim,
  isClaimConfidence,
  isClaimKind,
  isClaimProvenance,
  isConnectionType,
  isDoctrineStatus,
  isEpistemicBasis,
  isEvidenceLabel,
  isPersonalResonanceEvidenceLabelValid,
  type ClaimConfidence,
  type ClaimKind,
  type ClaimProvenance,
  type ConnectionType,
  type DoctrineStatus,
  type EpistemicBasis,
  type EvidenceLabel,
} from "@/lib/contracts/study-v2";

// ---------------------------------------------------------------------------
// BUILD_PLAN.md §3.2's seven enums, transcribed independently here from the
// doc text (not derived from the module under test — TEST QUALITY rule: a
// test's expected value must never come from the code it is checking). If
// study-v2.ts's exported arrays ever drift from this list — an added,
// removed, renamed, or reordered value — the deepEqual assertions below
// catch it.
// ---------------------------------------------------------------------------

const EXPECTED_CLAIM_KINDS = [
  "observation",
  "question",
  "context",
  "interpretation",
  "theology",
  "conviction",
  "application",
  "teaching_seed",
];

const EXPECTED_EPISTEMIC_BASES = [
  "text_explicit",
  "historical_context",
  "inference",
  "canonical_synthesis",
  "tradition",
  "prudential_judgment",
  "personal_reflection",
];

const EXPECTED_CLAIM_CONFIDENCES = ["tentative", "developing", "well_supported"];

const EXPECTED_CLAIM_PROVENANCES = ["learner", "imported"];

const EXPECTED_CONNECTION_TYPES = [
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
];

const EXPECTED_EVIDENCE_LABELS = ["explicit", "strong", "plausible", "devotional"];

const EXPECTED_DOCTRINE_STATUSES = ["core", "conviction", "open", "disputed", "wisdom"];

// ---------------------------------------------------------------------------
// Exact-match: no enum contains a value absent from BUILD_PLAN §3.2, and
// every §3.2 value is present (deepEqual checks both directions, order
// included).
// ---------------------------------------------------------------------------

test("ClaimKind matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(CLAIM_KINDS, EXPECTED_CLAIM_KINDS);
});

test("EpistemicBasis matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(EPISTEMIC_BASES, EXPECTED_EPISTEMIC_BASES);
});

test("ClaimConfidence matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(CLAIM_CONFIDENCES, EXPECTED_CLAIM_CONFIDENCES);
});

test("ClaimProvenance matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(CLAIM_PROVENANCES, EXPECTED_CLAIM_PROVENANCES);
});

test("ConnectionType matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(CONNECTION_TYPES, EXPECTED_CONNECTION_TYPES);
});

test("EvidenceLabel matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(EVIDENCE_LABELS, EXPECTED_EVIDENCE_LABELS);
});

test("DoctrineStatus matches BUILD_PLAN §3.2 verbatim", () => {
  assert.deepEqual(DOCTRINE_STATUSES, EXPECTED_DOCTRINE_STATUSES);
});

// ---------------------------------------------------------------------------
// Round-trip: every value in every §3.2 enum is accepted by its own type
// guard, and a value from a sibling enum (never a member of this one) is
// rejected — the guard actually discriminates, not just returns true always.
// ---------------------------------------------------------------------------

test("every ClaimKind value round-trips through isClaimKind", () => {
  for (const value of CLAIM_KINDS) {
    assert.equal(isClaimKind(value), true, `expected "${value}" to be a ClaimKind`);
  }
  assert.equal(isClaimKind("not_a_real_kind"), false);
  assert.equal(isClaimKind("text_explicit"), false); // an EpistemicBasis value, not a ClaimKind
});

test("every EpistemicBasis value round-trips through isEpistemicBasis", () => {
  for (const value of EPISTEMIC_BASES) {
    assert.equal(isEpistemicBasis(value), true, `expected "${value}" to be an EpistemicBasis`);
  }
  assert.equal(isEpistemicBasis("not_a_real_basis"), false);
  assert.equal(isEpistemicBasis("observation"), false); // a ClaimKind value, not an EpistemicBasis
});

test("every ClaimConfidence value round-trips through isClaimConfidence", () => {
  for (const value of CLAIM_CONFIDENCES) {
    assert.equal(isClaimConfidence(value), true, `expected "${value}" to be a ClaimConfidence`);
  }
  assert.equal(isClaimConfidence("confirmed"), false);
});

test("every ClaimProvenance value round-trips through isClaimProvenance", () => {
  for (const value of CLAIM_PROVENANCES) {
    assert.equal(isClaimProvenance(value), true, `expected "${value}" to be a ClaimProvenance`);
  }
  assert.equal(isClaimProvenance("system"), false);
});

test("every ConnectionType value round-trips through isConnectionType", () => {
  for (const value of CONNECTION_TYPES) {
    assert.equal(isConnectionType(value), true, `expected "${value}" to be a ConnectionType`);
  }
  assert.equal(isConnectionType("devotional"), false); // an EvidenceLabel value, not a ConnectionType
});

test("every EvidenceLabel value round-trips through isEvidenceLabel", () => {
  for (const value of EVIDENCE_LABELS) {
    assert.equal(isEvidenceLabel(value), true, `expected "${value}" to be an EvidenceLabel`);
  }
  assert.equal(isEvidenceLabel("personal_resonance"), false); // a ConnectionType value, not an EvidenceLabel
});

test("every DoctrineStatus value round-trips through isDoctrineStatus", () => {
  for (const value of DOCTRINE_STATUSES) {
    assert.equal(isDoctrineStatus(value), true, `expected "${value}" to be a DoctrineStatus`);
  }
  assert.equal(isDoctrineStatus("draft"), false);
});

// ---------------------------------------------------------------------------
// The two enforced §3.2 constraints, as predicates.
// ---------------------------------------------------------------------------

function connection(type: ConnectionType, evidenceLabel: EvidenceLabel) {
  return { type, evidenceLabel };
}

test("isPersonalResonanceEvidenceLabelValid: personal_resonance + devotional is valid", () => {
  assert.equal(isPersonalResonanceEvidenceLabelValid(connection("personal_resonance", "devotional")), true);
});

test("isPersonalResonanceEvidenceLabelValid: personal_resonance + any non-devotional label is rejected", () => {
  for (const label of EVIDENCE_LABELS.filter((l) => l !== "devotional")) {
    assert.equal(
      isPersonalResonanceEvidenceLabelValid(connection("personal_resonance", label)),
      false,
      `expected personal_resonance + "${label}" to be rejected`,
    );
  }
});

test("isPersonalResonanceEvidenceLabelValid: non-personal_resonance types are unconstrained by this rule", () => {
  for (const type of CONNECTION_TYPES.filter((t) => t !== "personal_resonance")) {
    for (const label of EVIDENCE_LABELS) {
      assert.equal(
        isPersonalResonanceEvidenceLabelValid(connection(type, label)),
        true,
        `expected ${type} + "${label}" to be valid (rule only constrains personal_resonance)`,
      );
    }
  }
});

test("canCiteConnectionEvidenceForClaim: a devotional-labeled connection cannot be cited for a theology claim", () => {
  assert.equal(canCiteConnectionEvidenceForClaim("devotional", "theology"), false);
});

test("canCiteConnectionEvidenceForClaim: a devotional-labeled connection CAN be cited for every non-theology claim kind", () => {
  for (const kind of CLAIM_KINDS.filter((k) => k !== "theology")) {
    assert.equal(
      canCiteConnectionEvidenceForClaim("devotional", kind),
      true,
      `expected devotional evidence to be citable for claim kind "${kind}"`,
    );
  }
});

test("canCiteConnectionEvidenceForClaim: every non-devotional label can be cited for a theology claim", () => {
  for (const label of EVIDENCE_LABELS.filter((l) => l !== "devotional")) {
    assert.equal(
      canCiteConnectionEvidenceForClaim(label, "theology"),
      true,
      `expected "${label}" evidence to be citable for a theology claim`,
    );
  }
});

// ---------------------------------------------------------------------------
// Type-level smoke check: the exported types are usable as the const-array
// element type (guards against the array and the type silently diverging,
// e.g. if someone widened the type to `string` while narrowing the array).
// ---------------------------------------------------------------------------

test("exported types accept every value from their own const array (compile-time + runtime)", () => {
  const kind: ClaimKind = CLAIM_KINDS[0];
  const basis: EpistemicBasis = EPISTEMIC_BASES[0];
  const confidence: ClaimConfidence = CLAIM_CONFIDENCES[0];
  const provenance: ClaimProvenance = CLAIM_PROVENANCES[0];
  const connectionType: ConnectionType = CONNECTION_TYPES[0];
  const evidenceLabel: EvidenceLabel = EVIDENCE_LABELS[0];
  const doctrineStatus: DoctrineStatus = DOCTRINE_STATUSES[0];

  assert.equal(kind, "observation");
  assert.equal(basis, "text_explicit");
  assert.equal(confidence, "tentative");
  assert.equal(provenance, "learner");
  assert.equal(connectionType, "quotation");
  assert.equal(evidenceLabel, "explicit");
  assert.equal(doctrineStatus, "core");
});
