"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

/**
 * RADARUI-001 — the confirm/dismiss half of the thread radar. The passive
 * "words repeating across three-plus passages" list a few lines above this
 * component (`app/(app)/review/page.tsx`'s existing "Thread radar" section,
 * `computeMotifCandidates`, unchanged by this task) only ever showed a
 * candidate; nothing let the learner act on one. This component is that
 * seam: it lists what `GET /api/motifs` currently offers and lets the
 * learner confirm (promote to a thread) or dismiss each one, via
 * `POST /api/motifs/[id]`.
 *
 * WORDING — docs/decisions/2026-08-18-teaching-not-theology.md, read before
 * changing any string below. The app may assert METHOD ("you used this word
 * in N separate passages, and the guide's own rule is to consider a thread
 * on the third repetition") — that is a checkable fact about the learner's
 * own writing. It must never assert MEANING ("this is a covenant motif",
 * "this is significant"). Every sentence below was written to stay on the
 * method side of that line: it reports a count and a rule, then asks. The
 * decision is the learner's, stated as a question with two answers, not a
 * suggestion with one obviously-correct one.
 */

export interface MotifCandidateView {
  id: string;
  label: string;
  normalizedKey: string;
  passages: string[];
  sightingCount: number;
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; candidates: MotifCandidateView[] };

type ActionOutcome =
  | { kind: "confirmed"; threadSlug: string; threadTitle: string }
  | { kind: "dismissed" }
  | { kind: "error"; message: string };

type FetchImpl = typeof fetch;

async function loadCandidates(fetchImpl: FetchImpl): Promise<MotifCandidateView[]> {
  const response = await fetchImpl("/api/motifs");
  if (!response.ok) {
    throw new Error(`Could not load suggested threads (status ${response.status}).`);
  }
  const body = (await response.json()) as { data: MotifCandidateView[] };
  return body.data;
}

async function sendAction(
  fetchImpl: FetchImpl,
  candidateId: string,
  action: "confirm" | "dismiss",
): Promise<{ threadSlug: string; threadTitle: string } | null> {
  const response = await fetchImpl(`/api/motifs/${encodeURIComponent(candidateId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `That didn't go through (status ${response.status}).`);
  }
  if (action === "confirm") {
    const body = (await response.json()) as { data: { threadSlug: string; threadTitle: string } };
    return { threadSlug: body.data.threadSlug, threadTitle: body.data.threadTitle };
  }
  return null;
}

function passageSummary(passages: string[]): string {
  if (passages.length <= 4) return passages.join(", ");
  return `${passages.slice(0, 4).join(", ")}, and ${passages.length - 4} more`;
}

