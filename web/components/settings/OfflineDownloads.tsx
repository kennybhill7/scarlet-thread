"use client";

import { useEffect, useState } from "react";
import type { BibleIndex, VersionId } from "@/lib/contracts";
import { useBibleIndex } from "@/lib/bible/useBibleIndex";
import { cacheSizeEstimate, isVersionFullyCached, warmVersion } from "@/lib/bible/loader";
import { Button } from "@/components/ui/Button";
import styles from "./OfflineDownloads.module.css";

export type Status = "idle" | "checking" | "downloading" | "ready" | "error";

export type DownloadResult = { ok: true } | { ok: false; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Download failed.";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * The init effect's real logic, extracted as a pure (hookless) async
 * function so it is directly testable without a DOM — same technique
 * components/reader/ChapterReader.tsx's resolveAlignment() uses (see
 * tests/versemap-offline.test.ts), which this repo's test environment note
 * (tsx --test, plain Node, no jsdom) requires for anything that runs inside
 * a useEffect, since effects never fire under react-dom/server's
 * renderToStaticMarkup.
 *
 * CODEX_AUDIT A-022: checks EVERY book of each translation via
 * isVersionFullyCached(), not just book 1 — reading Genesis alone used to be
 * enough for Settings to claim the whole Bible was ready for a flight.
 */
export async function resolveInitialStatuses(
  index: BibleIndex,
  isCancelled: () => boolean = () => false,
): Promise<Array<{ versionId: VersionId; status: Status }>> {
  const bookNumbers = index.books.map((b) => b.n);
  const results: Array<{ versionId: VersionId; status: Status }> = [];
  for (const version of index.versions) {
    const cached = await isVersionFullyCached(version.id, bookNumbers);
    if (isCancelled()) return results;
    results.push({ versionId: version.id, status: cached ? "ready" : "idle" });
  }
  return results;
}

/**
 * The download button's real logic, extracted the same way as
 * resolveInitialStatuses() above. Wraps warmVersion() in try/catch and
 * resolves a discriminated result instead of ever rejecting — CODEX_AUDIT
 * A-021: OfflineDownloads previously `await`ed warmVersion() directly with
 * no try/catch, so a real book-fetch failure inside its loop (warmVersion
 * only swallows its OWN versemap.json prefetch failure, never a loadBook()
 * failure) rejected this call with nothing catching it, leaving the caller's
 * "downloading" status stuck forever with no error and no way to retry.
 *
 * Books that finished downloading before the failure stay cached — warmVersion
 * only skips its completion marker on failure, it never undoes prior
 * progress — so calling this again resumes rather than starting over.
 */
export async function runDownload(
  versionId: VersionId,
  bookNumbers: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<DownloadResult> {
  try {
    await warmVersion(versionId, bookNumbers, onProgress);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
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
  const [errors, setErrors] = useState<Record<VersionId, string>>({} as Record<VersionId, string>);
  const [cacheSize, setCacheSize] = useState<number | null>(null);

  useEffect(() => {
    if (!index) return;
    let cancelled = false;

    resolveInitialStatuses(index, () => cancelled).then((results) => {
      if (cancelled) return;
      setStatuses((prev) => {
        const next = { ...prev };
        for (const { versionId, status } of results) next[versionId] = status;
        return next;
      });
    });

    cacheSizeEstimate().then((size) => !cancelled && setCacheSize(size));

    return () => {
      cancelled = true;
    };
  }, [index]);

  const download = async (versionId: VersionId) => {
    if (!index) return;
    setStatuses((prev) => ({ ...prev, [versionId]: "downloading" }));
    setErrors((prev) => {
      if (!(versionId in prev)) return prev;
      const next = { ...prev };
      delete next[versionId];
      return next;
    });
    const bookNumbers = index.books.map((b) => b.n);
    const result = await runDownload(versionId, bookNumbers, (done, total) => {
      setProgress((prev) => ({ ...prev, [versionId]: Math.round((done / total) * 100) }));
    });
    if (result.ok) {
      setStatuses((prev) => ({ ...prev, [versionId]: "ready" }));
      cacheSizeEstimate().then(setCacheSize);
    } else {
      setStatuses((prev) => ({ ...prev, [versionId]: "error" }));
      setErrors((prev) => ({ ...prev, [versionId]: result.message }));
    }
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
              {status === "error" && (
                <div className={styles.errorGroup}>
                  <span className={styles.error} role="alert">
                    {errors[version.id] ?? "Download failed."}
                  </span>
                  <Button variant="secondary" onClick={() => download(version.id)}>
                    Retry
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className={styles.footer}>Total offline storage used: {formatBytes(cacheSize)}</p>
    </div>
  );
}
