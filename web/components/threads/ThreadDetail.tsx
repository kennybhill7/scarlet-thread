"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { humanizeToken, optionsFrom } from "@/components/study/ClaimComposer";
import { Chip } from "@/components/ui/Chip";
import { formatCanonicalRangeKey, parseVerseKeyStrict } from "@/lib/bible/range";
import { chapterKey } from "@/lib/bible/reference";
import type { Entry, Stage, Thread } from "@/lib/contracts";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { CONNECTION_TYPES, type ConnectionType, type UserConnection } from "@/lib/contracts/study-v2";
import { syncNow } from "@/lib/sync/client";
import { nextTimestamp } from "@/lib/sync/time";
import {
  listLocalEntries,
  listLocalThreads,
  listLocalV2Entities,
  saveLocalThread,
} from "@/lib/sync/store";
import { registerForType, typologyDirection } from "@/lib/workspace/connectionRegisters";

import styles from "./thread-detail.module.css";

/**
 * CONNECTIONEXPLORER-001 (this task) -- adds the Connection Explorer to this
 * previously v1-only page: real `UserConnection` rows
 * (`lib/contracts/study-v2.ts`, written by `components/workspace/
 * ConnectSection.tsx` since wave 17), read here for the first time through
 * the ALREADY-BUILT `listLocalV2Entities("connection")` (`lib/sync/store.ts`,
 * read-only here) -- a NEW CONSUMER of an existing function, no new read or
 * write path.
 *
 * `workspaceId` is now a required prop, server-resolved by
 * `app/(app)/threads/[slug]/page.tsx` exactly like `app/(app)/study/
 * [sessionId]/page.tsx` resolves it for `WorkspaceShell` -- this component
 * never derives or accepts one from anywhere else. It is used for exactly
 * one thing: `selectConnectionsForThread`'s workspace-scoping filter below
 * (acceptance criterion 3, "defense in depth... never trust structural
 * scoping alone").
 *
 * OUT OF SCOPE, stated plainly per this task's own spec:
 *   - Filtering by doctrine or person. Doctrine has no curated content to
 *     filter against yet (grepped `graph_edges`/`GraphEdge`/doctrine tables
 *     again for STAGEFILTER-001 -- still nothing beyond the one naming-
 *     ambiguity comment in `lib/contracts/study-v2.ts`), and person has no
 *     defined relationship to a `UserConnection` anywhere in this codebase's
 *     data model. Both stay deferred, not attempted here.
 *   - The `Mountain` component (`components/climb/Mountain.tsx`) visual
 *     upgrade named in the same BUILD_PLAN bullet. This task touches
 *     `ThreadDetail`/the thread page only.
 *   - Curated `graph_edges` connections: grepped this codebase before
 *     writing a line of this section (`graph_edges`, `graphEdges`,
 *     `GraphEdge`) -- no table, no content pipeline, nothing exists past one
 *     naming-ambiguity comment in `lib/contracts/study-v2.ts`. Rendered as an
 *     honest "no curated connections yet" notice (matching the precedent
 *     `CLAIMPANES-001`/`CONNECTPANE-001` already set for other not-yet-
 *     curated content), never fabricated fake curated rows.
 *
 * CONNREGISTERS-001 (2026-09-01) -- differentiates `CONNECTION_TYPES` into
 * Ken's four visual "registers" (`design/CONNECTIVE_LAYER.md`) at exactly
 * two render sites below: the type-filter chip row and each connection
 * row's own `data-field="type"` label. The register taxonomy itself
 * (`registerForType`, `typologyDirection`) lives in `lib/workspace/
 * connectionRegisters.ts` -- a plain, dependency-free module both this file
 * AND `ConnectSection.tsx`'s type-picker import, so the two surfaces can
 * never disagree about which type belongs to which register. Four
 * treatments, only two of which change anything a learner sees today:
 *
 *   1. Motif (quotation, explicit_reference, allusion, motif) -- NO visual
 *      change. Wave 1's square-tag Chip redesign already covers these; this
 *      task only confirms the grouping as a real, checkable constant.
 *   2. Structural/covenant (covenant_development, parallel,
 *      contrast_reversal) -- ALWAYS ON. `--gold`/`--gold-deep`, never bare
 *      inline text color: this component renders on the PAGE surface
 *      (`--page-*`, parchment by default, midnight by choice), and `--gold`/
 *      `--gold-deep` are verified ONLY against the always-dark shell
 *      (`app/globals.css`'s own comment, `tests/theme.test.ts`'s shell-
 *      contrast block) -- independently recomputed here (this task's own
 *      report) at 1.608:1 / 2.090:1 against parchment's white card, an
 *      outright WCAG FAIL. The self-contained badge both render sites use
 *      instead (its own `--gold-dim-bg` background, exactly `components/
 *      motif-radar.tsx`'s existing gold-badge pattern, and `Chip.module.css`'s
 *      own new `.structural` tone) carries its own dark backing regardless
 *      of the surrounding page theme, so it stays AA-safe under both
 *      (`--gold-deep` on `--gold-dim-bg`: 8.206:1) -- see this file's
 *      `structuralTypeBadgeStyle` below.
 *   3. Typology (type_antitype only) -- OPT-IN, off by default, gated by
 *      `showDeeperConnections` (the "Show deeper connections" toggle,
 *      `ThreadDetail`'s own `useState`, same local-preference pattern as
 *      `TeachSection.tsx`'s `TeachViewMode`). OFF renders byte-identical to
 *      before this task -- the plain, unstyled type label. ON replaces it
 *      with a directional phrase ("Shadow of ↦" / "Fulfills ↤"),
 *      never a color change -- see `typologyDirection`'s own header comment
 *      in `connectionRegisters.ts` for the ordering rule and its documented
 *      limits.
 *   4. Promise line (promise_fulfillment only) -- OPT-IN, same toggle as
 *      typology. OFF renders unchanged. ON gets its own gold badge, `--gold`
 *      (not structural's `--gold-deep`) plus a marker glyph, so it reads as
 *      a third, distinguishable treatment from the structural register
 *      rather than a re-skin of it.
 *
 * `doctrinal_synthesis`/`personal_resonance` stay exactly as they render
 * today -- `registerForType` returns `"none"` for both, deliberately, per
 * `connectionRegisters.ts`'s own header.
 *
 * OUT OF SCOPE for this task, stated plainly: the covenant rail, the
 * timeline rail, the Israel sub-arc, Mirror Split, and the promise-line
 * "isolate this strand and dim everything else" interaction (needs the
 * Mountain visualization to exist first) -- all separate, later waves per
 * `design/CONNECTIVE_LAYER.md`'s own build sequencing. `Mountain.tsx`/
 * `.module.css` are read-only reference here, never edited.
 */

