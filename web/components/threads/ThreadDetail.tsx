"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { humanizeToken, optionsFrom } from "@/components/study/ClaimComposer";
import { Chip } from "@/components/ui/Chip";
import { formatCanonicalRangeKey } from "@/lib/bible/range";
import type { Entry, Thread } from "@/lib/contracts";
import { CONNECTION_TYPES, type ConnectionType, type UserConnection } from "@/lib/contracts/study-v2";
import { syncNow } from "@/lib/sync/client";
import { nextTimestamp } from "@/lib/sync/time";
import {
  listLocalEntries,
  listLocalThreads,
  listLocalV2Entities,
  saveLocalThread,
} from "@/lib/sync/store";

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
 *   - Filtering by doctrine, person, or stage. Doctrine/person as
 *     v2-connection-linked concepts do not exist yet, and a real "stage"
 *     filter needs BUILD_PLAN's ascent/descent chapter staging cross-
 *     referenced against a connection's range -- more design work than this
 *     task should improvise. ConnectionType is the one filter this task
 *     fully builds (`ConnectionsPanel` below).
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

const rowStyle: CSSProperties = {
  border: "1px solid var(--page-border)",
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

export interface ConnectionsPanelProps {
  /** This thread's own connections, already scoped (`selectConnectionsForThread`). */
  connections: UserConnection[];
  activeType: ConnectionType | null;
  onSelectType: (type: ConnectionType | null) => void;
}

export function ConnectionsPanel({ connections, activeType, onSelectType }: ConnectionsPanelProps) {
  const visible = filterConnectionsByType(connections, activeType);
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
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {connections.length === 0 ? (
        <p data-testid="connections-empty" style={noticeStyle}>
          No connections recorded for this thread yet. Compare a passage from Connect and link it here.
        </p>
      ) : visible.length === 0 ? (
        <p data-testid="connections-empty-filtered" style={noticeStyle}>
          No connections of this type for this thread yet -- try a different filter.
        </p>
      ) : (
        <ul data-testid="connections-list" style={listStyle}>
          {visible.map((connection) => (
            <li data-testid="connection-row" key={connection.id} style={rowStyle}>
              <div style={rowHeaderStyle}>
                <span data-field="type">{humanizeToken(connection.type)}</span>
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

export function ThreadDetail({ slug, workspaceId }: ThreadDetailProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ready, setReady] = useState(false);
  const [definition, setDefinition] = useState("");
  const [seeing, setSeeing] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [activeConnectionType, setActiveConnectionType] = useState<ConnectionType | null>(null);

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
        activeType={activeConnectionType}
        connections={loaded.connections}
        onSelectType={setActiveConnectionType}
      />
    </main>
  );
}
