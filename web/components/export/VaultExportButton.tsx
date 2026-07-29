"use client";

import { useState } from "react";

import styles from "./vault-export-button.module.css";

type Status = "idle" | "exporting" | "error";

export function VaultExportButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function download() {
    setStatus("exporting");
    setMessage("Building your Markdown archive…");
    try {
      const response = await fetch("/api/export", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "bible-brain-vault.zip";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("idle");
      setMessage("Export downloaded.");
    } catch {
      setStatus("error");
      setMessage("The export could not be downloaded. Please try again.");
    }
  }

  return (
    <section className={styles.section} aria-labelledby="vault-export-title">
      <p className={styles.eyebrow}>YOUR WRITING</p>
      <h2 id="vault-export-title">Keep a portable copy</h2>
      <p className={styles.copy}>
        Download entries, threads, people, and daily logs as linked Markdown in
        a ZIP archive. Bible translation text is not duplicated.
      </p>
      <button
        disabled={status === "exporting"}
        onClick={() => void download()}
        type="button"
      >
        {status === "exporting" ? "Building export…" : "Download Markdown export"}
      </button>
      <p className={styles.status} role={status === "error" ? "alert" : "status"}>
        {message}
      </p>
    </section>
  );
}
