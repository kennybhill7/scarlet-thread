"use client";

import { openDB, type DBSchema } from "idb";

import type {
  DailyLog,
  Entry,
  Person,
  ReadingProgress,
  SyncOp,
  Thread,
} from "@/lib/contracts";
import {
  syncEntrySchema,
  syncLogSchema,
  syncPersonSchema,
  syncProgressSchema,
  syncThreadSchema,
} from "@/lib/api/sync";

interface BibleBrainDb extends DBSchema {
  entries: {
    key: string;
    value: Entry;
    indexes: { chapter: string; updatedAt: string };
  };
  threads: {
    key: string;
    value: Thread;
    indexes: { updatedAt: string };
  };
  progress: {
    key: string;
    value: ReadingProgress;
    indexes: { readAt: string };
  };
  logs: {
    key: string;
    value: DailyLog;
    indexes: { updatedAt: string };
  };
  people: {
    key: string;
    value: Person;
    indexes: { updatedAt: string };
  };
  syncQueue: {
    key: string;
    value: SyncOp;
    indexes: { updatedAt: string };
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

const database = openDB<BibleBrainDb>("bible-brain", 3, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const entries = db.createObjectStore("entries", { keyPath: "id" });
      entries.createIndex("chapter", "chapter");
      entries.createIndex("updatedAt", "updatedAt");

      const threads = db.createObjectStore("threads", { keyPath: "slug" });
      threads.createIndex("updatedAt", "updatedAt");

      const queue = db.createObjectStore("syncQueue", { keyPath: "id" });
      queue.createIndex("updatedAt", "updatedAt");
      db.createObjectStore("meta", { keyPath: "key" });
    }
    if (oldVersion < 2) {
      const progress = db.createObjectStore("progress", { keyPath: "chapter" });
      progress.createIndex("readAt", "readAt");
      const logs = db.createObjectStore("logs", { keyPath: "date" });
      logs.createIndex("updatedAt", "updatedAt");
    }
    if (oldVersion < 3) {
      const people = db.createObjectStore("people", { keyPath: "slug" });
      people.createIndex("updatedAt", "updatedAt");
    }
  },
});

function opFor(
  entity: "entry" | "thread",
  entityId: string,
  payload: Entry | Thread,
): SyncOp {
  return {
    id: crypto.randomUUID(),
    entity,
    entityId,
    op: payload.deletedAt ? "delete" : "upsert",
    payload,
    updatedAt: payload.updatedAt,
  };
}

export async function saveLocalEntry(entry: Entry) {
  const validated = syncEntrySchema.safeParse(entry);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid local entry",
    );
  }
  const db = await database;
  const transaction = db.transaction(["entries", "syncQueue"], "readwrite");
  await Promise.all([
    transaction.objectStore("entries").put(entry),
    transaction
      .objectStore("syncQueue")
      .put(opFor("entry", entry.id, entry)),
    transaction.done,
  ]);
}

export async function saveLocalThread(thread: Thread) {
  const validated = syncThreadSchema.safeParse(thread);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid local thread",
    );
  }
  const db = await database;
  const transaction = db.transaction(["threads", "syncQueue"], "readwrite");
  await Promise.all([
    transaction.objectStore("threads").put(thread),
    transaction
      .objectStore("syncQueue")
      .put(opFor("thread", thread.slug, thread)),
    transaction.done,
  ]);
}

export async function markChapterRead(progress: ReadingProgress) {
  const validated = syncProgressSchema.safeParse(progress);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid reading progress",
    );
  }
  const db = await database;
  const transaction = db.transaction(["progress", "syncQueue"], "readwrite");
  const op: SyncOp = {
    id: crypto.randomUUID(),
    entity: "progress",
    entityId: progress.chapter,
    op: "upsert",
    payload: progress,
    updatedAt: progress.readAt,
  };
  await Promise.all([
    transaction.objectStore("progress").put(progress),
    transaction.objectStore("syncQueue").put(op),
    transaction.done,
  ]);
}

