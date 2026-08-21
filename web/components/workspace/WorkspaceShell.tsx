"use client";

import { useState } from "react";

import type { ClaimComposerSavedResult } from "@/components/study";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";
import type { WorkspaceGatingInput } from "@/lib/workspace/gating";
import { computeWorkspaceSectionsFromSession } from "@/lib/workspace/renderState";

import { ConnectSection, type ConnectSectionSavedResult } from "./ConnectSection";
import { ContextSection } from "./ContextSection";
import { ConvictionSection } from "./ConvictionSection";
import { ObserveSection } from "./ObserveSection";
import { PlaceholderSection } from "./PlaceholderSection";
import { ReadSection } from "./ReadSection";
import { lockBadgeStyle, noticeStyle, productNameStyle, sectionStyle, summaryStyle } from "./styles";
import { TheologySection } from "./TheologySection";

/**
 * WORKSPACESHELL-001 — the Phase 2 Passage Workspace shell (BUILD_PLAN §4):
 * one accordion, eight sections (Read, Observe, Context, Connect, Theology,
 * Conviction, Apply, Teach), each carrying its own BUILD_PLAN product name,
 * mounted at `app/(app)/study/[sessionId]/page.tsx` in place of the bare
 * `ClaimComposer` STUDYPAGE-001 mounted directly.
 *
 * CLAIMPANES-001 REFACTOR (acceptance criterion 1): this file previously
 * inlined all eight sections' markup directly. Each is now its own file
 * under `components/workspace/` (`ReadSection`, `ObserveSection`,
 * `ContextSection`, `TheologySection`, `ConvictionSection`, and the shared
 * `PlaceholderSection` for whatever remains stubbed — Apply/Teach, as of
 * CONNECTPANE-001). This file keeps only the accordion shell and the
 * per-section dispatch, so later tasks building Connect/Apply/Teach each own
 * one new file instead of three tasks all editing this same component. Every
 * existing behavior (gating, expand-on-current-step, Read and Observe
 * exactly as READGATE-001 left them) is unchanged by this extraction —
 * proven by running the pre-existing test suite unmodified before anything
 * new was added (see this task's commit message for the verbatim output).
 *
 * CONNECTPANE-001 (2026-08-21) graduates Connect from "placeholder" to its
 * own real `ConnectSection` — see that file's own header comment for the
 * full design (it writes a `UserConnection`, an architecturally different
 * entity from the `StudyClaim` the other three real sections write, so it
 * does not mount `ClaimComposer` at all). `handleConnectSaved` below only
 * ever calls `setSession` for the `no_warrant_yet` outcome — a saved typed
 * connection does not change `session` at all (nothing in `StudySession`
 * needs to change when a `UserConnection` saves; see
 * `lib/workspace/renderState.ts`'s `buildNoWarrantYetUpdate` header for why
 * this task deliberately does NOT invent a `connectionState` transition for
 * that path either).
 *
 * NO `.module.css` IMPORT, DELIBERATELY, ANYWHERE IN THIS FILE OR ANY FILE
 * IT IMPORTS: `tests/study-page.test.ts` (frozen, read-only here) loads the
 * REAL `page.tsx` under plain `node:test` (no bundler, no jsdom) and stubs
 * only a fixed, exhaustive list of CSS Modules — its own, plus
 * `ClaimComposer`'s four. `tsx --test` cannot parse a real `.css` file (see
 * that file's own header comment and `tests/protected-integrations.test.ts`'s),
 * so any NEW `.module.css` this component (or one of its extracted section
 * files) imported would break every test in that frozen file the moment
 * `page.tsx` started importing this component tree — with no way to fix it,
 * since that test file cannot be edited here. Styling instead uses inline
 * `style` objects referencing this app's existing GLOBAL CSS custom
 * properties (`app/globals.css` — `--shell-*`, `--gold`; not a module, so no
 * import is needed at all), now centralized in `./styles.ts` and shared by
 * every section file rather than each one re-declaring its own — a real,
 * disclosed trade against this shell's visual polish, not an oversight.
 *
 * GATING VS. CONTENT — see `lib/workspace/renderState.ts`'s own header
 * comment for the full reasoning, including why Observe is a deliberate
 * exception (READGATE-001, 2026-08-20), and CLAIMPANES-001's own commit
 * message for why Context and Theology follow the SAME exception (their
 * real, write-capable `ClaimComposer` mount is gated exactly like Observe's
 * — `unlocked` decides whether the live composer or a `LockedNotice` shows,
 * never a bare disabled control with no explanation). Concretely, as of this
 * task:
 *   - Read is always open (never gated).
 *   - Observe mounts the real, unmodified `ClaimComposer` (full eight-kind
 *     picker) once `isPassageMarkedRead(session)` is true.
 *   - Context mounts `ClaimComposer` narrowed to `kind: "interpretation"`
 *     once `hasAnyClaim` (>=1 claim in the session) is true — see
 *     `ContextSection.tsx`.
 *   - Theology mounts `ClaimComposer` narrowed to `kind: "theology"` once
 *     `hasAnyClaim` is true (a connection is NOT required — the gate itself,
 *     `lib/workspace/gating.ts`, is untouched by this task) — see
 *     `TheologySection.tsx`.
 *   - Conviction mounts `ClaimComposer` narrowed to `kind: "conviction"`
 *     UNCONDITIONALLY — never gated, by construction, not merely because
 *     `computeStepGates` currently always returns `unlocked: true` for it —
 *     see `ConvictionSection.tsx`.
 *   - Connect mounts `ConnectSection` — its own real form, NOT
 *     `ClaimComposer` (it writes `UserConnection`, a different entity) —
 *     once `hasAttemptedComparison(claims)` is true; `LockedNotice`
 *     otherwise. See `ConnectSection.tsx`'s own header for the full design
 *     (CHECK-constraint guarantee, no_warrant_yet, motif/thread surfacing).
 *   - Apply/Teach ALWAYS render an honest "not built yet" placeholder
 *     (`PlaceholderSection`) — that is the entirety of their content as of
 *     this task, locked or not. Building their real functionality is
 *     deliberately OUT of this task's scope (they are architecturally
 *     different: an Application bridge-fields form, a TeachingDraft
 *     builder) — see this task's commit message.
 */

