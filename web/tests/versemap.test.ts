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

test("CODEX_AUDIT A-036: English Romans 16's gap row sits in its canonical position, not appended after the whole chapter", async () => {
  const { alignChapter } = await import("@/lib/bible/versemap");
  const rows = await alignChapter("BSB", "SBL", "45.16", 27);

  // The full ordered sequence, not just "a gap row exists somewhere" (the
  // presence-only assertion this test used to make, and which would have
  // stayed green even with the gap wrongly appended at index 27). The blank
  // Spanish 16:25 slot (gap, own verse number 25) must land immediately
  // BEFORE the real row for English verse 25 -- English 24 -> Spanish 16:24,
  // then the gap, then English 25/26/27 -> the relocated Spanish 14:24-26
  // doxology -- not after English 27's row at the very end.
  const expected = [
    ...Array.from({ length: 24 }, (_, i) => ({ fromVerse: i + 1, toKey: `45.16.${i + 1}` })),
    { fromVerse: null, toKey: "45.16.25" },
    { fromVerse: 25, toKey: "45.14.24" },
    { fromVerse: 26, toKey: "45.14.25" },
    { fromVerse: 27, toKey: "45.14.26" },
  ];
  assert.deepEqual(rows, expected);
});

test("A-036 SYNTHETIC: a gap declared in the middle of a chapter (not near either edge) merges into its own correct position", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  // Modeled on the real Romans 14/16 shape (see the fixture above) but with
  // the target-only gap sitting at verse 5 of a 10-verse chapter -- squarely
  // in the middle, so this cannot pass by coincidence the way "near the end"
  // could. Verses 1-4 are identity; verses 5-10 are relocated to a different
  // chapter ("1.2"); the gap is the Spanish-only blank slot "1.1.5" that no
  // English verse maps onto.
  const midChapterFixture = {
    SBL: {
      comparedTo: "BSB",
      toEnglish: {
        "1.2.5": "1.1.5",
        "1.2.6": "1.1.6",
        "1.2.7": "1.1.7",
        "1.2.8": "1.1.8",
        "1.2.9": "1.1.9",
        "1.2.10": "1.1.10",
        "1.1.5": null,
      },
      toSpanish: {
        "1.1.5": "1.2.5",
        "1.1.6": "1.2.6",
        "1.1.7": "1.2.7",
        "1.1.8": "1.2.8",
        "1.1.9": "1.2.9",
        "1.1.10": "1.2.10",
      },
      notes: {},
      divergentChapters: ["1.1"],
    },
  };
  globalThis.fetch = async () =>
    new Response(JSON.stringify(midChapterFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const rows = await versemap.alignChapter("BSB", "SBL", "1.1", 10);
    assert.deepEqual(rows, [
      { fromVerse: 1, toKey: "1.1.1" },
      { fromVerse: 2, toKey: "1.1.2" },
      { fromVerse: 3, toKey: "1.1.3" },
      { fromVerse: 4, toKey: "1.1.4" },
      { fromVerse: null, toKey: "1.1.5" },
      { fromVerse: 5, toKey: "1.2.5" },
      { fromVerse: 6, toKey: "1.2.6" },
      { fromVerse: 7, toKey: "1.2.7" },
      { fromVerse: 8, toKey: "1.2.8" },
      { fromVerse: 9, toKey: "1.2.9" },
      { fromVerse: 10, toKey: "1.2.10" },
    ]);
  } finally {
    globalThis.fetch = async () => respondOk();
    versemap.__resetVerseMapCacheForTests();
  }
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