type ThreadDetailProps = {
  slug: string;
  /**
   * Server-resolved, exactly like `WorkspaceShell`'s own `workspaceId` prop
   * in `app/(app)/study/[sessionId]/page.tsx` -- see that file's
   * "WORKSPACE RESOLUTION" comment and `app/(app)/threads/[slug]/page.tsx`'s
   * own header for the full rationale. Never derived or accepted from any
   * other source in this component.
   */
  workspaceId: string;
  /**
   * STAGEFILTER-001 -- a SECOND server-resolved prop, same discipline as
   * `workspaceId` above: `app/(app)/threads/[slug]/page.tsx` queries the
   * global `stages` table server-side (`resolveThreadStages`, matching
   * `app/(app)/page.tsx`'s own precedent) and hands the rows down here
   * unchanged. `ThreadDetail` never queries or reorders this itself -- it
   * only passes it to `ConnectionsPanel`, which derives filter chips and
   * natural display order from it (see that component's own comment).
   */
  stages: Stage[];
};

type Loaded = {
  thread: Thread;
  entries: Entry[];
  /**
   * This thread's own `UserConnection`s -- already scoped by BOTH
   * `threadSlug` and `workspaceId` (`selectConnectionsForThread`, below).
   * Soft-deleted rows already excluded.
   */
  connections: UserConnection[];
};

