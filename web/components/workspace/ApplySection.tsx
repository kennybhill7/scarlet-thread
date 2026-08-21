"use client";

import { useState } from "react";

import { optionsFrom } from "@/components/study/ClaimComposer";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import {
  MODERN_DOMAINS,
  RESPONSE_TYPES,
  type Application,
  type ModernDomain,
  type ResponseType,
  type StudyClaim,
  type StudySession,
} from "@/lib/contracts/study-v2";
import { saveLocalApplication } from "@/lib/sync/store";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle, noticeStyle } from "./styles";

/**
 * APPLYPANE-001 — BUILD_PLAN §4 row 7, "Apply — The Practice Bridge".
 * Unlocked per the EXISTING gate (`lib/workspace/gating.ts`'s
 * `apply: hasClaimOfKind(claims, "theology")`, UNTOUCHED by this task) —
 * >=1 theology claim exists for the session. Writes an `Application`
 * (`lib/contracts/study-v2.ts`) through the ALREADY-BUILT
 * `saveLocalApplication` vault writer (`lib/sync/store.ts`, a readOnlyPath
 * here) — no new write path, matching every prior section's own rule.
 *
 * Architecturally different from Context/Theology/Conviction: `Application`
 * is not a `StudyClaim`, so this section does NOT mount `ClaimComposer` —
 * it is its own bridge-field form, reusing `optionsFrom`/`humanizeToken`
 * from `ClaimComposer.tsx` (a readOnlyPath, imported not edited) for the
 * two REAL enum pickers (`modernDomain`/`responseType`) so a value added to
 * either `MODERN_DOMAINS`/`RESPONSE_TYPES` array appears here automatically,
 * exactly the same derivation discipline `PromoteFields` already uses.
 *
 * ---------------------------------------------------------------------------
 * DRAFT VS. FINALIZE — what "partial" actually means here, stated plainly
 * because BUILD_PLAN's own wording ("drafts save anytime; bridge fields
 * checked at finalize") reads as if any subset of fields can be saved at
 * any time, and that is NOT fully achievable through the write path this
 * task is required to use without editing a read-only file:
 *
 * `lib/sync/store.ts`'s `saveLocalApplication` validates every payload
 * against `syncApplicationV2Schema` (`lib/api/sync-v2.ts`, a readOnlyPath)
 * BEFORE it will write anything to IndexedDB — and that schema already
 * requires NINE of the ten BUILD_PLAN §3.3 bridge fields to be non-empty
 * (`sourceClaimId`, `originalAudienceMeaning`, `enduringPrinciple`,
 * `canonicalBridge`, `applicationClass`, `promiseScope`, `modernDomain`,
 * `situation`, `responseType`, `faithfulResponse` all carry `.min(1)` or a
 * required `z.enum(...)`); the ONLY field the schema allows empty is
 * `cautions` (`z.string().max(100_000)`, no `.min`). This is a real,
 * disclosed constraint of a read-only dependency, not an oversight: a
 * TRULY partial record — say, `originalAudienceMeaning` still blank — is
 * REJECTED by `saveLocalApplication` itself, draft or not, and this task
 * has no owned path that could relax that floor.
 *
 * Given that floor, the honest two-mode design actually built:
 *   - The learner's in-progress answers live in ordinary component state
 *     (`draft` below) and are never silently discarded while they are still
 *     typing — nothing here forces the fields to be filled in any order.
 *   - "Save draft" (`draftSaveReadiness`) is enabled the MOMENT the record
 *     can pass the schema's own floor — i.e., everything except `cautions`
 *     — and persists with `status: "draft"`. This is the earliest point ANY
 *     save can succeed at all through the existing write path.
 *   - "Finalize" (`finalizeReadiness`) additionally requires `cautions`,
 *     which is BUILD_PLAN §3.3's own full ten-field bridge-field set —
 *     i.e., finalize is NOT narrowed at all versus what BUILD_PLAN names;
 *     it is exactly all ten, `cautions` included. The distinct-transition
 *     requirement (criterion 3) is honored: `status` moves from `"draft"`
 *     to `"finalized"` only through this second, explicit action, gated by
 *     its own stricter readiness check, never automatically.
 *   - Repeated "Save draft" clicks UPDATE the same record in place (same
 *     `id`, incrementing `revision`) rather than creating a new row each
 *     time — see the `saved` state below.
 *
 * This is reported here, not silently worked around: if BUILD_PLAN's fuller
 * ambition (any of the nine schema-required fields individually optional
 * pre-finalize) is wanted, it requires relaxing `syncApplicationV2Schema`
 * itself — `lib/api/sync-v2.ts`, a readOnlyPath for this task — a follow-up
 * task's job, not this one's to improvise.
 * ---------------------------------------------------------------------------
 *
 * ASSERTION LINE (docs/decisions/2026-08-18-teaching-not-theology.md): every
 * label below asks what the LEARNER thinks/would do/classifies this as —
 * never what the app asserts the passage means. `applicationClass` and
 * `promiseScope` are DELIBERATELY free-text `Field`s, not pickers — BUILD_PLAN
 * §3.3's own note: "do not invent enum values for them ... a guessed enum
 * becomes a destructive migration."
 *
 * ---------------------------------------------------------------------------
 * SAFETY-CRITICAL — sensitive `modernDomain` referral copy (BUILD_PLAN §3.3
 * verbatim: "Sensitive domains never render medical, mental-health, legal,
 * financial, abuse, or crisis advice — referral language only"). NO dynamic
 * per-domain guidance is generated anywhere in this file; `SENSITIVE_DOMAIN_
 * NOTICES` below is the ENTIRE, static, hand-written vocabulary, and it is
 * pointer-only ("consider talking with ___") — never an instruction about
 * what to actually do. Domain-by-domain reasoning over all ten
 * `MODERN_DOMAINS` values (also restated in this task's commit message):
 *
 *   - grief: INCLUDED. Named explicitly in this task's own acceptance
 *     criteria as an obvious case; squarely mental-health/bereavement
 *     adjacent, and a bare "consider professional/pastoral support" pointer
 *     is uncontroversially safe.
 *   - anxiety: INCLUDED. Same reasoning — mental-health-adjacent, named
 *     explicitly, safe generic pointer.
 *   - money: INCLUDED. BUILD_PLAN's forbidden category "financial" maps
 *     directly and unambiguously onto the domain literally named "money" —
 *     the clearest mapping outside the two BUILD_PLAN names by name. The
 *     copy itself states only that this app gives no financial advice and
 *     points to a professional; it is boilerplate, not advice.
 *   - relationships: EXCLUDED. Too broad (friendship, dating, marriage,
 *     parenting all fall under it) to write one confident, safe, non-
 *     presumptuous notice — a version naming abuse risks alarming the vast
 *     majority of entries that have nothing to do with it; a version vague
 *     enough to avoid that says nothing a generic notice wouldn't. Per this
 *     task's own instruction ("if you are not fully confident the copy...
 *     stays on the right side of that line, render NOTHING extra"), nothing
 *     renders here.
 *   - sexuality: EXCLUDED, same reasoning as relationships — plausible
 *     overlap with mental-health/abuse in SOME entries, but the domain
 *     itself (biblical teaching on sexuality, identity, purity) very often
 *     has nothing to do with those categories, and no version of this copy
 *     felt confidently safe on both sides. Recorded here for a human
 *     reviewer to override if they judge otherwise.
 *   - leadership, justice, technology, church: EXCLUDED. None maps to
 *     medical/mental-health/legal/financial/abuse/crisis with any
 *     confidence; "justice" in a Bible-study app overwhelmingly means
 *     biblical/social justice themes, not a personal legal matter.
 *   - work: EXCLUDED. No mapping to any forbidden category.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Draft shape + pure state transitions. No hooks, no I/O — testable by
// direct import, matching ClaimComposer.tsx's own established split between
// pure logic and the stateful shell that calls it.
// ---------------------------------------------------------------------------

export interface ApplicationDraft {
  sourceClaimId: string | null;
  originalAudienceMeaning: string;
  enduringPrinciple: string;
  canonicalBridge: string;
  /** Free text, deliberately unenumerated (BUILD_PLAN §3.3) — never a picker. */
  applicationClass: string;
  /** Free text, deliberately unenumerated (BUILD_PLAN §3.3) — never a picker. */
  promiseScope: string;
  modernDomain: ModernDomain | null;
  situation: string;
  responseType: ResponseType | null;
  faithfulResponse: string;
  cautions: string;
}

