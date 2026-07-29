import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { buildVaultArchive } from "@/lib/export/vault";

test("vault export writes both sides of every entry-thread link", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [
      {
        id: crypto.randomUUID(),
        kind: "observation",
        body: "The promise narrows.",
        chapter: "1.12",
        threads: ["covenant"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    threads: [
      {
        slug: "covenant",
        title: "Covenant",
        definition: "God binds himself by promise.",
        seeing: "",
        createdAt: now,
        updatedAt: now,
      },
    ],
    people: [],
    logs: [],
  });
  const files = unzipSync(archive);
  const passage = strFromU8(files["Bible Brain/01 Passages/1.12.md"]);
  const thread = strFromU8(files["Bible Brain/02 Threads/Covenant.md"]);
  assert.match(passage, /\[\[02 Threads\/Covenant\]\]/);
  assert.match(thread, /\[\[01 Passages\/1\.12\]\]/);
});

test("vault export omits soft-deleted writing", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [
      {
        id: crypto.randomUUID(),
        kind: "note",
        body: "Deleted",
        chapter: "1.1",
        threads: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
      },
    ],
    threads: [],
    people: [],
    logs: [],
  });
  const files = unzipSync(archive);
  assert.equal(files["Bible Brain/01 Passages/1.1.md"], undefined);
});

test("vault export preserves threads whose titles sanitize to the same file", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [
      {
        id: crypto.randomUUID(),
        kind: "observation",
        body: "Both links survive.",
        chapter: "1.1",
        threads: ["title-a", "title-b"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    threads: [
      {
        slug: "title-a",
        title: "Title?",
        definition: "First",
        seeing: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "title-b",
        title: "Title*",
        definition: "Second",
        seeing: "",
        createdAt: now,
        updatedAt: now,
      },
    ],
    people: [],
    logs: [],
  });
  const files = unzipSync(archive);
  const passage = strFromU8(files["Bible Brain/01 Passages/1.1.md"]);

  assert.ok(files["Bible Brain/02 Threads/Title-.md"]);
  assert.ok(files["Bible Brain/02 Threads/Title- (2).md"]);
  assert.match(passage, /\[\[02 Threads\/Title-\]\]/);
  assert.match(passage, /\[\[02 Threads\/Title- \(2\)\]\]/);
});

test("vault export does not emit links to soft-deleted threads", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [
      {
        id: crypto.randomUUID(),
        kind: "note",
        body: "Keep the note.",
        chapter: "1.1",
        threads: ["retired"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    threads: [
      {
        slug: "retired",
        title: "Retired",
        definition: "",
        seeing: "",
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
      },
    ],
    people: [],
    logs: [],
  });
  const files = unzipSync(archive);
  const passage = strFromU8(files["Bible Brain/01 Passages/1.1.md"]);

  assert.doesNotMatch(passage, /02 Threads/);
  assert.equal(files["Bible Brain/02 Threads/Retired.md"], undefined);
});

test("vault export preserves people whose names collide as filenames", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [],
    threads: [],
    people: [
      {
        slug: "first-sam",
        name: "Sam?",
        body: "First",
        chapters: [],
        threads: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "second-sam",
        name: "Sam*",
        body: "Second",
        chapters: [],
        threads: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        slug: "device-name",
        name: "CON",
        body: "Portable on Windows",
        chapters: [],
        threads: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    logs: [],
  });
  const files = unzipSync(archive);

  assert.ok(files["Bible Brain/03 People/Sam-.md"]);
  assert.ok(files["Bible Brain/03 People/Sam- (2).md"]);
  assert.ok(files["Bible Brain/03 People/_CON.md"]);
});
