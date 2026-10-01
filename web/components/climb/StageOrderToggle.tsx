"use client";

import { useState } from "react";

import styles from "./StageOrderToggle.module.css";

/**
 * MOUNTAINWHY-001 — the "Why this shape?" screen's canonical-order toggle
 * (design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md §A.5, §I decision 1). Same
 * split this repo's other interactive components use (`ContinueCard.tsx`'s
 * own header names the precedent): a pure function (`rowsForView`, no React,
 * directly unit-testable) and a thin client component that owns only the
 * one piece of real interaction state (which view is selected) and calls
 * that pure function to render it. `lib/climb/stageOrder.ts`'s
 * `lensOrder`/`canonicalOrder`/`ordersDiffer` do the real ordering work,
 * server-side, before this component ever mounts — this component never
 * re-derives an ordering itself, only selects between the two it is given.
 */

export interface OrderedStageRow {
  slug: string;
  title: string;
}

export type StageOrderView = "lens" | "canonical";

/** Pure — which row list to show for a given view. */
export function rowsForView(
  view: StageOrderView,
  lensRows: readonly OrderedStageRow[],
  canonicalRows: readonly OrderedStageRow[],
): readonly OrderedStageRow[] {
  return view === "lens" ? lensRows : canonicalRows;
}

export interface StageOrderToggleProps {
  lensOrder: OrderedStageRow[];
  canonicalOrder: OrderedStageRow[];
  /** From `lib/climb/stageOrder.ts`'s `ordersDiffer` — computed server-side from the real data. */
  ordersDiffer: boolean;
}

export function StageOrderToggle({ lensOrder, canonicalOrder, ordersDiffer }: StageOrderToggleProps) {
  const [view, setView] = useState<StageOrderView>("lens");
  const rows = rowsForView(view, lensOrder, canonicalOrder);

  return (
    <div className={styles.wrap} data-testid="stage-order-toggle">
      <div className={styles.switch} role="group" aria-label="Journey ordering">
        <button
          type="button"
          className={styles.button}
          data-active={view === "lens"}
          aria-pressed={view === "lens"}
          onClick={() => setView("lens")}
          data-testid="order-lens-button"
        >
          This lens&apos;s order
        </button>
        <button
          type="button"
          className={styles.button}
          data-active={view === "canonical"}
          aria-pressed={view === "canonical"}
          onClick={() => setView("canonical")}
          data-testid="order-canonical-button"
        >
          Canonical order
        </button>
      </div>

      {!ordersDiffer ? (
        <p className={styles.note} data-testid="orders-same-note">
          For this app&apos;s real 11 stages, canonical order and this lens&apos;s order list the stages in the
          same sequence. Switching the view below changes the framing (ascent/peak/descent and mirror pairs,
          versus plain reading order) — it does not reorder the stages, because it doesn&apos;t need to.
        </p>
      ) : null}

      <ol className={styles.list} data-testid="stage-order-list">
        {rows.map((stage, index) => (
          <li key={stage.slug} className={styles.row}>
            <span className={styles.index} aria-hidden="true">
              {index + 1}
            </span>{" "}
            {stage.title}
          </li>
        ))}
      </ol>
    </div>
  );
}