/** The composer's one and only starting point — every field blank/null, nothing pre-filled (assertion-line discipline, same as `BLANK_CLAIM_SELECTION`). */
export const BLANK_APPLICATION_DRAFT: ApplicationDraft = {
  sourceClaimId: null,
  originalAudienceMeaning: "",
  enduringPrinciple: "",
  canonicalBridge: "",
  applicationClass: "",
  promiseScope: "",
  modernDomain: null,
  situation: "",
  responseType: null,
  faithfulResponse: "",
  cautions: "",
};

/** Generic field patch — every onChange/onClick in the render body calls this, never mutates `draft` directly. */
export function patchApplicationDraft(
  draft: ApplicationDraft,
  patch: Partial<ApplicationDraft>,
): ApplicationDraft {
  return { ...draft, ...patch };
}

/** Only non-deleted theology-kind claims — the one picker this section offers for `sourceClaimId`; never a typed-in id. */
export function theologyClaimsFor(claims: StudyClaim[]): StudyClaim[] {
  return claims.filter((claim) => claim.kind === "theology" && !claim.deletedAt);
}

/** Short, stable chip label for a theology claim — the claim's own words, truncated, never re-worded. */
export function theologyClaimLabel(claim: StudyClaim): string {
  const body = claim.body.trim();
  return body.length > 64 ? `${body.slice(0, 64)}…` : body;
}

