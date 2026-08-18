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