function chapterHref(chapter: string) {
  const [book, chapterNumber] = chapter.split(".");
  return `/read/${book}/${chapterNumber}`;
}

// ---------------------------------------------------------------------------
// Pure filter/grouping logic (acceptance criterion 8) -- exported so
// tests/thread-detail.test.ts can call these directly, with no DOM,
// matching this repo's established pattern (e.g. `lib/workspace/
// renderState.ts`'s pure helpers for `WorkspaceShell.tsx`, kept out of the
// component body). The render code below calls these two functions and
// nothing else decides which connections a learner sees.
// ---------------------------------------------------------------------------

/**
 * A connection belongs to this thread's Connection Explorer only when BOTH
 * its `threadSlug` names this thread AND its `workspaceId` matches the
 * server-resolved prop -- defense in depth (acceptance criterion 3), even
 * though the local vault is already effectively single-workspace per
 * device. This is this codebase's established habit of never trusting
 * structural scoping alone (the same reasoning `getSessionV2` and every v2
 * read route already apply). Soft-deleted rows (`deletedAt` set) are
 * excluded, matching every other v2 reader in this codebase (e.g.
 * `components/workspace/TeachSection.tsx`'s `activeSectionsForDraft`).
 */
export function selectConnectionsForThread(
  connections: UserConnection[],
  params: { threadSlug: string; workspaceId: string },
): UserConnection[] {
  return connections.filter(
    (connection) =>
      !connection.deletedAt &&
      connection.threadSlug === params.threadSlug &&
      connection.workspaceId === params.workspaceId,
  );
}

/** `type === null` means "no filter selected" -- every connection passes through unchanged. */
export function filterConnectionsByType(
  connections: UserConnection[],
  type: ConnectionType | null,
): UserConnection[] {
  if (type === null) return connections;
  return connections.filter((connection) => connection.type === type);
}

// ---------------------------------------------------------------------------
// Stage filter (STAGEFILTER-001, acceptance criteria 2/4/5) -- range-to-stage
// lookup plus the combined (type AND stage) filter. Both exported and pure,
// same discipline as `selectConnectionsForThread`/`filterConnectionsByType`
// above: no DOM, callable directly from tests, and the ONLY place that
// decides which connections a learner sees once both filters are active.
// ---------------------------------------------------------------------------

/**
 * Derives a stage-lookup key ("book.chapter", e.g. "1.3") from a
 * `CanonicalRangeV1` boundary ("book.chapter.verse", e.g. "1.3.15") --
 * `db/schema.ts`'s `stages.chapters` column stores book.chapter keys, never
 * book.chapter.verse (confirmed against that table's own definition before
 * writing this). Reuses `lib/bible/range.ts`'s `parseVerseKeyStrict` (the
 * same strict parser range validation itself uses) and
 * `lib/bible/reference.ts`'s `chapterKey` to reassemble the result -- no new
 * parsing invented for this task. Returns `null` for a malformed key rather
 * than throwing: a stored range should always be well-formed, but a range-
 * to-stage lookup must never be the thing that crashes the render if one
 * somehow isn't.
 */
export function refKeyToChapterKey(refKey: string): string | null {
  const parsed = parseVerseKeyStrict(refKey);
  if (!parsed) return null;
  return chapterKey(parsed.book, parsed.chapter);
}

