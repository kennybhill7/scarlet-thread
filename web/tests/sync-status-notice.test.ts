import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  LONG_PENDING_THRESHOLD_MS,
  SYNC_NOTICE_MESSAGE,
  SyncStatusNotice,
  shouldShowSyncNotice,
} from "@/components/sync/SyncStatusNotice";
import type { SyncStatusV2 } from "@/lib/sync/store";

/**
 * SYNCFLUSH-001 — the sync-status notice: a minimal, honest, learner-voice
 * line shown ONLY when something is parked or has been pending a long time.
 * No jsdom in this suite (same discipline as tests/claim-panes.test.ts):
 * `shouldShowSyncNotice` is tested as a pure function, and the component is
 * rendered via `react-dom/server`'s `renderToStaticMarkup` with an injected
 * `status` prop, so no `useEffect`/polling ever runs in this file.
 */

function status(overrides: Partial<SyncStatusV2> = {}): SyncStatusV2 {
  return { pendingCount: 0, parkedCount: 0, oldestPendingAgeMs: null, ...overrides };
}

test("shouldShowSyncNotice: null status (not loaded, or no IndexedDB) never shows", () => {
  assert.equal(shouldShowSyncNotice(null), false);
});

test("shouldShowSyncNotice: nothing pending or parked never shows", () => {
  assert.equal(shouldShowSyncNotice(status()), false);
});

test("shouldShowSyncNotice: any parked op shows, regardless of age", () => {
  assert.equal(shouldShowSyncNotice(status({ pendingCount: 1, parkedCount: 1, oldestPendingAgeMs: 0 })), true);
});

test("shouldShowSyncNotice: pending but young (not parked) does not show", () => {
  assert.equal(
    shouldShowSyncNotice(
      status({ pendingCount: 1, parkedCount: 0, oldestPendingAgeMs: LONG_PENDING_THRESHOLD_MS - 1 }),
    ),
    false,
  );
});

test("shouldShowSyncNotice: pending and old (not parked) shows at the threshold", () => {
  assert.equal(
    shouldShowSyncNotice(
      status({ pendingCount: 1, parkedCount: 0, oldestPendingAgeMs: LONG_PENDING_THRESHOLD_MS }),
    ),
    true,
  );
});

test("shouldShowSyncNotice: pendingCount 0 never shows even if oldestPendingAgeMs is stale data", () => {
  assert.equal(
    shouldShowSyncNotice(status({ pendingCount: 0, parkedCount: 0, oldestPendingAgeMs: 999_999 })),
    false,
  );
});

test("SyncStatusNotice: renders nothing for an injected null status", () => {
  const html = renderToStaticMarkup(SyncStatusNotice({ status: null }));
  assert.equal(html, "");
});

test("SyncStatusNotice: renders nothing when nothing is pending or parked", () => {
  const html = renderToStaticMarkup(SyncStatusNotice({ status: status() }));
  assert.equal(html, "");
});

test("SyncStatusNotice: renders the exact learner-voice message when something is parked", () => {
  const html = renderToStaticMarkup(
    SyncStatusNotice({ status: status({ pendingCount: 1, parkedCount: 1 }) }),
  );
  assert.match(html, new RegExp(SYNC_NOTICE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Plain learner-voice copy -- no counts, no jargon like "conflict" or "parked".
  assert.doesNotMatch(html, /\bparked\b/i);
  assert.doesNotMatch(html, /\bconflict\b/i);
  assert.doesNotMatch(html, /\d/, "must not surface a count the learner could misread as a severity signal");
});

test("SyncStatusNotice: renders the same message for long-pending (non-parked) writing", () => {
  const html = renderToStaticMarkup(
    SyncStatusNotice({
      status: status({ pendingCount: 1, parkedCount: 0, oldestPendingAgeMs: LONG_PENDING_THRESHOLD_MS + 1 }),
    }),
  );
  assert.match(html, /couldn.t be saved to the server yet/);
});
