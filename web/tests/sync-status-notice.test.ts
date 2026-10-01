import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
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
 *
 * Unlike the "hookless view" components elsewhere in this codebase (e.g.
 * `ConnectSection.tsx`'s `CuratedConnectionRow`), `SyncStatusNotice` itself
 * has a real `useState`/`useEffect` (its production mode self-polls
 * `getSyncStatusV2()`), so it cannot be called as a plain function the way
 * those are — that executes the hook calls outside of React's render cycle
 * and throws. `createElement` (same technique `tests/claim-panes.test.ts`
 * already uses for a hook-bearing component in a plain `.ts` file, no JSX)
 * is what actually puts React's dispatcher in scope before the function body
 * runs.
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
  const html = renderToStaticMarkup(createElement(SyncStatusNotice as never, { status: null }));
  assert.equal(html, "");
});

test("SyncStatusNotice: renders nothing when nothing is pending or parked", () => {
  const html = renderToStaticMarkup(createElement(SyncStatusNotice as never, { status: status() }));
  assert.equal(html, "");
});

test("SyncStatusNotice: renders the exact learner-voice message when something is parked", () => {
  const html = renderToStaticMarkup(
    createElement(SyncStatusNotice as never, { status: status({ pendingCount: 1, parkedCount: 1 }) }),
  );
  // renderToStaticMarkup HTML-escapes the apostrophe to &#x27; -- match the escaped form, not a literal one.
  const escapedMessage = SYNC_NOTICE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:&#x27;|'|\u2019)");
  assert.match(html, new RegExp(escapedMessage));
  // Plain learner-voice copy -- no counts, no jargon like "conflict" or "parked". Decode the
  // apostrophe's own numeric HTML entity first, or its "27" would itself look like a stray digit.
  const rendered = html.replace(/&#x27;/g, "'");
  assert.doesNotMatch(rendered, /\bparked\b/i);
  assert.doesNotMatch(rendered, /\bconflict\b/i);
  assert.doesNotMatch(rendered, /\d/, "must not surface a count the learner could misread as a severity signal");
});

test("SyncStatusNotice: renders the same message for long-pending (non-parked) writing", () => {
  const longPendingStatus = status({ pendingCount: 1, parkedCount: 0, oldestPendingAgeMs: LONG_PENDING_THRESHOLD_MS + 1 });
  const html = renderToStaticMarkup(createElement(SyncStatusNotice as never, { status: longPendingStatus }));
  // renderToStaticMarkup HTML-escapes the apostrophe to &#x27; -- match the escaped form, not a literal one.
  assert.match(html, /couldn(?:&#x27;|'|’)t be saved to the server yet/);
});