/**
 * Maps ONE end of a connection's range (its `start`) to the stage whose
 * `chapters` array contains that chapter's key, or `null` when either the
 * key itself is malformed OR no known stage covers that chapter (data for a
 * chapter outside the current stage map, or a legacy/malformed range) --
 * both collapse to the same "no known stage" signal on purpose: neither
 * case should crash the render, and neither should have a stage invented
 * for it that it does not actually belong to.
 */
export function stageSlugForRange(range: CanonicalRangeV1, stages: Stage[]): string | null {
  const chapter = refKeyToChapterKey(range.start);
  if (chapter === null) return null;
  const stage = stages.find((candidate) => candidate.chapters.includes(chapter));
  return stage?.slug ?? null;
}

/**
 * MAPPING DECISION (acceptance criterion 2): matches when EITHER endpoint's
 * stage equals the selected one -- not `fromRange` alone.
 *
 * Reasoning: `fromRange`/`toRange` record which passage the learner started
 * FROM and compared TO in the Connect form -- an artifact of data-entry
 * order, not a claim about narrative primacy. `ConnectionsPanel` already
 * renders both ranges side by side in every row (the `connection-ranges`
 * block below) as one symmetric pair, so the stage filter honors that same
 * symmetry: a learner filtering to a stage is asking "show me connections
 * that touch this part of the mountain," not "show me only connections that
 * happened to start here." A promise/fulfillment connection whose fromRange
 * sits in an early ascent stage and whose toRange sits in its descent
 * mirror (`Stage.mirror`) is exactly the kind of connection this filter
 * exists to surface -- restricting to `fromRange` alone would make it
 * silently vanish the moment a learner filtered by its `toRange`'s stage,
 * which is precisely the "silently disappear" failure acceptance criterion
 * 5 warns against.
 */
export function filterConnectionsByStage(
  connections: UserConnection[],
  stageSlug: string | null,
  stages: Stage[],
): UserConnection[] {
  if (stageSlug === null) return connections;
  return connections.filter((connection) => {
    const fromSlug = stageSlugForRange(connection.fromRange, stages);
    const toSlug = stageSlugForRange(connection.toRange, stages);
    return fromSlug === stageSlug || toSlug === stageSlug;
  });
}

/**
 * The one function that decides which connections a learner sees once BOTH
 * filters are in play -- composes `filterConnectionsByType` then
 * `filterConnectionsByStage`, i.e. AND, never OR (acceptance criterion 4).
 * `ConnectionsPanel` calls this and nothing else to compute its visible
 * list, so a filter added here can never be bypassed by the render body
 * reimplementing the intersection itself.
 *
 * UNMATCHED-STAGE HANDLING (acceptance criterion 5): a connection whose
 * range maps to no known stage on either end (`stageSlugForRange` returns
 * `null` for both) never equals any real `stageSlug`, so it is excluded
 * from every SPECIFIC stage filter -- there is no separate "unclassified"
 * bucket chip, it simply never matches one. It is never excluded when
 * `stageSlug` is `null` (no stage filter active), so it always stays
 * visible in the unfiltered view; only `filterConnectionsByType` can remove
 * it there, exactly as before this task.
 */
export function filterConnections(
  connections: UserConnection[],
  filters: { type: ConnectionType | null; stageSlug: string | null },
  stages: Stage[],
): UserConnection[] {
  return filterConnectionsByStage(
    filterConnectionsByType(connections, filters.type),
    filters.stageSlug,
    stages,
  );
}

