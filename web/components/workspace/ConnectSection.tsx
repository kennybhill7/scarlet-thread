"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import Link from "next/link";

import { humanizeToken, optionsFrom } from "@/components/study/ClaimComposer";
import { MotifRadarPanel } from "@/components/motif-radar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { PassagePicker, PassagePickerView } from "@/components/ui/PassagePicker";
import type { PassageCanon } from "@/lib/bible/passageCanon";
import {
  usePassageCanon,
  type PassageCanonState,
  type PassageCanonStore,
} from "@/lib/bible/passageCanonClient";
import { EMPTY_PICKER_STATE } from "@/lib/bible/passagePickerState";
import { formatCanonicalRangeKey } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { Thread } from "@/lib/contracts";
import type { CuratedConnection, PublishedLessonMatch } from "@/lib/content/publishedLessons";
import {
  CONNECTION_TYPES,
  type StudySession,
  type UserConnection,
} from "@/lib/contracts/study-v2";
import { saveLocalStudySession, saveLocalUserConnection } from "@/lib/sync/store";
import { registerForType } from "@/lib/workspace/connectionRegisters";
import {
  BLANK_CONNECTION_SELECTION,
  buildNoWarrantYetUpdate,
  buildUserConnectionDraft,
  CONNECTION_RATIONALE_MIN_LENGTH,
  connectionReadiness,
  evidenceLabelOptionsFor,
  resetConnectionFormDraft,
  selectConnectionType,
  selectEvidenceLabel,
  type ConnectionSelectionDraft,
} from "@/lib/workspace/renderState";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle, noticeStyle } from "./styles";

