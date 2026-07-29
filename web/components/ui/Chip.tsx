import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Chip.module.css";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: "gold" | "green";
  children: ReactNode;
}

/** A thread name, a version code — anything tappable and short. */
export function Chip({ active, tone = "gold", className, children, ...props }: ChipProps) {
  const classes = [styles.chip, styles[tone], active && styles.active, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