// ---------------------------------------------------------------------------
// ConnectionsPanel -- HOOKLESS, deliberately (the same technique
// `components/workspace/ConnectSection.tsx`'s own `EvidenceLabelField` uses,
// and `tests/claim-panes.test.ts`'s `PromoteFields` before it): a plain
// function `tests/thread-detail.test.ts` can call directly and inspect the
// real returned element tree, with no `useEffect`/`useState` of its own.
//
// ASSERTION LINE (docs/decisions/2026-08-18-teaching-not-theology.md,
// acceptance criterion 7): the only connection-specific prose this renders
// is `connection.rationale` -- the learner's own typed words, verbatim,
// never summarized, reworded, or wrapped in an app-generated judgment about
// what the connection means. Every other piece of copy here is either a
// mechanically humanized vocabulary token (type, evidence label -- no
// per-value description, same discipline `TeachSection.tsx`'s kind picker
// already documents) or this codebase's now-standard "no curated
// connections yet" honesty notice (acceptance criterion 5, in the same
// voice as `ConnectSection.tsx`'s own `connect-no-curated-notice`).
// `tests/thread-detail.test.ts`'s dedicated ASSERTION-LINE test proves this
// against every `ConnectionType` and `EvidenceLabel`, not just the free-text
// rationale field.
// ---------------------------------------------------------------------------

const panelStyle: CSSProperties = {
  border: "1px solid var(--page-border)",
  borderRadius: "var(--r-xl)",
  padding: "1.25rem",
  display: "grid",
  gap: "0.75rem",
  background: "var(--page-card)",
  color: "var(--page-ink)",
};

const noticeStyle: CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--page-ink-3)",
  margin: 0,
};

const chipsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

// CRIMSONACCENT-001: a left border carries the --crimson accent
// (BUILD_PLAN section 4: "crimson marks active thread connections") on each
// rendered connection row -- chosen over, e.g., colouring the whole card
// border because it reads as a marker/tab against this row's own existing
// 1px --page-border frame (the same "thin accent against a neutral frame"
// language already used elsewhere in this file, e.g. rowHeaderStyle's
// --brass label colour) without ever touching `color`, which stays unset
// here so the rationale <p> below keeps inheriting --page-ink from
// panelStyle -- --crimson never reaches body text.
const rowStyle: CSSProperties = {
  border: "1px solid var(--page-border)",
  borderLeft: "3px solid var(--crimson)",
  borderRadius: "var(--r-md)",
  padding: "0.9rem",
  display: "grid",
  gap: "0.4rem",
};

const rowHeaderStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  fontFamily: "var(--font-narrow)",
  fontSize: "0.75rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "var(--brass)",
};

const rangesRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  fontSize: "0.85rem",
  color: "var(--page-ink-3)",
};

// ---------------------------------------------------------------------------
// CONNREGISTERS-001 register badges (structural, register 2, ALWAYS on; and
// promise, register 4, opt-in). Both are self-contained "portable badges" --
// their own `--gold-dim-bg` background carries the contrast, exactly
// `components/motif-radar.tsx`'s existing gold-badge pattern and this file's
// header comment above -- never bare `color: var(--gold*)` inline text,
// which fails WCAG AA against this component's own `--page-card` background
// (independently recomputed, see the header comment). Typology (register 3)
// gets no badge/color of its own by design -- its differentiator is the
// directional PHRASE itself ("Shadow of" / "Fulfills"), not a color, so it
// intentionally keeps inheriting rowHeaderStyle's plain --brass text.
// ---------------------------------------------------------------------------

const structuralTypeBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 7px",
  borderRadius: 2,
  border: "1px solid var(--gold-deep)",
  background: "var(--gold-dim-bg)",
  color: "var(--gold-deep)",
  fontWeight: 700,
};

const promiseTypeBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3em",
  padding: "1px 7px",
  borderRadius: 2,
  border: "1px solid var(--gold)",
  background: "var(--gold-dim-bg)",
  color: "var(--gold)",
  fontWeight: 600,
};

