import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntrySchema,
  updateEntrySchema,
} from "@/lib/api/entries";
import {
  syncEntrySchema,
  syncOpSchema,
  syncResponseSchema,
} from "@/lib/api/sync";

test("entry validation accepts a canonical verse in its chapter", () => {
  const result = createEntrySchema.safeParse({
    kind: "observation",
    body: "The wording changes.",
    chapter: "1.3",
    verse: "1.3.15",
    threads: ["wording"],
  });
  assert.equal(result.success, true);
});

test("canonical references accept two- and three-digit chapters and verses", () => {
  assert.equal(
    createEntrySchema.safeParse({
      kind: "observation",
      body: "The psalm turns.",
      chapter: "19.119",
      verse: "19.119.105",
      threads: ["word"],
    }).success,
    true,
  );
  assert.equal(
    createEntrySchema.safeParse({
      kind: "note",
      body: "The story continues.",
      chapter: "1.10",
      verse: "1.10.12",
      threads: ["nations"],
    }).success,
    true,
  );
});

test("canonical references reject chapters outside each book", () => {
  const base = {
    kind: "observation" as const,
    body: "This address is not in the canon.",
    threads: ["canon"],
  };
  for (const chapter of ["1.51", "19.151", "65.2", "66.23"]) {
    assert.equal(
      createEntrySchema.safeParse({ ...base, chapter }).success,
      false,
      chapter,
    );
  }
  for (const chapter of ["1.50", "19.150", "65.1", "66.22"]) {
    assert.equal(
      createEntrySchema.safeParse({ ...base, chapter }).success,
      true,
      chapter,
    );
  }
});

test("entry validation rejects a verse from another chapter", () => {
  const result = createEntrySchema.safeParse({
    kind: "observation",
    body: "The wording changes.",
    chapter: "1.3",
    verse: "1.4.1",
    threads: ["wording"],
  });
  assert.equal(result.success, false);
});

test("non-question entries cannot carry an answered timestamp", () => {
  const result = createEntrySchema.safeParse({
    kind: "note",
    body: "A note.",
    chapter: "1.3",
    threads: ["notes"],
    answeredAt: new Date().toISOString(),
  });
  assert.equal(result.success, false);
});

test("empty patches fail closed", () => {
  assert.equal(updateEntrySchema.safeParse({}).success, false);
});

test("new writing cannot skip the passage-to-thread rule", () => {
  assert.equal(
    createEntrySchema.safeParse({
      kind: "observation",
      body: "The wording changes.",
      chapter: "1.3",
      threads: [],
    }).success,
    false,
  );
});

test("sync accepts a threadless tombstone but rejects a threadless active entry", () => {
  const now = new Date().toISOString();
  const base = {
    id: crypto.randomUUID(),
    kind: "observation" as const,
    body: "Legacy writing",
    chapter: "1.3",
    threads: [],
    createdAt: now,
    updatedAt: now,
  };

  assert.equal(syncEntrySchema.safeParse(base).success, false);
  assert.equal(
    syncEntrySchema.safeParse({ ...base, deletedAt: now }).success,
    true,
  );
});

test("ink links reject executable URL schemes", () => {
  assert.equal(
    createEntrySchema.safeParse({
      kind: "note",
      body: "Sketch",
      chapter: "1.3",
      threads: ["image-of-god"],
      inkUrl: "javascript:alert(1)",
    }).success,
    false,
  );
});

test("ink links allow only the intended Apple Notes and web schemes", () => {
  const base = {
    kind: "note" as const,
    body: "Sketch",
    chapter: "1.3",
    threads: ["image-of-god"],
  };
  for (const inkUrl of [
    "applenotes://showNote?identifier=example",
    "mobilenotes://showNote?identifier=example",
    "https://www.icloud.com/notes/example",
    "http://localhost/note",
  ]) {
    assert.equal(
      createEntrySchema.safeParse({ ...base, inkUrl }).success,
      true,
      inkUrl,
    );
  }
  for (const inkUrl of ["ftp://example.com/note", "data:text/plain,note"]) {
    assert.equal(
      createEntrySchema.safeParse({ ...base, inkUrl }).success,
      false,
      inkUrl,
    );
  }
});

test("sync rejects cross-chapter verses and answered non-questions", () => {
  const now = new Date().toISOString();
  const base = {
    id: crypto.randomUUID(),
    kind: "observation" as const,
    body: "The wording changes.",
    chapter: "1.3",
    threads: ["wording"],
    createdAt: now,
    updatedAt: now,
  };
  assert.equal(
    syncEntrySchema.safeParse({ ...base, verse: "1.4.1" }).success,
    false,
  );
  assert.equal(
    syncEntrySchema.safeParse({ ...base, answeredAt: now }).success,
    false,
  );
});

test("sync rejects global stage data as a client mutation", () => {
  const now = new Date().toISOString();
  assert.equal(
    syncOpSchema.safeParse({
      id: crypto.randomUUID(),
      entity: "stage",
      entityId: "creation",
      op: "upsert",
      payload: {},
      updatedAt: now,
    }).success,
    false,
  );
});

test("sync responses fail closed before malformed remote data reaches IndexedDB", () => {
  assert.equal(
    syncResponseSchema.safeParse({
      entries: [
        {
          id: crypto.randomUUID(),
          kind: "observation",
          body: "Malformed remote address",
          chapter: "65.2",
          threads: ["canon"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      threads: [],
      people: [],
      progress: [],
      logs: [],
      rejected: [],
      serverTime: new Date().toISOString(),
    }).success,
    false,
  );
});
