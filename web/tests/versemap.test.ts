import assert from "node:assert/strict";
import test from "node:test";

const fixture = {
  SBL: {
    comparedTo: "BSB",
    toEnglish: {
      "45.14.24": "45.16.25",
      "45.14.25": "45.16.26",
      "45.14.26": "45.16.27",
      "45.16.25": null,
    },
    toSpanish: {
      "45.16.25": "45.14.24",
      "45.16.26": "45.14.25",
      "45.16.27": "45.14.26",
    },
    notes: {},
    divergentChapters: ["45.14", "45.16"],
  },
};

function respondOk() {
  return new Response(JSON.stringify(fixture), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = async () => respondOk();

test("English Romans 16 maps its doxology to Spanish Romans 14", async () => {
  const { alignChapter } = await import("@/lib/bible/versemap");
  const rows = await alignChapter("BSB", "SBL", "45.16", 27);
  assert.equal(rows.find((row) => row.fromVerse === 25)?.toKey, "45.14.24");
  assert.equal(rows.find((row) => row.fromVerse === 26)?.toKey, "45.14.25");
  assert.equal(rows.find((row) => row.fromVerse === 27)?.toKey, "45.14.26");
});

test("English Romans 16 includes an explicit row for the Spanish gap", async () => {
  const { alignChapter } = await import("@/lib/bible/versemap");
  const rows = await alignChapter("BSB", "SBL", "45.16", 27);
  assert.ok(
    rows.some(
      (row) => row.fromVerse === null && row.toKey === "45.16.25",
    ),
  );
});

test("a network/fetch failure fails closed, not a silent identity fallback", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const status = await versemap.getDivergenceStatus("45.16");
    assert.equal(status, "unknown");

    const mayDiverge = await versemap.chapterMayDiverge("45.16");
    assert.equal(mayDiverge, true, "must fail closed to true, never silently false");

    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
      "must throw instead of returning an identity zip that looks like a confirmed alignment",
    );

    const note = await versemap.divergenceNote("45.16");
    assert.notEqual(note, null, "must warn, not silently say there is no divergence");
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("a non-ok HTTP response fails closed the same way as a network failure", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    assert.equal(await versemap.chapterMayDiverge("45.16"), true);
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
    );
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("a malformed/unparseable JSON response fails closed the same way", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () =>
    new Response("{not valid json", { status: 200, headers: { "content-type": "application/json" } });
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    assert.equal(await versemap.chapterMayDiverge("45.16"), true);
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
    );
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("a chapter uninvolved with the divergent version still resolves to identity even when the map fails to load", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const rows = await versemap.alignChapter("BSB", "KJV", "45.16", 27);
    assert.equal(rows.length, 27);
    assert.equal(rows[0].fromVerse, 1);
    assert.equal(rows[0].toKey, "45.16.1");
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("the map loading successfully still produces a cheap identity zip for a non-divergent chapter", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => respondOk();
  try {
    assert.equal(await versemap.getDivergenceStatus("40.1"), "no-divergence");
    assert.equal(await versemap.chapterMayDiverge("40.1"), false);
    const rows = await versemap.alignChapter("BSB", "SBL", "40.1", 25);
    assert.equal(rows.length, 25);
    assert.deepEqual(rows[0], { fromVerse: 1, toKey: "40.1.1" });
    assert.equal(await versemap.divergenceNote("40.1"), null);
  } finally {
    versemap.__resetVerseMapCacheForTests();
  }
});

// ---------------------------------------------------------------------------
// Audit fixes: retry-after-failure, and content (shape) validation.
//
// The original fail-closed pass validated transport (response.ok) and
// parseability (JSON.parse) only, and memoized the FAILURE result forever.
// Both holes are exercised below with the exact auditor probes.
// ---------------------------------------------------------------------------

/** Wraps a fetch implementation with a call counter so "did it actually re-fetch?" is assertable. */
function countingFetch(impl: () => Promise<Response>) {
  const state = { calls: 0 };
  const fn = async () => {
    state.calls += 1;
    return impl();
  };
  return { state, fn };
}

function respondWith(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("FINDING 1: a failed load is not cached forever — a later call re-fetches and recovers", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  versemap.__setVerseMapRetryCooldownForTests(0);

  const failing = countingFetch(async () => {
    throw new Error("network down");
  });
  globalThis.fetch = failing.fn;
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
    );
    assert.equal(failing.state.calls, 2, "each call retries once the failure has settled");

    // Now the network comes back. Before this fix the module stayed stuck on
    // the cached failure until a full page reload.
    const working = countingFetch(async () => respondOk());
    globalThis.fetch = working.fn;

    assert.equal(
      await versemap.getDivergenceStatus("45.16"),
      "diverges",
      "must recover, not stay 'unknown' forever",
    );
    assert.equal(working.state.calls, 1, "the recovery call must actually hit the network again");

    const rows = await versemap.alignChapter("BSB", "SBL", "45.16", 27);
    assert.equal(rows.find((row) => row.fromVerse === 25)?.toKey, "45.14.24");
    assert.equal(
      working.state.calls,
      1,
      "and the recovered map is memoized — success is still cached for the session",
    );
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("FINDING 1: retrying does not become a fetch storm — in-flight is shared and failures back off", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();

  const failing = countingFetch(async () => {
    throw new Error("network down");
  });
  globalThis.fetch = failing.fn;
  try {
    // Concurrent callers (the reader fires divergenceNote + alignChapter together).
    const results = await Promise.all([
      versemap.getDivergenceStatus("45.16"),
      versemap.chapterMayDiverge("45.16"),
      versemap.divergenceNote("45.16"),
    ]);
    assert.equal(results[0], "unknown");
    assert.equal(results[1], true);
    assert.notEqual(results[2], null);
    assert.equal(failing.state.calls, 1, "concurrent callers share one in-flight fetch");

    // Sequential hammering inside the cooldown window must not re-fetch.
    for (let i = 0; i < 20; i += 1) {
      assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    }
    assert.equal(failing.state.calls, 1, "the post-failure cooldown suppresses a hammering loop");
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("FINDING 3: an HTTP 200 empty-object payload fails closed instead of reporting no divergence", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => respondWith({});
  try {
    assert.equal(
      await versemap.getDivergenceStatus("45.16"),
      "unknown",
      "a stale/partial deploy must not read as 'confirmed no divergence'",
    );
    assert.equal(await versemap.chapterMayDiverge("45.16"), true);
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
      "must not return 27 confident identity rows pairing the doxology against a blank slot",
    );
    assert.notEqual(await versemap.divergenceNote("45.16"), null);
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("FINDING 4: a JSON `null` payload surfaces the declared failure, never a raw TypeError", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => respondWith(null);
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    assert.equal(await versemap.chapterMayDiverge("45.16"), true);
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      (error: unknown) => {
        assert.ok(
          error instanceof versemap.VerseMapUnavailableError,
          `expected VerseMapUnavailableError, got ${(error as Error)?.name}`,
        );
        return true;
      },
    );
    assert.notEqual(
      await versemap.divergenceNote("45.16"),
      null,
      "divergenceNote must return its warning string, not throw (ChapterReader has no .catch)",
    );
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("FINDING 4: an entry missing divergentChapters surfaces the declared failure, never a raw TypeError", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () =>
    respondWith({ SBL: { comparedTo: "BSB", toEnglish: {}, toSpanish: {}, notes: {} } });
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    assert.equal(await versemap.chapterMayDiverge("45.16"), true);
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      (error: unknown) => {
        assert.ok(
          error instanceof versemap.VerseMapUnavailableError,
          `expected VerseMapUnavailableError, got ${(error as Error)?.name}`,
        );
        return true;
      },
    );
    assert.notEqual(await versemap.divergenceNote("45.16"), null);
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("FINDING 3: a payload that dropped the divergent version entirely fails closed", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () =>
    respondWith({
      KJV: { comparedTo: "BSB", toEnglish: {}, toSpanish: {}, notes: {}, divergentChapters: [] },
    });
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "unknown");
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
    );
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("FINDING 6: a second divergent version this build cannot align fails closed instead of misaligning", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () =>
    respondWith({
      ...fixture,
      YLT: {
        comparedTo: "BSB",
        toEnglish: {},
        toSpanish: {},
        notes: {},
        divergentChapters: ["45.16"],
      },
    });
  try {
    assert.equal(
      await versemap.getDivergenceStatus("45.16"),
      "unknown",
      "alignChapter's identity short-circuit ignores versions outside DIVERGENT_VERSIONS, so the whole map must fail closed",
    );
    await assert.rejects(
      () => versemap.alignChapter("BSB", "SBL", "45.16", 27),
      versemap.VerseMapUnavailableError,
    );
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});

test("the real shipped versemap.json satisfies the shape check", async () => {
  const versemap = await import("@/lib/bible/versemap");
  const { readFile } = await import("node:fs/promises");
  const shipped: unknown = JSON.parse(
    await readFile(new URL("../public/bible/versemap.json", import.meta.url), "utf8"),
  );
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => respondWith(shipped);
  try {
    assert.equal(await versemap.getDivergenceStatus("45.16"), "diverges");
    assert.equal(await versemap.getDivergenceStatus("40.1"), "no-divergence");
    const rows = await versemap.alignChapter("BSB", "SBL", "45.16", 27);
    assert.equal(rows.find((row) => row.fromVerse === 25)?.toKey, "45.14.24");
    assert.ok(rows.some((row) => row.fromVerse === null && row.toKey === "45.16.25"));
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
});