/**
 * Decides what a connection row's own `data-field="type"` element renders,
 * per `registerForType` and the `showDeeperConnections` toggle. Exported
 * (not just inlined in `ConnectionsPanel`'s `.map`) so
 * `tests/thread-detail.test.ts` can call it directly with a synthetic
 * connection and inspect the real returned element tree, the same "no DOM"
 * discipline every other pure helper in this file already follows.
 *
 * OFF-state guarantee (typology and promise registers): when
 * `showDeeperConnections` is `false`, this returns EXACTLY the same element
 * this file rendered before CONNREGISTERS-001 existed --
 * `<span data-field="type">{humanizeToken(connection.type)}</span>`, nothing
 * wrapped, nothing recolored -- for every type in both opt-in registers.
 * `tests/thread-detail.test.ts`'s pre-existing "each visible row renders
 * type..." test (type_antitype, no toggle passed) and every test built on
 * `sampleConnection()`'s default type (`promise_fulfillment`) prove this
 * without having to be rewritten for this task.
 */
export function renderConnectionTypeField(
  connection: UserConnection,
  showDeeperConnections: boolean,
) {
  const register = registerForType(connection.type);

  if (register === "structural") {
    return (
      <span data-field="type" data-register="structural" style={structuralTypeBadgeStyle}>
        {humanizeToken(connection.type)}
      </span>
    );
  }

  if (register === "typology" && showDeeperConnections) {
    const direction = typologyDirection(connection);
    return (
      <span data-field="type" data-register="typology">
        {direction === "from-is-shadow" ? "Shadow of ↦" : "Fulfills ↤"}
      </span>
    );
  }

  if (register === "promise" && showDeeperConnections) {
    return (
      <span data-field="type" data-register="promise" style={promiseTypeBadgeStyle}>
        <span aria-hidden="true">&#10022;</span>
        {humanizeToken(connection.type)}
      </span>
    );
  }

  return <span data-field="type">{humanizeToken(connection.type)}</span>;
}

export interface ConnectionsPanelProps {
  /** This thread's own connections, already scoped (`selectConnectionsForThread`). */
  connections: UserConnection[];
  /** Server-resolved global stages (`ThreadDetailProps.stages`), passed straight through. */
  stages: Stage[];
  activeType: ConnectionType | null;
  onSelectType: (type: ConnectionType | null) => void;
  activeStageSlug: string | null;
  onSelectStage: (stageSlug: string | null) => void;
  /**
   * CONNREGISTERS-001 -- "Show deeper connections", the opt-in toggle gating
   * the typology (register 3) and promise-line (register 4) treatments
   * together, off by default. Local UI preference only (`ThreadDetail`'s own
   * `useState`, same pattern as `TeachSection.tsx`'s `TeachViewMode`) -- this
   * panel only renders the toggle and reads its current value, it never owns
   * or persists it.
   */
  showDeeperConnections: boolean;
  onToggleDeeperConnections: () => void;
}