// ---------------------------------------------------------------------------
// Readiness — see this file's header for why "draft" and "finalize" land
// exactly where they do given `syncApplicationV2Schema`'s own floor.
// ---------------------------------------------------------------------------

export interface ApplicationReadiness {
  ready: boolean;
  missing: string[];
}

type TextField =
  | "originalAudienceMeaning"
  | "enduringPrinciple"
  | "canonicalBridge"
  | "applicationClass"
  | "promiseScope"
  | "situation"
  | "faithfulResponse";

/**
 * Every field `saveLocalApplication`'s own schema (`syncApplicationV2Schema`)
 * requires non-empty for ANY save to succeed at all — the schema's floor,
 * transcribed field-for-field, not re-derived. `cautions` is deliberately
 * absent: it is the one field that schema allows empty (see this file's
 * header).
 */
const REQUIRED_FOR_ANY_SAVE: Array<{ field: TextField | "sourceClaimId" | "modernDomain" | "responseType"; reason: string }> = [
  { field: "sourceClaimId", reason: "Choose which of your theology claims this bridges from." },
  { field: "originalAudienceMeaning", reason: "Say what this passage meant to its original audience, in your own words." },
  { field: "enduringPrinciple", reason: "Name the enduring principle you see carrying forward." },
  { field: "canonicalBridge", reason: "Describe how you would bridge that principle to today." },
  { field: "applicationClass", reason: "Name how you would classify this application, in your own words." },
  { field: "promiseScope", reason: "State who you think this applies to, and under what conditions." },
  { field: "modernDomain", reason: "Choose a domain of life this applies to." },
  { field: "situation", reason: "Describe the situation in your own life you are applying this to." },
  { field: "responseType", reason: "Choose what kind of response this calls for." },
  { field: "faithfulResponse", reason: "Say what a faithful response would look like for you." },
];

const CAUTIONS_REASON = "Name any cautions or guardrails you want to keep in mind as you respond.";

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0;
}

/** The floor `saveLocalApplication` itself enforces — the earliest point ANY save (draft or finalize) can succeed. */
export function draftSaveReadiness(draft: ApplicationDraft): ApplicationReadiness {
  const missing = REQUIRED_FOR_ANY_SAVE.filter((entry) => isBlank(draft[entry.field] as string | null)).map(
    (entry) => entry.reason,
  );
  return { ready: missing.length === 0, missing };
}

/**
 * All ten BUILD_PLAN §3.3 bridge fields, `cautions` included — the complete
 * set BUILD_PLAN names, not narrowed. This is the MUTATION-PROOF target
 * (acceptance criterion 9): a finalize that accepts a record still missing
 * `cautions` is exactly the completeness bug this task must prove it does
 * not have — see `tests/apply-pane.test.ts`.
 */
