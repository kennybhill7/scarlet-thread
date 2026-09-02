"use client";

import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";

import Link from "next/link";

import { optionsFrom } from "@/components/study/ClaimComposer";
import { MotifRadarPanel } from "@/components/motif-radar";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { formatCanonicalRangeKey } from "@/lib/bible/range";
import type { Thread } from "@/lib/contracts";
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
  parseTypedRange,
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
 *   - Curated connections: no curated-connections content or pipeline exists
 *     yet (same situation CLAIMPANES-001 found for passage_contexts/
 *     doctrines) — an honest notice renders instead of fabricating any.
 *   - User threads: v1 threads are real, so `GET /api/threads` (the existing,
 *     already-authenticated route `app/api/threads/route.ts` — no new API
 *     added here) is fetched client-side, mirroring `MotifRadarPanel`'s own
 *     `fetchImpl` pattern for testability, and surfaced as selectable chips
 *     (`UserThreadsPanel`, below) so a learner may optionally link a saved
 *     connection to one of their own real existing threads via
 *     `UserConnection.threadSlug`.
 *
 * RANGE ENTRY (acceptance criterion 1) — see `parseTypedRange`'s own header
 * comment in `lib/workspace/renderState.ts` for why this reuses the existing
 * canonical-key TEXT form (`book.chapter.verse`) rather than inventing a new
 * verse-picker widget: no reusable picker exists anywhere in this codebase
 * (grepped, not assumed), and this exact text form is already what
 * `ClaimComposer.tsx`'s own header shows a learner today.
 */

const inputStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: 13,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--shell-border)",
  background: "var(--shell-bg)",
  color: "var(--shell-text)",
  width: "100%",
};

const inputLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "var(--shell-muted-2)",
  fontFamily: "var(--font-label)",
};

const rangeRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  marginBottom: 12,
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
// Result of a save — a discriminated union because the two Connect actions
// (typed connection vs. no_warrant_yet) write different records.
// ---------------------------------------------------------------------------

export type ConnectSectionSavedResult =
  | { kind: "connection"; connection: UserConnection }
  | { kind: "no_warrant_yet"; session: StudySession };

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
// The stateful shell
// ---------------------------------------------------------------------------

export interface ConnectSectionProps {
  workspaceId: string;
  session: StudySession;
  unlocked: boolean;
  onSaved: (result: ConnectSectionSavedResult) => void;
  /** Test seam only, mirrors MotifRadarPanel's own `fetchImpl` prop. Omitted, real `fetch` is used. */
  fetchImpl?: FetchImpl;
}

export function ConnectSection({ workspaceId, session, unlocked, onSaved, fetchImpl = fetch }: ConnectSectionProps) {
  const startId = useId();
  const endId = useId();

  const [selection, setSelection] = useState<ConnectionSelectionDraft>(BLANK_CONNECTION_SELECTION);
  const [toStart, setToStart] = useState("");
  const [toEnd, setToEnd] = useState("");
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

  const toRange = parseTypedRange(toStart, toEnd);
  const readiness = connectionReadiness({ toRange, selection, rationale });

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
      setSelection(BLANK_CONNECTION_SELECTION);
      setToStart("");
      setToEnd("");
      setRationale("");
      setThreadSlug(null);
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
      <p style={noticeStyle} data-testid="connect-no-curated-notice">
        No curated connections yet for this passage — Phase 1&rsquo;s curated connections tables have not been
        built. What follows is your own comparison, typed and evidence-labeled in your own words.
      </p>

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

        <div style={rangeRowStyle}>
          <label htmlFor={startId} style={inputLabelStyle}>
            Other passage — start (book.chapter.verse)
            <input
              disabled={status === "saving"}
              id={startId}
              data-field="toRangeStart"
              onChange={(event) => setToStart(event.target.value)}
              placeholder="e.g. 1.3.15"
              style={inputStyle}
              value={toStart}
            />
          </label>
          <label htmlFor={endId} style={inputLabelStyle}>
            Other passage — end (book.chapter.verse)
            <input
              disabled={status === "saving"}
              id={endId}
              data-field="toRangeEnd"
              onChange={(event) => setToEnd(event.target.value)}
              placeholder="e.g. 1.3.15"
              style={inputStyle}
              value={toEnd}
            />
          </label>
        </div>
        {(toStart.trim() || toEnd.trim()) && !toRange ? (
          <p style={noticeStyle} data-testid="connect-range-invalid">
            Not a valid range yet — both boundaries must be well-formed book.chapter.verse keys, in the same book,
            start on or before end.
          </p>
        ) : null}

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