/**
 * CONNECTPANE-001 — BUILD_PLAN §4 row 4, "Connect — The Scarlet Thread Map".
 * Unlocked per the EXISTING gate (`lib/workspace/gating.ts`'s
 * `connect: hasAttemptedComparison(claims)`, untouched by this task) — a
 * context or interpretation claim exists for the session. Gated the SAME way
 * Observe/Context/Theology are (READGATE-001/CLAIMPANES-001 precedent): the
 * real, write-capable form does not mount before its own gate is met;
 * `LockedNotice` shows instead.
 *
 * ARCHITECTURALLY DISTINCT from Context/Theology/Conviction (CLAIMPANES-001):
 * this section does NOT mount `ClaimComposer` at all. It writes a
 * `UserConnection` — a different v2 entity (`lib/contracts/study-v2.ts`) —
 * through `saveLocalUserConnection`, or records an honest `no_warrant_yet`
 * outcome by updating the session's own `connectionState` through
 * `saveLocalStudySession`. Both are ALREADY-BUILT `lib/sync/store.ts`
 * writers (readOnlyPath here); no new write path, no new sync entity. All
 * payload-construction and selection mechanics live in
 * `lib/workspace/renderState.ts` (acceptance criterion 7) — this file is
 * markup plus local text-input state only.
 *
 * ---------------------------------------------------------------------------
 * THE CHECK-CONSTRAINT GUARANTEE (acceptance criterion 2) — read before
 * changing the evidence-label fieldset below.
 *
 * `db/schema.ts`'s `user_connections_personal_resonance_devotional_check`
 * rejects any `personal_resonance`-typed row whose `evidenceLabel` is not
 * `"devotional"`. This UI makes that combination structurally impossible to
 * submit, THREE independent ways, not just one:
 *
 *   1. RENDER-SIDE NARROWING: the evidence-label chip fieldset below calls
 *      `optionsFrom(evidenceLabelOptionsFor(selection.type))`, never the bare
 *      `EVIDENCE_LABELS` array. The moment `type` is `"personal_resonance"`,
 *      `evidenceLabelOptionsFor` returns exactly `["devotional"]` — the ONLY
 *      chip that exists in the DOM. A learner cannot click a chip that was
 *      never rendered.
 *   2. AUTO-LOCK, VISIBLY: `selectConnectionType` (renderState.ts) force-sets
 *      `evidenceLabel` to `"devotional"` the instant `type` becomes
 *      `personal_resonance`, in the SAME update — and the fieldset below
 *      renders an explicit, visible notice
 *      (`data-testid="personal-resonance-devotional-lock"`) explaining that
 *      the lock happened, rather than silently pre-selecting it with no
 *      explanation. Chosen over "filtering only" because a learner who
 *      already had a different label selected before switching to
 *      `personal_resonance` should see the label actually change, not just
 *      see it become the only option available.
 *   3. BUILDER-SIDE THROW: `buildUserConnectionDraft` re-checks
 *      `isPersonalResonanceEvidenceLabelValid` before constructing the record
 *      at all and throws rather than building an invalid one — belt-and-
 *      suspenders for any future caller that bypasses this component's own
 *      render tree.
 *
 * `tests/connect-pane.test.ts` proves all three layers independently, plus
 * `saveLocalUserConnection` itself validates against
 * `syncUserConnectionV2Schema`'s own `superRefine` (a fourth, pre-existing
 * layer this task did not have to build — see `lib/sync/store.ts`'s
 * `saveLocalV2Entity`).
 * ---------------------------------------------------------------------------
 *
 * NO_WARRANT_YET (acceptance criterion 3) — see
 * `lib/workspace/renderState.ts`'s `buildNoWarrantYetUpdate` header comment
 * for the full design decision and its defense (a `StudySession.
 * connectionState` transition, nothing more — the literal already existed,
 * unused, in `STUDY_SESSION_CONNECTION_STATES`). Presented below as a
 * first-class alternative action, not a workaround buried behind the typed
 * form: its own panel, its own button, always available once this section is
 * unlocked, requiring none of the typed-connection fields.
 *
 * MOTIFS / CURATED CONNECTIONS / USER THREADS (acceptance criterion 4):
 *   - Motif candidates: `MotifRadarPanel` (`components/motif-radar.tsx`,
 *     RADARUI-001, unmodified) is mounted directly — the app's own radar,
 *     reused rather than reimplemented.
 *   - Curated connections (CONNECTIONCURATION-001, 2026-09-18): when
 *     `curatedLesson?.curatedConnections` (`lib/content/publishedLessons.ts`
 *     — real `graph_edges` rows resolved from this lesson's own
 *     `connectionIds[]`, joined to `sources` for citation) is non-empty,
 *     each one renders — both passages, its type, its evidence label, and
 *     its source citation when the edge's `sourceId` resolved — INSTEAD OF
 *     the fixed `data-testid="connect-no-curated-notice"` notice below,
 *     exactly the `ContextSection.tsx` precedent this file's own header cited
 *     as "no pipeline exists yet" before this task closed that gap. A lesson
 *     with no `curatedLesson`, or one whose `curatedConnections` resolved to
 *     `[]` (no `connectionIds[]` authored, or every id failed to resolve),
 *     renders the ORIGINAL fixed notice unchanged — a real regression guard,
 *     proven in `tests/workspace-shell.test.ts`. Curated connections
 *     supplement the learner's own comparison, never replace it: the real,
 *     write-capable form below (and the "No warrant yet" panel) always mounts
 *     regardless of whether curated connections exist, same "supplements,
 *     never replaces" discipline `ContextSection.tsx`'s header states.
 *   - User threads: v1 threads are real, so `GET /api/threads` (the existing,
 *     already-authenticated route `app/api/threads/route.ts` — no new API
 *     added here) is fetched client-side, mirroring `MotifRadarPanel`'s own
 *     `fetchImpl` pattern for testability, and surfaced as selectable chips
 *     (`UserThreadsPanel`, below) so a learner may optionally link a saved
 *     connection to one of their own real existing threads via
 *     `UserConnection.threadSlug`.
 *
 * RANGE ENTRY (acceptance criterion 1; RANGEPICKER-002) — the learner CHOOSES
 * the other passage (book, chapter, from verse, to chapter, to verse) with
 * `components/ui/PassagePicker.tsx` (native selects, `allowCrossChapter` so
 * Gen 1:1–2:3 works) instead of typing "book.chapter.verse" keys. The picker
 * emits a `CanonicalRangeV1 | null` already bounded by the real canon, and that
 * value feeds `connectionReadiness` / `buildUserConnectionDraft` unchanged, so
 * the saved `UserConnection` has exactly the shape it had before. The canon
 * (verse counts for all 66 books) is loaded lazily, inside this section, by
 * `lib/bible/passageCanonClient.ts`; `ConnectRangeField` below renders the
 * loading / error / ready states. The picker is uncontrolled, so a successful
 * save bumps its `key` (see `resetConnectionFormDraft`) to blank it.
 * `parseTypedRange` (renderState.ts) is no longer called from here.
 */

