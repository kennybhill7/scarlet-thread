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

globalThis.fetch = async () =>
  new Response(JSON.stringify(fixture), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

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