export function finalizeReadiness(draft: ApplicationDraft): ApplicationReadiness {
  const base = draftSaveReadiness(draft);
  const missing = isBlank(draft.cautions) ? [...base.missing, CAUTIONS_REASON] : [...base.missing];
  return { ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Record builder — pure, deterministic (caller supplies id/revision/
// timestamps), throws if called before `draftSaveReadiness` would allow it
// (the render body never does — see `submit` below).
// ---------------------------------------------------------------------------

export type ApplicationStatus = "draft" | "finalized";

export function buildApplicationRecord(params: {
  id: string;
  workspaceId: string;
  sessionId: string;
  draft: ApplicationDraft;
  status: ApplicationStatus;
  revision: number;
  createdAt: string;
  now: string;
}): Application {
  const { draft } = params;
  if (!draft.sourceClaimId) throw new Error("buildApplicationRecord requires a chosen sourceClaimId");
  if (!draft.modernDomain) throw new Error("buildApplicationRecord requires a chosen modernDomain");
  if (!draft.responseType) throw new Error("buildApplicationRecord requires a chosen responseType");
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    sourceClaimId: draft.sourceClaimId,
    originalAudienceMeaning: draft.originalAudienceMeaning.trim(),
    enduringPrinciple: draft.enduringPrinciple.trim(),
    canonicalBridge: draft.canonicalBridge.trim(),
    applicationClass: draft.applicationClass.trim(),
    promiseScope: draft.promiseScope.trim(),
    modernDomain: draft.modernDomain,
    situation: draft.situation.trim(),
    responseType: draft.responseType,
    faithfulResponse: draft.faithfulResponse.trim(),
    cautions: draft.cautions.trim(),
    availableAfter: null,
    status: params.status,
    revision: params.revision,
    createdAt: params.createdAt,
    updatedAt: params.now,
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Sensitive-domain referral copy — see this file's header for the full
// domain-by-domain reasoning. STATIC, PRE-WRITTEN, no dynamic generation.
// ---------------------------------------------------------------------------

const SENSITIVE_DOMAIN_NOTICES: Partial<Record<ModernDomain, string>> = {
  grief: "Grief runs deep, and this study is not a substitute for care. If you are grieving, consider talking with a pastor, counselor, or someone you trust, in addition to what you write here.",
  anxiety: "If anxiety is affecting your daily life, this study is not a substitute for professional support. Consider talking with a pastor, counselor, or doctor, in addition to what you write here.",
  money: "This app does not give financial advice. For decisions with real financial stakes, consider talking with a qualified financial professional or pastoral counsel, in addition to what you write here.",
};

/** Pure lookup — `null` for any domain with no static notice (nine of ten; see this file's header for why). */
export function sensitiveDomainNotice(domain: ModernDomain | null): string | null {
  if (!domain) return null;
  return SENSITIVE_DOMAIN_NOTICES[domain] ?? null;
}

// ---------------------------------------------------------------------------
// The stateful shell.
// ---------------------------------------------------------------------------

export interface ApplySectionProps {
  workspaceId: string;
  session: StudySession;
  unlocked: boolean;
  /** This session's own claims (any kind) — filtered to theology internally via `theologyClaimsFor`. */
  claims: StudyClaim[];
  onSaved: (application: Application) => void;
}

export function ApplySection({ workspaceId, session, unlocked, claims, onSaved }: ApplySectionProps) {
  const [draft, setDraft] = useState<ApplicationDraft>(BLANK_APPLICATION_DRAFT);
  const [saved, setSaved] = useState<Application | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!unlocked) {
    return (
      <LockedNotice
        testId="apply-locked"
        message="Locked until your first theology claim in this session. Use Theology above first, then this bridge opens."
      />
    );
  }

  const theologyClaims = theologyClaimsFor(claims);
  const draftReadiness = draftSaveReadiness(draft);
  const finalReadiness = finalizeReadiness(draft);
  const needsCautionsOnly = draftReadiness.ready && !finalReadiness.ready;
  const sensitiveNotice = sensitiveDomainNotice(draft.modernDomain);
  const disabled = status === "saving";

  async function submit(nextStatus: ApplicationStatus) {
    const readiness = nextStatus === "draft" ? draftReadiness : finalReadiness;
    if (!readiness.ready || disabled) return;
    setStatus("saving");
    setMessage("Saving to this device…");
    const now = new Date().toISOString();
    try {
      const record = buildApplicationRecord({
        id: saved?.id ?? crypto.randomUUID(),
        workspaceId,
        sessionId: session.id,
        draft,
        status: nextStatus,
        revision: saved ? saved.revision + 1 : 1,
        createdAt: saved?.createdAt ?? now,
        now,
      });
      await saveLocalApplication(record);
      setSaved(record);
      setStatus("saved");
      setMessage(
        nextStatus === "draft" ? "Saved to this device as a draft." : "Finalized and saved to this device.",
      );
      onSaved(record);
    } catch {
      setStatus("error");
      setMessage("This device could not save the application. Nothing was discarded — please try again.");
    }
  }

  return (
    <div style={bodyStyle} data-testid="apply-form">
      <fieldset>
        <legend>Which of your theology claims does this bridge from?</legend>
        <div role="group">
          {theologyClaims.map((claim) => (
            <Chip
              active={draft.sourceClaimId === claim.id}
              aria-pressed={draft.sourceClaimId === claim.id}
              data-field="sourceClaimId"
              data-value={claim.id}
              disabled={disabled}
              key={claim.id}
              onClick={() => setDraft(patchApplicationDraft(draft, { sourceClaimId: claim.id }))}
            >
              {theologyClaimLabel(claim)}
            </Chip>
          ))}
        </div>
      </fieldset>

      <Field
        disabled={disabled}
        label="What did this passage mean to its original audience, in your own words?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { originalAudienceMeaning: event.target.value }))}
        value={draft.originalAudienceMeaning}
      />
      <Field
        disabled={disabled}
        label="What enduring principle do you see carrying forward from that meaning?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { enduringPrinciple: event.target.value }))}
        value={draft.enduringPrinciple}
      />
      <Field
        disabled={disabled}
        label="How would you bridge that principle to today, through the whole of Scripture?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { canonicalBridge: event.target.value }))}
        value={draft.canonicalBridge}
      />
      <Field
        disabled={disabled}
        hint="Free text — this app does not supply a fixed list for this field."
        label="How would you classify this application, in your own words? (e.g. command, principle, wisdom, promise)"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { applicationClass: event.target.value }))}
        value={draft.applicationClass}
      />
      <Field
        disabled={disabled}
        hint="Free text — this app does not supply a fixed list for this field."
        label="If this passage makes a promise, who do you think it applies to, and under what conditions?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { promiseScope: event.target.value }))}
        value={draft.promiseScope}
      />

      <fieldset>
        <legend>What domain of life are you applying this to?</legend>
        <div role="group">
          {optionsFrom(MODERN_DOMAINS).map((option) => (
            <Chip
              active={draft.modernDomain === option.value}
              aria-pressed={draft.modernDomain === option.value}
              data-field="modernDomain"
              data-value={option.value}
              disabled={disabled}
              key={option.value}
              onClick={() => setDraft(patchApplicationDraft(draft, { modernDomain: option.value }))}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      {sensitiveNotice ? (
        <p data-testid="apply-sensitive-notice" style={noticeStyle}>
          {sensitiveNotice}
        </p>
      ) : null}

      <Field
        disabled={disabled}
        label="What situation in your own life are you applying this to?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { situation: event.target.value }))}
        value={draft.situation}
      />

      <fieldset>
        <legend>What kind of response does this call for?</legend>
        <div role="group">
          {optionsFrom(RESPONSE_TYPES).map((option) => (
            <Chip
              active={draft.responseType === option.value}
              aria-pressed={draft.responseType === option.value}
              data-field="responseType"
              data-value={option.value}
              disabled={disabled}
              key={option.value}
              onClick={() => setDraft(patchApplicationDraft(draft, { responseType: option.value }))}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <Field
        disabled={disabled}
        label="What would a faithful response look like for you?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { faithfulResponse: event.target.value }))}
        value={draft.faithfulResponse}
      />
      <Field
        disabled={disabled}
        label="What cautions or guardrails do you want to keep in mind as you respond?"
        onChange={(event) => setDraft(patchApplicationDraft(draft, { cautions: event.target.value }))}
        value={draft.cautions}
      />

      {draftReadiness.missing.length > 0 ? (
        <ul aria-live="polite" data-testid="apply-missing-draft">
          {draftReadiness.missing.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      <p aria-live="polite" data-state={status} data-testid="apply-status">
        {message}
      </p>

      <Button
        data-action="save-draft"
        disabled={!draftReadiness.ready || disabled}
        onClick={() => submit("draft")}
        type="button"
        variant="secondary"
      >
        {status === "saving" ? "Saving…" : "Save draft"}
      </Button>
      <Button data-action="finalize" disabled={!finalReadiness.ready || disabled} onClick={() => submit("finalized")} type="button">
        Finalize
      </Button>
      {needsCautionsOnly ? (
        <ul aria-live="polite" data-testid="apply-missing-finalize">
          <li>{CAUTIONS_REASON}</li>
        </ul>
      ) : null}
    </div>
  );
}
