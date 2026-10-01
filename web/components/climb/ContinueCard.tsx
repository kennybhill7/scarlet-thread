import Link from "next/link";

import { formatRef, toChapterKey } from "@/lib/bible/reference";
import type { BookMeta } from "@/lib/contracts";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { STUDY_SESSION_STEPS } from "@/lib/contracts/study-v2";

import styles from "./ContinueCard.module.css";

/**
 * NAV-001 — the Journey (home) page's top card (plan §A.2: "Top card:
 * Continue ... or Begin (first run)"). Two pieces, same split this repo's
 * other hookless components use (PlaceLensSvg.tsx's header is the named
 * precedent): a pure view-model builder (`buildContinueCardViewModel`, no
 * React, no I/O — directly unit-testable) and a hookless "props in, markup
 * out" render component (`ContinueCard`) that `app/(app)/page.tsx` mounts
 * through `ClimbHero`.
 *
 * `app/(app)/page.tsx` decides WHETHER a resumable session exists at all
 * (it is the one place with database access) and, when one does, resolves
 * it down to the small, local shapes below (`ContinueCardSession`,
 * `ContinueCardClaim`, `ContinueCardStage`) rather than handing this module
 * the full `StudySession`/`StudyClaim`/`MountainStage` records — the same
 * narrowing discipline `lib/workspace/gating.ts`'s `GatingClaim`/
 * `GatingSession` already established for this codebase (that file's own
 * header: a minimal shape adapted from real records, not a second copy of
 * the real contract).
 */

export interface ContinueCardSession {
  id: string;
  range: CanonicalRangeV1;
  /** `StudySession.currentStep` is plain `string` in the real contract (see
   * that field's own comment in lib/contracts/study-v2.ts) — kept `string`
   * here too, matched against `STUDY_SESSION_STEPS` defensively below rather
   * than assumed to always be a known step. */
  currentStep: string;
}

export interface ContinueCardClaim {
  /** `StudyClaim.kind`, e.g. "observation" | "question" | ... — kept plain
   * `string` here for the same reason `currentStep` is above. */
  kind: string;
  deletedAt?: string | null;
}

export interface ContinueCardStage {
  /** `MountainStage.firstChapter` — a chapter-level RefKey ("1.3"), or null. */
  firstChapter: string | null;
  title: string;
  short: string;
}

export interface ContinueCardSessionData {
  session: ContinueCardSession;
  claims: ContinueCardClaim[];
}

export type ContinueCardViewModel =
  | { status: "begin"; href: string }
  | {
      status: "continue";
      sessionId: string;
      passageLabel: string;
      stageLabel: string | null;
      stepLabel: string | null;
      observationCount: number;
      openQuestionCount: number;
    };

/**
 * Builds the "continue" variant from a resolved active session. Callers
 * decide the "begin" variant themselves (no active session at all is not a
 * property of a session, so there is nothing for this function to compute in
 * that case) — see `app/(app)/page.tsx`'s `resolveContinueCard`.
 *
 * `books` may be empty (the caller's `getBooks` dependency is optional, see
 * `app/(app)/page.tsx`'s own header) — `passageLabel` degrades to the raw
 * start `RefKey` rather than throwing, since an unformatted-but-honest label
 * beats a crashed Journey page.
 */
export function buildContinueCardViewModel(params: {
  session: ContinueCardSession;
  claims: ContinueCardClaim[];
  stages: ContinueCardStage[];
  books: BookMeta[];
}): Extract<ContinueCardViewModel, { status: "continue" }> {
  const { session, claims, stages, books } = params;

  const chapterKey = toChapterKey(session.range.start);
  const stage = stages.find((s) => s.firstChapter === chapterKey) ?? null;
  const stageLabel = stage ? stage.short || stage.title : null;

  // `StudyEntryControl.buildEntryRange` (components/reader/StudyEntry.tsx)
  // anchors a fresh session to either a single selected verse (start === end
  // -- genuine, intentional verse-level specificity, shown in full: "Genesis
  // 3:15") or the WHOLE chapter being read (start = verse 1, end = the
  // chapter's last verse -- grep-confirmed against that function). The
  // latter is the overwhelmingly common case, and showing it as a raw verse
  // range ("Genesis 3:1-24") would bury the plan's own intended label
  // ("Genesis 3", plan §A.2) in a verse count nobody chose -- so any
  // multi-verse range collapses to its plain chapter reference here instead.
  const passageLabel =
    books.length === 0
      ? session.range.start
      : session.range.start === session.range.end
        ? formatRef(session.range.start, books)
        : formatRef(chapterKey, books);

  const stepIndex = (STUDY_SESSION_STEPS as readonly string[]).indexOf(session.currentStep);
  const stepLabel = stepIndex >= 0 ? `step ${stepIndex + 1} of ${STUDY_SESSION_STEPS.length}` : null;

  const liveClaims = claims.filter((claim) => !claim.deletedAt);
  const observationCount = liveClaims.filter((claim) => claim.kind === "observation").length;
  // v2's `StudyClaim` has no "answered" concept the way v1's `Entry.answeredAt`
  // does (grep-confirmed against lib/contracts/study-v2.ts — see that file's
  // own StudySession/StudyClaim interfaces) — every "question"-kind claim in
  // a session is therefore counted as open here. Documented, not silently
  // assumed: a future "answered" marker on v2 claims would narrow this.
  const openQuestionCount = liveClaims.filter((claim) => claim.kind === "question").length;

  return {
    status: "continue",
    sessionId: session.id,
    passageLabel,
    stageLabel,
    stepLabel,
    observationCount,
    openQuestionCount,
  };
}

function formatCounts(observationCount: number, openQuestionCount: number): string {
  const obs = `${observationCount} observation${observationCount === 1 ? "" : "s"}`;
  const q = `${openQuestionCount} open question${openQuestionCount === 1 ? "" : "s"}`;
  return `${obs}, ${q}`;
}

export interface ContinueCardProps {
  data: ContinueCardViewModel;
}

/** Hookless — a pure function of `data`, directly renderable by `renderToStaticMarkup`. */
export function ContinueCard({ data }: ContinueCardProps) {
  if (data.status === "begin") {
    return (
      <Link href={data.href} className={styles.card} data-testid="continue-card" data-status="begin" data-tap>
        <span className={styles.eyebrow}>Begin</span>
        <span className={styles.headline}>Start at Genesis 1</span>
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      </Link>
    );
  }

  const metaParts = [data.stepLabel, formatCounts(data.observationCount, data.openQuestionCount)].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <Link
      href={`/study/${data.sessionId}`}
      className={styles.card}
      data-testid="continue-card"
      data-status="continue"
      data-tap
    >
      <span className={styles.eyebrow}>Continue</span>
      <span className={styles.headline}>
        {data.passageLabel}
        {data.stageLabel ? ` · ${data.stageLabel}` : ""}
      </span>
      {metaParts.length > 0 ? <span className={styles.meta}>{metaParts.join(" · ")}</span> : null}
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
    </Link>
  );
}
