/**
 * Where you left off reading, and which version/mode you had open. Plain
 * localStorage, not the sync engine — this is a UI convenience ("open the
 * app, land on today's chapter"), not study content, so it doesn't need to
 * survive a device switch and has no business in lib/sync (Track B's file).
 * Cross-device "resume reading" can graduate into readingProgress later if
 * it turns out to matter.
 */

import type { VersionId } from "@/lib/contracts";

const KEY = "bible-brain:last-read";

interface LastRead {
  book: number;
  chapter: number;
  version: VersionId;
  parallel: boolean;
}

const DEFAULT: LastRead = { book: 1, chapter: 1, version: "BSB", parallel: false };

export function getLastRead(): LastRead {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<LastRead>) };
  } catch {
    return DEFAULT;
  }
}

export function setLastRead(value: Partial<LastRead>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...getLastRead(), ...value }));
  } catch {
    // Storage can throw in private-browsing edge cases. Losing "resume here"
    // is not worth surfacing an error over.
  }
}
