/**
 * Client-side last-write-wins timestamps must advance even when two deliberate
 * edits land in the same system-clock millisecond.
 */
export function nextTimestamp(after?: string) {
  const now = Date.now();
  const previous = after ? Date.parse(after) : Number.NaN;
  return new Date(
    Number.isFinite(previous) ? Math.max(now, previous + 1) : now,
  ).toISOString();
}