export async function saveLocalLog(log: DailyLog) {
  const validated = syncLogSchema.safeParse(log);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid daily log",
    );
  }
  const db = await database;
  const transaction = db.transaction(["logs", "syncQueue"], "readwrite");
  const op: SyncOp = {
    id: crypto.randomUUID(),
    entity: "log",
    entityId: log.date,
    op: "upsert",
    payload: log,
    updatedAt: log.updatedAt,
  };
  await Promise.all([
    transaction.objectStore("logs").put(log),
    transaction.objectStore("syncQueue").put(op),
    transaction.done,
  ]);
}

export async function saveLocalPerson(person: Person) {
  const validated = syncPersonSchema.safeParse(person);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid person",
    );
  }
  const db = await database;
  const transaction = db.transaction(["people", "syncQueue"], "readwrite");
  const op: SyncOp = {
    id: crypto.randomUUID(),
    entity: "person",
    entityId: person.slug,
    op: "upsert",
    payload: person,
    updatedAt: person.updatedAt,
  };
  await Promise.all([
    transaction.objectStore("people").put(person),
    transaction.objectStore("syncQueue").put(op),
    transaction.done,
  ]);
}

export async function getLocalLog(date: string) {
  const db = await database;
  return db.get("logs", date);
}

export async function listReadingProgress() {
  const db = await database;
  return db.getAll("progress");
}

export async function listLocalEntries(chapter?: string) {
  const db = await database;
  const values = chapter
    ? await db.getAllFromIndex("entries", "chapter", chapter)
    : await db.getAll("entries");
  return values
    .filter((entry) => !entry.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listLocalThreads() {
  const db = await database;
  return (await db.getAll("threads"))
    .filter((thread) => !thread.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getPendingOps() {
  const db = await database;
  return db.getAllFromIndex("syncQueue", "updatedAt");
}

export async function removePendingOps(ids: string[]) {
  if (ids.length === 0) return;
  const db = await database;
  const transaction = db.transaction("syncQueue", "readwrite");
  await Promise.all([
    ...ids.map((id) => transaction.store.delete(id)),
    transaction.done,
  ]);
}

export async function mergeRemoteChanges(
  entries: Entry[],
  threads: Thread[],
  progress: ReadingProgress[] = [],
  logs: DailyLog[] = [],
  people: Person[] = [],
) {
  const db = await database;
  const transaction = db.transaction(
    ["entries", "threads", "progress", "logs", "people"],
    "readwrite",
  );

  for (const remote of entries) {
    const local = await transaction.objectStore("entries").get(remote.id);
    if (
      !local ||
      Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
    ) {
      await transaction.objectStore("entries").put(remote);
    }
  }
  for (const remote of threads) {
    const local = await transaction.objectStore("threads").get(remote.slug);
    if (
      !local ||
      Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
    ) {
      await transaction.objectStore("threads").put(remote);
    }
  }
  for (const remote of progress) {
    const local = await transaction
      .objectStore("progress")
      .get(remote.chapter);
    if (!local || Date.parse(remote.readAt) >= Date.parse(local.readAt)) {
      await transaction.objectStore("progress").put(remote);
    }
  }
  for (const remote of logs) {
    const local = await transaction.objectStore("logs").get(remote.date);
    if (
      !local ||
      Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
    ) {
      await transaction.objectStore("logs").put(remote);
    }
  }
  for (const remote of people) {
    const local = await transaction.objectStore("people").get(remote.slug);
    if (
      !local ||
      Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
    ) {
      await transaction.objectStore("people").put(remote);
    }
  }
  await transaction.done;
}

export async function getLastPull() {
  const db = await database;
  return (await db.get("meta", "lastPull"))?.value ?? null;
}

export async function setLastPull(value: string) {
  const db = await database;
  await db.put("meta", { key: "lastPull", value });
}

export async function closeLocalDatabase() {
  const db = await database;
  db.close();
}