const rangeFieldStyle: CSSProperties = {
  marginBottom: 12,
};

// Reserved status line under the picker: same height whether it says
// "Loading…" or nothing, so the ready state does not shift the form.
const canonStatusStyle: CSSProperties = {
  minHeight: 20,
  margin: "6px 0 0",
  fontSize: 12.5,
  lineHeight: 1.4,
  color: "var(--shell-muted-2)",
};

const fieldsetStyle: CSSProperties = {
  border: "none",
  padding: 0,
  margin: "0 0 14px",
};

const legendStyle: CSSProperties = {
  fontSize: 12.5,
  fontFamily: "var(--font-label)",
  fontWeight: 600,
  marginBottom: 6,
  padding: 0,
};

const chipsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const panelStyle: CSSProperties = {
  border: "1px solid var(--shell-border)",
  borderRadius: 8,
  padding: "10px 12px",
  marginBottom: 14,
};

// ---------------------------------------------------------------------------
// CONNECTIONCURATION-001 — curated-connection row styles. Same visual shape
// (row list, a header line carrying type/evidenceLabel, a ranges line) as
// `ThreadDetail.tsx`'s own `ConnectionsPanel` uses for USER connections, but
// built from THIS file's own `--shell-*` custom properties rather than
// `ThreadDetail.tsx`'s `--page-*`/`--crimson`/`--brass` tokens — the two
// files are different visual systems (this one the dark Passage Workspace
// shell, that one the thread browse page), so the tokens are not portable,
// only the row shape is.
// ---------------------------------------------------------------------------

const curatedConnectionListStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const curatedConnectionRowStyle: CSSProperties = {
  border: "1px solid var(--shell-border)",
  borderRadius: 8,
  padding: "8px 10px",
  display: "grid",
  gap: 6,
};

const curatedConnectionHeaderStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  fontFamily: "var(--font-label)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--gold)",
};

const curatedConnectionRangesStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  fontSize: 13,
  color: "var(--shell-text)",
};

const curatedConnectionRationaleStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--shell-text)",
};

const curatedConnectionSourceStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--shell-muted-2)",
};

// ---------------------------------------------------------------------------
// Result of a save — a discriminated union because the two Connect actions
// (typed connection vs. no_warrant_yet) write different records.
// ---------------------------------------------------------------------------

export type ConnectSectionSavedResult =
  | { kind: "connection"; connection: UserConnection }
  | { kind: "no_warrant_yet"; session: StudySession };

// ---------------------------------------------------------------------------
// CuratedConnectionRow — one resolved `graph_edges` row, rendered read-only.
// Hookless, like `EvidenceLabelField` above, so it stays a plain function a
// test can call directly and inspect (same technique `ClaimComposer.tsx`'s
// `PromoteFields` and `EvidenceLabelField` above already establish).
// ---------------------------------------------------------------------------

/**
 * CURATEDEDGES-002 — the ONE place the word "Reviewed" may be chosen for the
 * curated-connections panel. `connections` is what the panel is about to
 * show; the panel-level heading copy says "Reviewed" only when the list is
 * non-empty and EVERY row is positively `reviewStatus === "reviewed"`
 * (`resolveCuratedConnections` maps anything else, including a missing
 * column, to `"imported"`). One bulk-imported row anywhere in the list makes
 * the whole heading neutral, and the neutral copy deliberately contains no
 * "review" wording at all. Exported so tests can prove the rule directly.
 */