export function MotifRadarPanel({ fetchImpl = fetch }: { fetchImpl?: FetchImpl }) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [outcomes, setOutcomes] = useState<Record<string, ActionOutcome>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCandidates(fetchImpl)
      .then((candidates) => {
        if (!cancelled) setState({ status: "ready", candidates });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load suggested threads.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  async function act(candidate: MotifCandidateView, action: "confirm" | "dismiss") {
    setBusyId(candidate.id);
    try {
      const result = await sendAction(fetchImpl, candidate.id, action);
      setOutcomes((prev) => ({
        ...prev,
        [candidate.id]:
          action === "confirm" && result
            ? { kind: "confirmed", threadSlug: result.threadSlug, threadTitle: result.threadTitle }
            : { kind: "dismissed" },
      }));
    } catch (error) {
      setOutcomes((prev) => ({
        ...prev,
        [candidate.id]: {
          kind: "error",
          message: error instanceof Error ? error.message : "That didn't go through.",
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  if (state.status === "loading") {
    return <p style={styles.hint}>Checking for anything worth offering…</p>;
  }

  if (state.status === "error") {
    return (
      <p style={styles.hint} role="alert">
        {state.message}
      </p>
    );
  }

  const pending = state.candidates.filter((candidate) => !outcomes[candidate.id]);

  return (
    <div>
      <p style={styles.hint}>
        Confirming turns a suggestion into a thread you can keep building. Dismissing only hides the
        suggestion — your entries and everything you&apos;ve written stay exactly as they are.
      </p>

      {pending.length === 0 && Object.keys(outcomes).length === 0 ? (
        <p style={styles.ok}>Nothing offered right now.</p>
      ) : null}

      <div style={styles.list}>
        {state.candidates.map((candidate) => {
          const outcome = outcomes[candidate.id];
          const busy = busyId === candidate.id;

          if (outcome?.kind === "confirmed") {
            return (
              <div key={candidate.id} style={styles.card} data-testid={`motif-outcome-${candidate.id}`}>
                <p style={styles.resultText}>
                  Thread created: &ldquo;{outcome.threadTitle}&rdquo;.{" "}
                  <Link href={`/threads/${outcome.threadSlug}`}>Open it →</Link>
                </p>
              </div>
            );
          }

          if (outcome?.kind === "dismissed") {
            return (
              <div key={candidate.id} style={styles.card} data-testid={`motif-outcome-${candidate.id}`}>
                <p style={styles.resultText}>
                  Dismissed — nothing was deleted. Your notes are unchanged.
                </p>
              </div>
            );
          }

          return (
            <div key={candidate.id} style={styles.card} data-testid={`motif-candidate-${candidate.id}`}>
              <p style={styles.word}>{candidate.label}</p>
              <p style={styles.body}>
                You&apos;ve used &ldquo;{candidate.label}&rdquo; in {candidate.sightingCount} separate
                passages: {passageSummary(candidate.passages)}. The guide&apos;s own rule is to consider a
                thread on the third time something repeats, not the first — this is a repetition count,
                not a claim about what it means. Worth turning into a thread?
              </p>
              {outcome?.kind === "error" ? (
                <p style={styles.errorText} role="alert">
                  {outcome.message}
                </p>
              ) : null}
              <div style={styles.actions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(candidate, "confirm")}
                  style={styles.confirmButton}
                >
                  {busy ? "Working…" : "Yes, make it a thread"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(candidate, "dismiss")}
                  style={styles.dismissButton}
                >
                  {busy ? "Working…" : "Not now"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  hint: {
    fontSize: "12.5px",
    color: "var(--shell-muted)",
    marginBottom: "14px",
    lineHeight: 1.5,
  },
  ok: {
    color: "var(--shell-muted)",
    fontSize: "13px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  card: {
    padding: "12px 14px",
    background: "var(--gold-dim-bg)",
    border: "1px solid var(--gold-dim-border)",
    borderRadius: "var(--r-sm)",
  },
  word: {
    fontFamily: "var(--font-display)",
    fontWeight: 600,
    fontSize: "14px",
    color: "var(--gold)",
    textTransform: "capitalize",
    margin: "0 0 4px",
  },
  body: {
    fontSize: "12.5px",
    color: "var(--shell-text-2)",
    lineHeight: 1.5,
    margin: "0 0 10px",
  },
  resultText: {
    fontSize: "12.5px",
    color: "var(--shell-text-2)",
    lineHeight: 1.5,
    margin: 0,
  },
  errorText: {
    fontSize: "12px",
    color: "var(--danger, #9b2c2c)",
    margin: "0 0 8px",
  },
  actions: {
    display: "flex",
    gap: "8px",
  },
  confirmButton: {
    fontSize: "12.5px",
    padding: "6px 12px",
    borderRadius: "var(--r-sm)",
    border: "1px solid var(--gold)",
    background: "var(--gold)",
    color: "var(--shell-bg, #0f1923)",
    cursor: "pointer",
  },
  dismissButton: {
    fontSize: "12.5px",
    padding: "6px 12px",
    borderRadius: "var(--r-sm)",
    border: "1px solid var(--shell-border)",
    background: "transparent",
    color: "var(--shell-muted-2)",
    cursor: "pointer",
  },
};
