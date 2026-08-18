/**
 * Gate 0.3 — the review page must distinguish "the database is unreachable"
 * from "this account genuinely has nothing yet." Exercises the real
 * `loadReviewViewModel` from `app/(app)/review/page.tsx` with its DB-backed
 * dependencies swapped for controlled fakes.
 *
 * `page.tsx` statically imports `server-only`-guarded modules
 * (`@/lib/auth/config`, `@/lib/db/review`, `@/lib/db/entries`,
 * `@/lib/db/threads`) and a CSS Module (`./review.module.css`), none of
 * which plain `node:test` can load: `server-only` throws unconditionally
 * outside a bundler, and there is no CSS-module loader here, so requiring
 * it unseeded fails with "Unexpected token '.'" on the CSS file's own first
 * selector, not a useful error. Both are neutralised in `require.cache`
 * before the page module loads, mirroring `tests/tenant-isolation.test.ts`'s
 * treatment of the same guard.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const nodeRequire = createRequire(__filename);

function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}

seedModule("server-only", {});
seedModule("@/app/(app)/review/review.module.css", {});

const {
  loadReviewViewModel,
  computeThreadRadar,
} = nodeRequire("@/app/(app)/review/page.tsx") as {
  loadReviewViewModel: typeof import("../app/(app)/review/page").loadReviewViewModel;
  computeThreadRadar: typeof import("../app/(app)/review/page").computeThreadRadar;
};

const emptySnapshot = {
  chaptersRead: 0,
  totalChapters: 1_189,
  stagesStudied: 0,
  totalStages: 0,
  openQuestions: 0,
  streak: 0,
  threads: [],
  coldThreads: [],
  orphanEntries: [],
  mirrorBreaks: [],
};

test("a DB read failure renders setup-incomplete, not a JSON-shaped hole", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    },
    getEntries: async () => [],
    getThreads: async () => [],
  });

  assert.equal(view.status, "setup-incomplete");
});

test("a missing DATABASE_URL-style failure on any one dependency also renders setup-incomplete", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => emptySnapshot,
    getEntries: async () => {
      throw new Error("missing DATABASE_URL");
    },
    getThreads: async () => [],
  });

  assert.equal(view.status, "setup-incomplete");
});

test("a genuinely empty account is NOT setup-incomplete: it renders the ordinary empty-state data", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => emptySnapshot,
    getEntries: async () => [],
    getThreads: async () => [],
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.deepEqual(view.data.snapshot, emptySnapshot);
  assert.deepEqual(view.data.radar, []);
  assert.deepEqual(view.data.teaching, []);
  assert.deepEqual(view.data.orphanEntries, []);
});

test("a populated account composes teaching, radar, and orphan labels from the real DB entry shape", async () => {
  const entries = [
    {
      id: "e-teach",
      kind: "teaching" as const,
      body: "Grace precedes obedience every time.",
      chapter: "45.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-orphan",
      kind: "observation" as const,
      body: "A note linked to nothing yet, long enough to need truncating in the orphan label display.",
      chapter: "1.3",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-radar-1",
      kind: "observation" as const,
      body: "covenant covenant covenant faithfulness recurs here constantly",
      chapter: "1.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-radar-2",
      kind: "question" as const,
      body: "Why does covenant keep showing up in every single passage",
      chapter: "2.1",
      threads: [],
      answeredAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-radar-3",
      kind: "observation" as const,
      body: "Another covenant sighting, third distinct passage now",
      chapter: "3.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => ({ ...emptySnapshot, orphanEntries: ["e-orphan"] }),
    getEntries: async () => entries,
    getThreads: async () => [],
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;

  assert.deepEqual(view.data.teaching, [
    { body: "Grace precedes obedience every time.", chapter: "45.1", threads: [] },
  ]);

  assert.equal(view.data.orphanEntries.length, 1);
  assert.equal(view.data.orphanEntries[0].id, "e-orphan");
  assert.ok(view.data.orphanEntries[0].label.startsWith("1.3 — "));
  assert.ok(view.data.orphanEntries[0].label.endsWith("…"));

  assert.equal(view.data.radar.length, 1);
  assert.equal(view.data.radar[0].word, "covenant");
  assert.equal(view.data.radar[0].count, 3);
});

test("computeThreadRadar requires three distinct chapters, not three mentions in one chapter", () => {
  const entries = [
    {
      id: "1",
      kind: "observation" as const,
      body: "wilderness wilderness wilderness wilderness",
      chapter: "1.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const hits = computeThreadRadar(entries, []);
  assert.deepEqual(hits, []);
});
