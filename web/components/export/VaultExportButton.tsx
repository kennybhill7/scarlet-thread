"use client";

import { useState } from "react";

import {
  ExportLateWriteError,
  exportBlockedMessage,
  fetchCurrentArchive,
  flushPendingWrites,
} from "@/lib/sync/clear";

import styles from "./vault-export-button.module.css";

type Status = "idle" | "syncing" | "exporting" | "error";

export function VaultExportButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const busy = status === "syncing" || status === "exporting";

  async function download() {
    setStatus("syncing");
    setMessage("Syncing your latest writing before the export is built…");
    try {
      await flushPendingWrites();
    } catch (error) {
      setStatus("error");
      setMessage(exportBlockedMessage(error));
      // The early return is the guarantee: /api/export is never called with
      // local writing still queued, so a stale server archive can never be
      // handed over as the current one.
      return;
    }

    setStatus("exporting");
    setMessage("Building your Markdown archive…");
    try {
      // fetchCurrentArchive re-checks the queue after the response has fully
      // arrived, so a write saved during the request cancels the download
      // instead of being silently absent from a file the user keeps.
      const blob = await fetchCurrentArchive();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "scarlet-thread-vault.zip";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("idle");
      setMessage("Export downloaded — it includes everything synced a moment ago.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof ExportLateWriteError
          ? exportBlockedMessage(error)
          : "The export could not be downloaded, so nothing was saved. Try again.",
      );
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
      <button disabled={busy} onClick={() => void download()} type="button">
        {status === "syncing"
          ? "Syncing first…"
          : status === "exporting"
            ? "Building export…"
            : "Download Markdown export"}
      </button>
      <p className={styles.status} role={status === "error" ? "alert" : "status"}>
        {message}
      </p>
    </section>
  );
}
