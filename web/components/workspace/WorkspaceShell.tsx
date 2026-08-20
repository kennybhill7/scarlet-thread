"use client";

import { useState, type CSSProperties } from "react";

import Link from "next/link";

import { ClaimComposer } from "@/components/study";
import type { ClaimComposerSavedResult } from "@/components/study";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";
import { saveLocalStudySession } from "@/lib/sync/store";
import type { WorkspaceGatingInput } from "@/lib/workspace/gating";
import {
  buildReadGateUpdate,
  computeWorkspaceSectionsFromSession,
  isPassageMarkedRead,
  readLinkParams,
  type SectionRenderState,
} from "@/lib/workspace/renderState";

/**
 * WORKSPACESHELL-001 — the Phase 2 Passage Workspace shell (BUILD_PLAN §4):
 * one accordion, eight sections (Read, Observe, Context, Connect, Theology,
 * Conviction, Apply, Teach), each carrying its own BUILD_PLAN product name,
 * mounted at `app/(app)/study/[sessionId]/page.tsx` in place of the bare
 * `ClaimComposer` STUDYPAGE-001 mounted directly.
 *
 * NO `.module.css` IMPORT, DELIBERATELY: `tests/study-page.test.ts` (frozen,
 * read-only here) loads the REAL `page.tsx` under plain `node:test` (no
 * bundler, no jsdom) and stubs only a fixed, exhaustive list of CSS Modules
 * — its own, plus `ClaimComposer`'s four. `tsx --test` cannot parse a real
 * `.css` file (see that file's own header comment and
 * `tests/protected-integrations.test.ts`'s), so any NEW `.module.css` this
 * component imported would break every test in that frozen file the moment
 * `page.tsx` started importing this component — with no way to fix it,
 * since that test file cannot be edited here. Styling instead uses inline
 * `style` objects referencing this app's existing GLOBAL CSS custom
 * properties (`app/globals.css` — `--shell-*`, `--gold`; not a module, so no
 * import is needed at all), which is a real, disclosed trade against this
 * shell's visual polish, not an oversight.
 *
 * GATING VS. CONTENT — see `lib/workspace/renderState.ts`'s own header
 * comment for the full reasoning: `unlocked` drives ONLY the "why locked"
 * notice and which section starts expanded. It never removes a section's
 * real content from the page. Concretely, that means:
 *   - Read is always open (never gated).
 *   - Observe ALWAYS mounts the real, unmodified `ClaimComposer` — gating it
 *     on `readGateAt` would strand every session `StudyEntry.tsx` creates
 *     today (`currentStep: "observe"`, `readGateAt: null`, in the same
 *     object literal) at the very first screen, and would break
 *     `tests/study-page.test.ts`'s frozen happy-path assertion that the
 *     real composer renders for exactly that fixture.
 *   - Context/Connect/Theology/Conviction/Apply/Teach ALWAYS render an
 *     honest "not built yet" placeholder (acceptance criterion 6) — that is
 *     the entirety of their content in this task, locked or not. Building
 *     their real functionality is deliberately OUT of this task's scope;
 *     see this task's commit message.
 */

const sectionStyle: CSSProperties = {
  border: "1px solid var(--shell-border)",
  borderRadius: 8,
  marginBottom: 12,
  padding: "4px 14px",
  background: "var(--shell-bg)",
  color: "var(--shell-text)",
};

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  padding: "10px 0",
  fontFamily: "var(--font-label)",
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const productNameStyle: CSSProperties = {
  color: "var(--shell-muted-2)",
  fontWeight: 400,
};

const lockBadgeStyle: CSSProperties = {
  marginLeft: 8,
  color: "var(--gold)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const noticeStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--shell-muted-2)",
  borderLeft: "2px solid var(--gold)",
  padding: "4px 10px",
  margin: "0 0 12px",
};

const placeholderStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--shell-muted)",
  padding: "4px 0 14px",
};

const bodyStyle: CSSProperties = {
  padding: "0 0 14px",
};

export interface WorkspaceShellProps {
  /** The caller's own workspace id, resolved server-side (see page.tsx). Passed straight through to ClaimComposer, unmodified. */
  workspaceId: string;
  session: StudySession;
  /** This session's own claims, for gating. Empty is a valid, honest state — see this task's commit message for what does/does not fetch this today. */
  claims?: StudyClaim[];
  applications?: Application[];
}

function ReadSection({
  session,
  onMarkedRead,
}: {
  session: StudySession;
  onMarkedRead: (updated: StudySession) => void;
}) {
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  const linkParams = readLinkParams(session.range);
  const alreadyRead = isPassageMarkedRead(session);

  async function markRead() {
    setMarking(true);
    setError("");
    try {
      const updated = buildReadGateUpdate(session, new Date().toISOString());
      await saveLocalStudySession(updated);
      onMarkedRead(updated);
    } catch {
      setError(
        "This device could not save your reading progress. Nothing else here is affected; please try again.",
      );
    } finally {
      setMarking(false);
    }
  }

  return (
    <div style={bodyStyle}>
      {linkParams ? (
        <p>
          <Link href={`/read/${linkParams.book}/${linkParams.chapter}`}>Open this passage in the reader</Link>
        </p>
      ) : null}
      {alreadyRead ? (
        <p data-testid="read-gate-set">Marked read on {session.readGateAt}.</p>
      ) : (
        <button type="button" onClick={() => void markRead()} disabled={marking} data-testid="mark-read-button">
          {marking ? "Saving…" : "Mark this passage as read"}
        </button>
      )}
      {error ? (
        <p role="alert" data-testid="mark-read-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PlaceholderSection({ section }: { section: SectionRenderState }) {
  return (
    <p style={placeholderStyle} data-testid={`placeholder-${section.step}`}>
      Not built yet. {section.productName} is planned as its own follow-up task, once this
      workspace shell&rsquo;s contract is proven stable. Nothing on this screen represents{" "}
      {section.label.toLowerCase()} work you have not actually done.
    </p>
  );
}

export function WorkspaceShell({
  workspaceId,
  session: initialSession,
  claims: initialClaims = [],
  applications = [],
}: WorkspaceShellProps) {
  const [session, setSession] = useState(initialSession);
  const [claims, setClaims] = useState(initialClaims);

  const gatingInput: WorkspaceGatingInput = { session, claims, applications };
  const sections = computeWorkspaceSectionsFromSession(session, gatingInput);

  function handleClaimSaved(result: ClaimComposerSavedResult) {
    setSession(result.session);
    setClaims((previous) => [...previous, result.claim]);
  }

  return (
    <div data-testid="workspace-shell">
      {sections.map((section) => (
        <details key={section.step} open={section.expanded} style={sectionStyle} data-testid={`section-${section.step}`}>
          <summary style={summaryStyle}>
            {section.label} <span style={productNameStyle}>— {section.productName}</span>
            {!section.unlocked ? <span style={lockBadgeStyle}>Locked</span> : null}
          </summary>
          {!section.unlocked ? (
            <p style={noticeStyle} data-testid={`lock-notice-${section.step}`}>
              {section.lockExplanation}
            </p>
          ) : null}
          {section.contentMode === "read" ? (
            <ReadSection session={session} onMarkedRead={setSession} />
          ) : null}
          {section.contentMode === "observe" ? (
            <div style={bodyStyle}>
              <ClaimComposer
                workspaceId={workspaceId}
                range={session.range}
                session={session}
                onSaved={handleClaimSaved}
              />
            </div>
          ) : null}
          {section.contentMode === "placeholder" ? <PlaceholderSection section={section} /> : null}
        </details>
      ))}
    </div>
  );
}
