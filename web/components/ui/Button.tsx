import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
}

/**
 * The one primary action per screen ("Open today's note") is `primary` —
 * gold on the dark shell, ink on the light page. Everything else is
 * `secondary` or `ghost`. If more than one button on a screen is primary,
 * that's a sign the screen is doing too much, not a reason to add a variant.
 */
export function Button({ variant = "primary", icon, className, children, ...props }: ButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(" ");
  return (
    <button className={classes} {...props}>
      {icon}
      {children}
    </button>
  );
}
