"use client";

import { deleteDB } from "idb";

import { closeLocalDatabase } from "@/lib/sync/store";

const LOCAL_DATABASE = "bible-brain";
const APP_CACHE_PREFIXES = [
  "bible-brain-scripture",
  "bible-brain-shell",
] as const;

export async function clearLocalStudyData() {
  await closeLocalDatabase();
  const dbDeletion = deleteDB(LOCAL_DATABASE);
  const cacheDeletion =
    typeof caches === "undefined"
      ? Promise.resolve()
      : caches.keys().then(async (keys) => {
          await Promise.all(
            keys
              .filter((key) =>
                APP_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)),
              )
              .map((key) => caches.delete(key)),
          );
        });

  await Promise.all([dbDeletion, cacheDeletion]);
}
