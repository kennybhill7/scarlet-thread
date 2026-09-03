"use client";

import { useEffect, useState } from "react";
import type { VersionId } from "@/lib/contracts";
import { useBibleIndex } from "@/lib/bible/useBibleIndex";
import { cacheSizeEstimate, isBookCached, warmVersion } from "@/lib/bible/loader";
import { Button } from "@/components/ui/Button";
import styles from "./OfflineDownloads.module.css";

type Status = "idle" | "checking" | "downloading" | "ready";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * A study Bible you can't open on a plane isn't offline-first, it's
 * offline-sometimes. Every chapter caches itself the moment you read it
 * (see lib/bible/loader.ts), but this screen lets Ken force the whole
 * translation down before a trip rather than discovering a gap mid-flight.
 *
 * warmVersion() (lib/bible/loader.ts) also prefetches /bible/versemap.json
 * alongside the book files on every download here, so the parallel Spanish
 * pane keeps working -- Romans 14/16 included -- once the device goes
 * offline, not just the primary text (VMCACHE-001).
 */
export function OfflineDownloads() {
  const { index, loading } = useBibleIndex();
  const [statuses, setStatuses] = useState<Record<VersionId, Status>>({} as Record<VersionId, Status>);
  const [progress, setProgress] = useState<Record<VersionId, number>>({} as Record<VersionId, number>);
  const [cacheSize, setCacheSize] = useState<number | null>(null);

  useEffect(() => {
    if (!index) return;
    let cancelled = false;

    (async () => {
      for (const version of index.versions) {
        const cached = await isBookCached(version.id, 1);
        if (cancelled) return;
        setStatuses((prev) => ({ ...prev, [version.id]: cached ? "ready" : "idle" }));
      }
    })();

    cacheSizeEstimate().then((size) => !cancelled && setCacheSize(size));

    return () => {
      cancelled = true;
    };
  }, [index]);

  const download = async (versionId: VersionId) => {
    if (!index) return;
    setStatuses((prev) => ({ ...prev, [versionId]: "downloading" }));
    const bookNumbers = index.books.map((b) => b.n);
    await warmVersion(versionId, bookNumbers, (done, total) => {
      setProgress((prev) => ({ ...prev, [versionId]: Math.round((done / total) * 100) }));
    });
    setStatuses((prev) => ({ ...prev, [versionId]: "ready" }));
    cacheSizeEstimate().then(setCacheSize);
  };

  if (loading || !index) {
    return <p className={styles.hint}>Loading…</p>;
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.hint}>
        Every chapter caches itself as you read it — this is only for downloading a whole
        translation ahead of time, before a trip or a flight.
      </p>
      <div className={styles.list}>
        {index.versions.map((version) => {
          const status = statuses[version.id] ?? "idle";
          return (
            <div key={version.id} className={styles.row}>
              <div>
                <p className={styles.name}>{version.short}</p>
                <p className={styles.note}>{version.note}</p>
                <p className={styles.licence}>{version.licence}</p>
              </div>
              {status === "ready" && <span className={styles.ready}>Downloaded</span>}
              {status === "downloading" && (
                <span className={styles.progress}>{progress[version.id] ?? 0}%</span>
              )}
              {status === "idle" && (
                <Button variant="secondary" onClick={() => download(version.id)}>
                  Download
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className={styles.footer}>Total offline storage used: {formatBytes(cacheSize)}</p>
    </div>
  );
}
