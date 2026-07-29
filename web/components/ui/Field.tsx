import type { TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

interface FieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

/**
 * The observation/question/note input. Autosizing textarea, not a fixed box —
 * a three-line observation and a two-paragraph note are both normal, and a
 * fixed-height box makes the short one feel empty and the long one feel cramped.
 */
export function Field({ label, hint, id, className, ...props }: FieldProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <textarea id={fieldId} className={styles.textarea} rows={2} {...props} />
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
