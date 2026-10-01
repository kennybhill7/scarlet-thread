"use client";

import { useEffect, useState } from "react";

import { isPlaceLensCached, warmPlaceLensAssets } from "./dataLoader";
import styles from "./PlaceLens.module.css";

/**
 * PLACELENS-001 — the Settings "Download maps for offline" affordance the
 * task brief asks for, extending the existing Settings page minimally
 * (`app/(app)/settings/page.tsx`) rather than building a new screen, same
 * pattern `OfflineDownloads.tsx` (the Bible-translation downloader) already
 * established: a hookless `resolveInitialStatus`/`runDownload`-style split
 * so the real logic is testable without a DOM (that component's own header
 * explains why — effects never fire under `renderToStaticMarkup`), wrapped
 * by a thin "use client" component that owns the status/progress state.
 */
export type MapDownloadStatus = "checking" | "idle" | "downloading" | "ready" | "error";

export function OfflineMapsDownload() {
  const [status, setStatus] = useState<MapDownloadStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    isPlaceLensCached().then((cached) => {
      if (!cancelled) setStatus(cached ? "ready" : "idle");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function download() {
    setStatus("downloading");
    setError(null);
    const result = await warmPlaceLensAssets();
    if (result.ok) {
      setStatus("ready");
    } else {
      setStatus("error");
      setError(result.message);
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>
        The Place lens (coastlines + the ~1,259 places from OpenBible.info) downloads automatically the first time
        you open it. Fetch it now to have it ready offline before a trip — about 2 MB.
      </p>
      {status === "checking" ? <p className={styles.hint}>Checking…</p> : null}
      {status === "ready" ? <span className={styles.tierBadge}>Downloaded</span> : null}
      {status === "idle" ? (
        <button type="button" className={styles.zoomButton} onClick={download}>
          Download maps
        </button>
      ) : null}
      {status === "downloading" ? <p className={styles.hint}>Downloading…</p> : null}
      {status === "error" ? (
        <div>
          <p className={styles.hint} role="alert">
            {error ?? "Download failed."}
          </p>
          <button type="button" className={styles.zoomButton} onClick={download}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
