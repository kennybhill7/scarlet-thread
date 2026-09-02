import type { RibbonTick } from "@/lib/climb/mountainGeometry";

export interface MountainRibbonProps {
  ticks: readonly RibbonTick[];
  onSelect: (slug: string) => void;
}

/**
 * Requirement 7 — "a small, always-visible strip... showing the whole
 * 11-stage arc in miniature so a learner always has 'how much is left'
 * context even mid-scroll on the large view." Mountain.tsx pins this with
 * `position: sticky` at the bottom of the section, so it stays on screen
 * for the whole (very tall) scroll.
 *
 * HOOKLESS, same reasoning as MountainScene.tsx — no CSS Module, styling via
 * inline attributes plus one embedded `<style>` block for the "you are here"
 * marker's CSS-var-driven position (kept out of inline style because a CSS
 * custom property read via `var()` inside a `left: calc(...)` needs to live
 * in a stylesheet rule to respond to the ancestor's live `--mountain-progress`
 * updates without this component re-rendering on every scroll frame).
 */
export function MountainRibbon({ ticks, onSelect }: MountainRibbonProps) {
  return (
    <div
      className="mountain-ribbon"
      role="group"
      aria-label="Mini-map: your position across all eleven stages, Genesis to Revelation"
      style={{
        position: "relative",
        height: 28,
        display: "flex",
        alignItems: "center",
      }}
    >
      <style>
        {`
        .mountain-ribbon-track { position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--shell-border-hi); transform: translateY(-50%); }
        .mountain-ribbon-here {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--shell-crimson-text);
          left: calc(var(--mountain-progress, 1) * 100%);
          transform: translateX(-1px);
        }
        `}
      </style>
      <div className="mountain-ribbon-track" aria-hidden="true" />
      <div className="mountain-ribbon-here" aria-hidden="true" />
      {ticks.map((tick) => (
        <button
          key={tick.slug}
          type="button"
          data-stage-slug={tick.slug}
          aria-label={`${tick.title} — ${tick.reference}`}
          onClick={() => onSelect(tick.slug)}
          style={{
            // Scoped override of the app-wide `button { min-height: 44px }`
            // tap-target rule (web/app/globals.css) -- an always-visible
            // mini-map strip only has ~28px of height to work with, so the
            // dots stay their real size; inline style wins the cascade
            // over that external rule without an !important.
            position: "absolute",
            left: `${tick.leftFraction * 100}%`,
            transform: "translateX(-50%)",
            width: 10,
            height: 10,
            minWidth: 10,
            minHeight: 10,
            borderRadius: "50%",
            padding: 0,
            border: `1.5px solid ${tick.filled ? "var(--gold-deep)" : "var(--shell-border-hi)"}`,
            background: tick.filled ? "var(--gold)" : "var(--shell-bg)",
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}
