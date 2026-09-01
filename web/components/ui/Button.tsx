import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "actionRow";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
}

/**
 * The one primary action per screen ("Open today's note") is `primary` —
 * gold on the dark shell, ink on the light page. Everything else is
 * `secondary` or `ghost`. If more than one button on a screen is primary,
 * that's a sign the screen is doing too much, not a reason to add a variant.
 *
 * `actionRow` (SCARLETTHREAD-001) is the shell-only replacement for a filled
 * primary button: "Primary action is type, not a pill" in
 * `design/scarlet-thread-app/Scarlet Thread App.dc.html` — a full-width row,
 * hairline top border, uppercase Archivo Narrow label, no fill. It is SHELL
 * ONLY (see that file's own rule: "no filled buttons anywhere in the
 * shell") — do not use it on the reading pane / page surface, where
 * `primary`'s filled gold button is still the right pattern. Unlike the
 * other three variants, `icon` renders TRAILING (after `children`, not
 * before) for this variant, and defaults to a scarlet arrow when the caller
 * doesn't supply one — the redline's "scarlet arrow right-aligned" is a
 * fixed part of the pattern, not a per-call-site choice.
 */
export function Button({ variant = "primary", icon, className, children, ...props }: ButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(" ");
  const isActionRow = variant === "actionRow";
  const trailingIcon = isActionRow ? (icon ?? (
    <span className={styles.arrow} aria-hidden="true">
      →
    </span>
  )) : null;
  return (
    <button className={classes} {...props}>
      {!isActionRow && icon}
      {children}
      {trailingIcon}
    </button>
  );
}
