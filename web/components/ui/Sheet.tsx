"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Sheet.module.css";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * A bottom sheet for the version switcher, thread picker, and similar small
 * choices. Built on native <dialog> rather than a hand-rolled div+backdrop —
 * that gets focus trapping, Escape-to-close, and inert background content for
 * free, which matters more on a study app used half-awake than it would
 * elsewhere.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="sheet-title"
    >
      <div className={styles.handle} aria-hidden="true" />
      <div className={styles.head}>
        <h2 id="sheet-title" className={styles.title}>
          {title}
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