export interface WorkspaceShellProps {
  /** The caller's own workspace id, resolved server-side (see page.tsx). Passed straight through to ClaimComposer, unmodified. */
  workspaceId: string;
  session: StudySession;
  /** This session's own claims, for gating. Empty is a valid, honest state — see this task's commit message for what does/does not fetch this today. */
  claims?: StudyClaim[];
  applications?: Application[];
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

  /**
   * CONNECTPANE-001: `ConnectSection`'s two outcomes are NOT symmetric with
   * `handleClaimSaved` above. Only `no_warrant_yet` carries an updated
   * `StudySession` (its own `connectionState` transition) — a saved typed
   * `UserConnection` does not change `session` or `claims` at all (neither
   * gating input reads connections; see `lib/workspace/gating.ts`'s own
   * `WorkspaceGatingInput`, untouched by this task). This shell does not
   * track a session's saved connections in local state at all — there is no
   * downstream consumer of that list within this component today, and
   * inventing one would be speculative UI this task's own scope does not
   * require.
   */
  function handleConnectSaved(result: ConnectSectionSavedResult) {
    if (result.kind === "no_warrant_yet") setSession(result.session);
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
          {section.contentMode === "read" ? <ReadSection session={session} onMarkedRead={setSession} /> : null}
          {section.contentMode === "observe" ? (
            <ObserveSection workspaceId={workspaceId} session={session} onSaved={handleClaimSaved} />
          ) : null}
          {section.contentMode === "context" ? (
            <ContextSection
              workspaceId={workspaceId}
              session={session}
              unlocked={section.unlocked}
              offeredKinds={section.offeredKinds ?? []}
              onSaved={handleClaimSaved}
            />
          ) : null}
          {section.contentMode === "theology" ? (
            <TheologySection
              workspaceId={workspaceId}
              session={session}
              unlocked={section.unlocked}
              offeredKinds={section.offeredKinds ?? []}
              onSaved={handleClaimSaved}
            />
          ) : null}
          {section.contentMode === "conviction" ? (
            <ConvictionSection
              workspaceId={workspaceId}
              session={session}
              offeredKinds={section.offeredKinds ?? []}
              onSaved={handleClaimSaved}
            />
          ) : null}
          {section.contentMode === "connect" ? (
            <ConnectSection
              workspaceId={workspaceId}
              session={session}
              unlocked={section.unlocked}
              onSaved={handleConnectSaved}
            />
          ) : null}
          {section.contentMode === "placeholder" ? <PlaceholderSection section={section} /> : null}
        </details>
      ))}
    </div>
  );
}