export function ConnectionsPanel({
  connections,
  stages,
  activeType,
  onSelectType,
  activeStageSlug,
  onSelectStage,
  showDeeperConnections,
  onToggleDeeperConnections,
}: ConnectionsPanelProps) {
  const visible = filterConnections(connections, { type: activeType, stageSlug: activeStageSlug }, stages);
  // Natural stage order (acceptance criterion 3) -- `stages` arrives from a
  // plain `db.select().from(stagesTable)` with no `ORDER BY` (see
  // `app/(app)/threads/[slug]/page.tsx`'s header), so this sorts by the
  // table's own `stage` column, the same key `app/(app)/page.tsx`'s
  // `buildMountainStages` already sorts by for the identical reason.
  const orderedStages = [...stages].sort((a, b) => a.stage - b.stage);
  return (
    <section aria-label="Connections" data-testid="thread-connections" style={panelStyle}>
      <h2>Connections</h2>
      <p data-testid="connections-no-curated-notice" style={noticeStyle}>
        No curated connections yet for this thread -- this codebase has no <code>graph_edges</code>{" "}
        table or curated-connections pipeline built. What follows are your own typed connections, in
        your own words.
      </p>

      <div aria-label="Filter by connection type" data-testid="connection-type-filter" role="group" style={chipsRowStyle}>
        <Chip
          active={activeType === null}
          aria-pressed={activeType === null}
          data-field="connectionType"
          data-value="all"
          onClick={() => onSelectType(null)}
        >
          All
        </Chip>
        {optionsFrom(CONNECTION_TYPES).map((option) => (
          <Chip
            active={activeType === option.value}
            aria-pressed={activeType === option.value}
            data-field="connectionType"
            data-value={option.value}
            key={option.value}
            onClick={() => onSelectType(option.value)}
            tone={registerForType(option.value) === "structural" ? "structural" : "gold"}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {/* CONNREGISTERS-001 -- "Show deeper connections" gates the typology
          (register 3) and promise-line (register 4) treatments together,
          off by default. Label echoes `design/CONNECTIVE_LAYER.md`'s own
          Wave 2 language verbatim ("ship behind an opt-in 'deeper' toggle")
          rather than inventing new vocabulary Ken didn't already choose. */}
      <div aria-label="Deeper connections toggle" data-testid="deeper-connections-toggle" role="group" style={chipsRowStyle}>
        <Chip
          active={showDeeperConnections}
          aria-pressed={showDeeperConnections}
          data-testid="deeper-connections-chip"
          onClick={onToggleDeeperConnections}
        >
          Show deeper connections
        </Chip>
      </div>

      <div aria-label="Filter by stage" data-testid="connection-stage-filter" role="group" style={chipsRowStyle}>
        <Chip
          active={activeStageSlug === null}
          aria-pressed={activeStageSlug === null}
          data-field="connectionStage"
          data-value="all"
          onClick={() => onSelectStage(null)}
        >
          All stages
        </Chip>
        {orderedStages.map((stage) => (
          <Chip
            active={activeStageSlug === stage.slug}
            aria-pressed={activeStageSlug === stage.slug}
            data-field="connectionStage"
            data-value={stage.slug}
            key={stage.slug}
            onClick={() => onSelectStage(stage.slug)}
          >
            {stage.title}
          </Chip>
        ))}
      </div>

      {connections.length === 0 ? (
        <p data-testid="connections-empty" style={noticeStyle}>
          No connections recorded for this thread yet. Compare a passage from Connect and link it here.
        </p>
      ) : visible.length === 0 ? (
        <p data-testid="connections-empty-filtered" style={noticeStyle}>
          No connections match these filters for this thread yet -- try different filters.
        </p>
      ) : (
        <ul data-testid="connections-list" style={listStyle}>
          {visible.map((connection) => (
            <li data-testid="connection-row" key={connection.id} style={rowStyle}>
              <div style={rowHeaderStyle}>
                {renderConnectionTypeField(connection, showDeeperConnections)}
                <span data-field="evidenceLabel">{humanizeToken(connection.evidenceLabel)}</span>
              </div>
              <div data-testid="connection-ranges" style={rangesRowStyle}>
                <span data-field="fromRange">{formatCanonicalRangeKey(connection.fromRange)}</span>
                <span aria-hidden="true">&harr;</span>
                <span data-field="toRange">{formatCanonicalRangeKey(connection.toRange)}</span>
              </div>
              <p data-field="rationale">{connection.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ThreadDetail({ slug, workspaceId, stages }: ThreadDetailProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ready, setReady] = useState(false);
  const [definition, setDefinition] = useState("");
  const [seeing, setSeeing] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [activeConnectionType, setActiveConnectionType] = useState<ConnectionType | null>(null);
  const [activeStageSlug, setActiveStageSlug] = useState<string | null>(null);
  // CONNREGISTERS-001 -- "Show deeper connections", off by default (see
  // ConnectionsPanelProps' own comment). A plain viewing preference, not
  // vault data -- never persisted, never synced, same category as
  // `TeachSection.tsx`'s `viewMode` state.
  const [showDeeperConnections, setShowDeeperConnections] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (navigator.onLine) {
        try {
          await syncNow();
        } catch {
          // The local thread remains available for review.
        }
      }
      try {
        const [threads, entries, connections] = await Promise.all([
          listLocalThreads(),
          listLocalEntries(),
          listLocalV2Entities("connection"),
        ]);
        if (!active) return;
        const thread = threads.find((item) => item.slug === slug);
        if (thread) {
          setLoaded({
            thread,
            entries: entries.filter((entry) => entry.threads.includes(slug)),
            connections: selectConnectionsForThread(connections, { threadSlug: slug, workspaceId }),
          });
          setDefinition(thread.definition);
          setSeeing(thread.seeing);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, workspaceId]);

  async function save() {
    if (!loaded) return;
    setSaving(true);
    setMessage("Saving on this device…");
    const thread: Thread = {
      ...loaded.thread,
      definition: definition.trim(),
      seeing: seeing.trim(),
      updatedAt: nextTimestamp(loaded.thread.updatedAt),
    };
    try {
      await saveLocalThread(thread);
      setLoaded({ ...loaded, thread });
      if (navigator.onLine) {
        try {
          await syncNow();
          setMessage("Thread saved and synced.");
        } catch {
          setMessage("Thread saved here. Sync will retry.");
        }
      } else {
        setMessage("Thread saved here. Sync will wait.");
      }
    } catch {
      setMessage("This device could not save the thread.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <section className={styles.state} aria-busy="true">
        Loading thread…
      </section>
    );
  }

  if (loadError) {
    return (
      <section className={styles.state} role="alert">
        <h1>Thread could not be loaded</h1>
        <p>Your device storage or connection is unavailable. Please reload.</p>
        <Link href="/review">Back to Review</Link>
      </section>
    );
  }

  if (!loaded) {
    return (
      <section className={styles.state}>
        <h1>Thread not found on this device</h1>
        <p>Reconnect to sync it, or return to Review.</p>
        <Link href="/review">Back to Review</Link>
      </section>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/review">← Review</Link>
        <p className={styles.eyebrow}>THREAD</p>
        <h1>{loaded.thread.title}</h1>
        <p>
          {loaded.entries.length} linked{" "}
          {loaded.entries.length === 1 ? "entry" : "entries"}
        </p>
      </header>

      <section className={styles.editor}>
        <label htmlFor="thread-definition">In one line</label>
        <textarea
          disabled={saving}
          id="thread-definition"
          maxLength={2_000}
          onChange={(event) => setDefinition(event.target.value)}
          rows={2}
          value={definition}
        />
        <label htmlFor="thread-seeing">What I’m seeing</label>
        <textarea
          disabled={saving}
          id="thread-seeing"
          maxLength={100_000}
          onChange={(event) => setSeeing(event.target.value)}
          rows={7}
          value={seeing}
        />
        <div className={styles.saveRow}>
          <p aria-live="polite">{message}</p>
          <button disabled={saving} onClick={() => void save()} type="button">
            {saving ? "Saving…" : "Save thread"}
          </button>
        </div>
      </section>

      <section className={styles.backlinks}>
        <h2>Where it shows up</h2>
        {loaded.entries.length === 0 ? (
          <p>No linked writing yet. Let the thread stay half-empty.</p>
        ) : (
          <ol>
            {loaded.entries.map((entry) => (
              <li key={entry.id}>
                <Link href={chapterHref(entry.chapter)}>
                  <span>{entry.verse ?? entry.chapter}</span>
                  <p>{entry.body}</p>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <ConnectionsPanel
        activeStageSlug={activeStageSlug}
        activeType={activeConnectionType}
        connections={loaded.connections}
        onSelectStage={setActiveStageSlug}
        onSelectType={setActiveConnectionType}
        onToggleDeeperConnections={() => setShowDeeperConnections((prev) => !prev)}
        showDeeperConnections={showDeeperConnections}
        stages={stages}
      />
    </main>
  );
}
