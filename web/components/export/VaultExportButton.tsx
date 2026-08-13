"use client";

import { useState } from "react";

import {
  DeviceOfflineError,
  UnsyncedWritesError,
  assertCurrentArchiveResponse,
  flushPendingWrites,
  isSyncRejectedError,
} from "@/lib/sync/clear";

import styles from "./vault-export-button.module.css";

type Status = "idle" | "syncing" | "exporting" | "error";

/**
 * The archive is built on the server from synced rows, so an export taken
 * while local writing is still queued is silently missing that writing. Every
 * blocked path therefore names the incomplete archive as the reason rather
 * than reporting a generic failure.
 */
function exportBlockedMessage(error: unknown): string {
  if (error instanceof DeviceOfflineError) {
    return "Export cancelled to avoid an incomplete archive: you are offline, so this device's latest writing has not reached the server. Reconnect and try again.";
  }
  if (isSyncRejectedError(error)) {
    return `Export cancelled to avoid an incomplete archive: the server rejected ${error.rejected.length} change(s), so they would be missing from it.`;
  }
  if (error instanceof UnsyncedWritesError) {
    return `Export cancelled to avoid an incomplete archive: ${error.pending} change(s) are still waiting to sync. Try again in a moment.`;
  }
  return "Export cancelled to avoid an incomplete archive: your writing could not be synced. Try again when the connection is stable.";
}

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
      const response = await fetch("/api/export", {
        cache: "no-store",
        credentials: "same-origin",
      });
      assertCurrentArchiveResponse(response);
      const blob = await response.blob();
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
    } catch {
      setStatus("error");
      setMessage(
        "The export could not be downloaded, so nothing was saved. Try again.",
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