export function curatedConnectionsHeadingCopy(connections: readonly CuratedConnection[]): {
  allReviewed: boolean;
  text: string;
} {
  const allReviewed = connections.length > 0 && connections.every((connection) => connection.reviewStatus === "reviewed");
  return {
    allReviewed,
    text: allReviewed
      ? "Reviewed connections for this passage, each authored with a stated reason and source — supplementing your own comparison below, never replacing it."
      : "Connections for this passage from this app’s cross-reference graph. Each one below states where it comes from — supplementing your own comparison below, never replacing it.",
  };
}

export function CuratedConnectionRow({ connection }: { connection: CuratedConnection }) {
  const reviewed = connection.reviewStatus === "reviewed";
  return (
    <li
      data-testid="connect-curated-connection"
      data-review-status={reviewed ? "reviewed" : "imported"}
      style={curatedConnectionRowStyle}
    >
      <div style={curatedConnectionHeaderStyle}>
        <span data-field="type">{humanizeToken(connection.type)}</span>
        <span data-field="evidenceLabel">{humanizeToken(connection.evidenceLabel)}</span>
      </div>
      <div data-testid="connect-curated-connection-ranges" style={curatedConnectionRangesStyle}>
        <span data-field="fromRange">{formatCanonicalRangeKey(connection.fromRange)}</span>
        <span aria-hidden="true">&harr;</span>
        <span data-field="toRange">{formatCanonicalRangeKey(connection.toRange)}</span>
      </div>
      <p data-testid="connect-curated-connection-provenance" style={curatedConnectionSourceStyle}>
        <span data-field="provenance">{reviewed ? "Reviewed connection" : "Imported cross-reference"}</span>
        {" · Evidence label: "}
        <span data-field="provenanceEvidenceLabel">{humanizeToken(connection.evidenceLabel)}</span>
      </p>
      {connection.rationale ? (
        <p data-testid="connect-curated-connection-rationale" style={curatedConnectionRationaleStyle}>
          {connection.rationale}
        </p>
      ) : null}
      {connection.source ? (
        <p data-testid="connect-curated-connection-source" style={curatedConnectionSourceStyle}>
          {connection.source.author}, &ldquo;
          <a href={connection.source.url} rel="noreferrer" target="_blank">
            {connection.source.title}
          </a>
          &rdquo;
        </p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// EvidenceLabelField — HOOKLESS, deliberately (exactly ClaimComposer.tsx's
// own `PromoteFields` precedent), so a test can call it directly as a plain
// function and inspect the real returned element tree — the same technique
// tests/claim-panes.test.ts's own MUTATION-TARGET section uses for
// `PromoteFields`. This is the piece of markup the CHECK-constraint
// guarantee's render-side narrowing lives in.
// ---------------------------------------------------------------------------

export interface EvidenceLabelFieldProps {
  selection: ConnectionSelectionDraft;
  disabled: boolean;
  onSelectionChange: (next: ConnectionSelectionDraft) => void;
}

export function EvidenceLabelField({ selection, disabled, onSelectionChange }: EvidenceLabelFieldProps) {
  const options = evidenceLabelOptionsFor(selection.type);
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>What evidence label fits your rationale?</legend>
      {selection.type === "personal_resonance" ? (
        <p style={noticeStyle} data-testid="personal-resonance-devotional-lock">
          Personal-resonance connections are always labeled &ldquo;devotional&rdquo; — locked automatically the
          moment you chose that type, not a choice left open here.
        </p>
      ) : null}
      <div style={chipsRowStyle} role="group">
        {optionsFrom(options).map((option) => (
          <Chip
            active={selection.evidenceLabel === option.value}
            aria-pressed={selection.evidenceLabel === option.value}
            data-field="evidenceLabel"
            data-value={option.value}
            disabled={disabled}
            key={option.value}
            onClick={() => onSelectionChange(selectEvidenceLabel(selection, option.value))}
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// UserThreadsPanel — real v1 threads, fetched client-side. Same shape as
// MotifRadarPanel.tsx's own loading/error/ready states and `fetchImpl` test
// seam, deliberately, rather than a new pattern.
// ---------------------------------------------------------------------------

type ThreadsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; threads: Thread[] };

type FetchImpl = typeof fetch;

async function loadThreads(fetchImpl: FetchImpl): Promise<Thread[]> {
  const response = await fetchImpl("/api/threads");
  if (!response.ok) {
    throw new Error(`Could not load your threads (status ${response.status}).`);
  }
  const body = (await response.json()) as { data: Thread[] };
  return body.data;
}

export interface UserThreadsPanelProps {
  selected: string | null;
  onSelect: (slug: string | null) => void;
  fetchImpl?: FetchImpl;
}

export function UserThreadsPanel({ selected, onSelect, fetchImpl = fetch }: UserThreadsPanelProps) {
  const [state, setState] = useState<ThreadsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadThreads(fetchImpl)
      .then((threads) => {
        if (!cancelled) setState({ status: "ready", threads });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load your threads.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  return (
    <section aria-label="Your existing threads" style={panelStyle} data-testid="connect-user-threads">
      <p style={legendStyle}>Your threads</p>
      <p style={noticeStyle}>
        Real threads you have already started — optionally link this connection to one. Linking is not required.
      </p>
      {state.status === "loading" ? <p style={noticeStyle}>Checking your threads…</p> : null}
      {state.status === "error" ? (
        <p style={noticeStyle} role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "ready" && state.threads.length === 0 ? (
        <p style={noticeStyle}>No threads on this device yet.</p>
      ) : null}
      {state.status === "ready" && state.threads.length > 0 ? (
        <div style={chipsRowStyle}>
          {state.threads.map((thread) => (
            <Chip
              active={selected === thread.slug}
              aria-pressed={selected === thread.slug}
              data-field="threadSlug"
              data-value={thread.slug}
              key={thread.slug}
              onClick={() => onSelect(selected === thread.slug ? null : thread.slug)}
            >
              {thread.title}
            </Chip>
          ))}
        </div>
      ) : null}
      {state.status === "ready" && selected ? (
        <p style={noticeStyle}>
          Linked to <Link href={`/threads/${selected}`}>{selected}</Link>.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ConnectRangeField — the "other passage" picker and its canon-loading states.
// HOOKLESS (like EvidenceLabelField): props in, markup out, so a test renders
// every state directly. The canon is the one thing the picker cannot render
// without; until it is `ready` the SAME picker markup is shown with an empty
// canon and every select disabled (identical box, so nothing jumps when the
// canon arrives), and the reserved status line below says why.
// ---------------------------------------------------------------------------

const NO_CANON: PassageCanon = [];
const RANGE_LABEL = "Other passage";

export interface ConnectRangeFieldProps {
  canonState: PassageCanonState;
  onRetry: () => void;
  /** React `key` of the (uncontrolled) picker — bumped by a successful save to blank it. */
  pickerKey: number;
  disabled: boolean;
  onChange: (range: CanonicalRangeV1 | null) => void;
}

export function ConnectRangeField({ canonState, onRetry, pickerKey, disabled, onChange }: ConnectRangeFieldProps) {
  return (
    <div data-field="toRange" data-canon-state={canonState.status} style={rangeFieldStyle}>
      {canonState.status === "ready" ? (
        <PassagePicker
          allowCrossChapter
          canon={canonState.canon}
          disabled={disabled}
          key={pickerKey}
          label={RANGE_LABEL}
          onChange={onChange}
          surface="shell"
        />
      ) : (
        <PassagePickerView
          allowCrossChapter
          canon={NO_CANON}
          disabled
          idPrefix="connect-to-range-pending"
          label={RANGE_LABEL}
          state={EMPTY_PICKER_STATE}
          surface="shell"
        />
      )}
      <div aria-live="polite" data-testid="connect-range-canon-status" style={canonStatusStyle}>
        {canonState.status === "idle" || canonState.status === "loading" ? "Loading the Bible index…" : null}
        {canonState.status === "error" ? (
          <>
            <span role="alert">{canonState.message}</span>{" "}
            <Button data-testid="connect-range-retry" onClick={onRetry} type="button" variant="secondary">
              Try again
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The stateful shell
// ---------------------------------------------------------------------------

export interface ConnectSectionProps {
  workspaceId: string;
  session: StudySession;
  unlocked: boolean;
  onSaved: (result: ConnectSectionSavedResult) => void;
  /** Test seam only, mirrors MotifRadarPanel's own `fetchImpl` prop. Omitted, real `fetch` is used. */
  fetchImpl?: FetchImpl;
  /**
   * CONNECTIONCURATION-001 — the one published lesson (if any) covering this
   * session's range, threaded through by `WorkspaceShell` exactly like
   * `ContextSection`/`TheologySection`/`ApplySection`/`TeachSection` already
   * receive it. `curatedLesson?.curatedConnections` (empty array for every
   * lesson with no `connectionIds[]`, or none that resolved) decides whether
   * this section's fixed "no curated connections yet" notice or the real
   * resolved rows render — see this file's header comment. Optional,
   * defaulting to `null`: every session with no lesson, or a lesson with zero
   * curated connections, renders exactly as this section did before this
   * task — a real regression guard, proven in `tests/workspace-shell.test.ts`.
   */
  curatedLesson?: PublishedLessonMatch | null;
  /** Test seam only: inject the passage-canon store (see `lib/bible/passageCanonClient.ts`). Omitted, the app-wide store loads the real corpus. */
  canonStore?: PassageCanonStore;
}

export function ConnectSection({
  workspaceId,
  session,
  unlocked,
  onSaved,
  fetchImpl = fetch,
  curatedLesson = null,
  canonStore,
}: ConnectSectionProps) {
  const canon = usePassageCanon({ enabled: unlocked, store: canonStore });

  const [selection, setSelection] = useState<ConnectionSelectionDraft>(BLANK_CONNECTION_SELECTION);
  const [toRange, setToRange] = useState<CanonicalRangeV1 | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [rationale, setRationale] = useState("");
  const [threadSlug, setThreadSlug] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [warrantStatus, setWarrantStatus] = useState<"idle" | "saving" | "saved" | "error">(
    session.connectionState === "no_warrant_yet" ? "saved" : "idle",
  );
  const [warrantMessage, setWarrantMessage] = useState(
    session.connectionState === "no_warrant_yet"
      ? "Already recorded for this session: no warrant yet."
      : "",
  );

  if (!unlocked) {
    return (
      <LockedNotice
        testId="connect-locked"
        message="Locked until you attempt a comparison — a context or interpretation claim above. Use Context or Theology first, then this section opens."
      />
    );
  }

  const readiness = connectionReadiness({ toRange, selection, rationale });
  const curatedConnections = curatedLesson?.curatedConnections ?? [];

  async function submitConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readiness.ready || !toRange || status === "saving") return;

    setStatus("saving");
    setMessage("Saving to this device…");
    const now = new Date().toISOString();

    try {
      const connection = buildUserConnectionDraft({
        id: crypto.randomUUID(),
        workspaceId,
        fromRange: session.range,
        toRange,
        selection,
        rationale,
        threadSlug,
        now,
      });
      await saveLocalUserConnection(connection);

      setStatus("saved");
      setMessage("Saved to this device.");
      const blank = resetConnectionFormDraft(pickerKey);
      setSelection(blank.selection);
      setToRange(blank.toRange);
      setPickerKey(blank.pickerKey);
      setRationale(blank.rationale);
      setThreadSlug(blank.threadSlug);
      onSaved({ kind: "connection", connection });
    } catch {
      setStatus("error");
      setMessage("This device could not save the connection. Nothing was discarded — please try again.");
    }
  }

  async function recordNoWarrantYet() {
    if (warrantStatus === "saving") return;
    setWarrantStatus("saving");
    setWarrantMessage("Saving to this device…");
    const now = new Date().toISOString();
    try {
      const updated = buildNoWarrantYetUpdate(session, now);
      await saveLocalStudySession(updated);
      setWarrantStatus("saved");
      setWarrantMessage(
        "Recorded: no warrant yet. Declining is an honest outcome here, not a failure — your comparison attempt is what mattered.",
      );
      onSaved({ kind: "no_warrant_yet", session: updated });
    } catch {
      setWarrantStatus("error");
      setWarrantMessage("This device could not record that — please try again.");
    }
  }

  return (
    <div style={bodyStyle}>
      {curatedConnections.length > 0 ? (
        <section aria-label="Curated connections" style={panelStyle} data-testid="connect-curated-connections">
          <p style={legendStyle}>Curated connections</p>
          <p data-testid="connect-curated-heading-copy" style={noticeStyle}>
            {curatedConnectionsHeadingCopy(curatedConnections).text}
          </p>
          <ul style={curatedConnectionListStyle}>
            {curatedConnections.map((connection) => (
              <CuratedConnectionRow connection={connection} key={connection.id} />
            ))}
          </ul>
        </section>
      ) : (
        <p style={noticeStyle} data-testid="connect-no-curated-notice">
          No curated connections yet for this passage — Phase 1&rsquo;s curated connections tables have not been
          built. What follows is your own comparison, typed and evidence-labeled in your own words.
        </p>
      )}

      <section aria-label="What the app's own radar has noticed" style={panelStyle}>
        <p style={legendStyle}>Suggested by your own repetition</p>
        <MotifRadarPanel fetchImpl={fetchImpl} />
      </section>

      <UserThreadsPanel fetchImpl={fetchImpl} onSelect={setThreadSlug} selected={threadSlug} />

      <form data-testid="connect-form" onSubmit={submitConnection}>
        <header>
          <p style={legendStyle}>CONNECT</p>
          <h2>Compare this passage with another</h2>
          <span data-testid="connect-from-range">{formatCanonicalRangeKey(session.range)}</span>
        </header>

        <ConnectRangeField
          canonState={canon}
          disabled={status === "saving"}
          onChange={setToRange}
          onRetry={canon.retry}
          pickerKey={pickerKey}
        />

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>What kind of connection is this?</legend>
          {/* CONNREGISTERS-001 -- a light styling touch only (structural
              register types pick up the same `tone="structural"` Chip now
              carries in ThreadDetail's browse/filter view, for visual
              consistency between composing and browsing a connection). The
              set of options offered and the selection logic below are both
              completely untouched -- out of scope for that task, per its own
              header. */}
          <div style={chipsRowStyle} role="group">
            {optionsFrom(CONNECTION_TYPES).map((option) => (
              <Chip
                active={selection.type === option.value}
                aria-pressed={selection.type === option.value}
                data-field="type"
                data-value={option.value}
                disabled={status === "saving"}
                key={option.value}
                onClick={() => setSelection(selectConnectionType(selection, option.value))}
                tone={registerForType(option.value) === "structural" ? "structural" : "gold"}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </fieldset>

        <EvidenceLabelField disabled={status === "saving"} onSelectionChange={setSelection} selection={selection} />

        <Field
          disabled={status === "saving"}
          hint={`Your own words — at least ${CONNECTION_RATIONALE_MIN_LENGTH} characters. Why does this connection hold, in your own reasoning?`}
          id="connect-rationale"
          label="Your rationale"
          onChange={(event) => setRationale(event.target.value)}
          value={rationale}
        />

        {readiness.missing.length > 0 ? (
          <ul aria-live="polite" data-testid="connect-missing">
            {readiness.missing.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <footer>
          <p aria-live="polite" data-state={status}>
            {message}
          </p>
          <Button disabled={!readiness.ready || status === "saving"} type="submit" variant="actionRow">
            {status === "saving" ? "Saving…" : "Save connection"}
          </Button>
        </footer>
      </form>

      <div data-testid="no-warrant-yet-panel" style={panelStyle}>
        <p style={legendStyle}>No warrant yet</p>
        <p style={noticeStyle}>
          You compared this passage and did not find a connection you can warrant yet. That is an honest outcome —
          the app does not require you to invent one.
        </p>
        <Button
          disabled={warrantStatus === "saving"}
          onClick={() => void recordNoWarrantYet()}
          type="button"
          variant="secondary"
        >
          {warrantStatus === "saving" ? "Saving…" : "No warrant yet"}
        </Button>
        <p aria-live="polite" data-state={warrantStatus}>
          {warrantMessage}
        </p>
      </div>
    </div>
  );
}
