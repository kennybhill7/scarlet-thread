"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useBibleIndex } from "@/lib/bible/useBibleIndex";
import {
  readLastReadServerSnapshot,
  readLastReadSnapshot,
  subscribeLastRead,
} from "@/lib/bible/lastRead";
import styles from "./BookPicker.module.css";

/**
 * Two-level picker: book grid, then that book's chapters. Not a single long
 * scroll — 66 books plus up to 150 chapters (Psalms) in one list would bury
 * the thing you actually came for.
 */
export function BookPicker() {
  const { index, loading } = useBibleIndex();
  const [openBook, setOpenBook] = useState<number | null>(null);
  // A-038: was `getLastRead()` called directly during render, which reads
  // localStorage -- invisible to the server, so the server pass and the
  // client's first pass could disagree on the "Continue reading" target.
  // useSyncExternalStore with a server snapshot matching what the server
  // actually rendered (DEFAULT) avoids that mismatch; see
  // lib/bible/lastRead.ts's own comment on why this follows
  // DeviceSessionControls.tsx's `residue` pattern rather than lib/theme.ts's
  // pre-paint bootstrap script.
  const lastRead = useSyncExternalStore(
    subscribeLastRead,
    readLastReadSnapshot,
    readLastReadServerSnapshot,
  );

  if (loading || !index) {
    return <p className={styles.hint}>Loading…</p>;
  }

  const active = index.books.find((b) => b.n === openBook);

  if (active) {
    return (
      <div className={styles.wrap}>
        <button className={styles.back} onClick={() => setOpenBook(null)}>
          ‹ Books
        </button>
        <h1 className={styles.bookTitle}>{active.name}</h1>
        <div className={styles.chapterGrid}>
          {Array.from({ length: active.chapters }, (_, i) => i + 1).map((chapter) => (
            <Link
              key={chapter}
              href={`/read/${active.n}/${chapter}`}
              className={styles.chapterCell}
            >
              {chapter}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <Link
        href={`/read/${lastRead.book}/${lastRead.chapter}`}
        className={styles.resume}
      >
        Continue reading →
      </Link>

      {(["OT", "NT"] as const).map((testament) => (
        <div key={testament}>
          <p className={styles.testament}>
            {testament === "OT" ? "Old Testament" : "New Testament"}
          </p>
          <div className={styles.bookGrid}>
            {index.books
              .filter((b) => b.testament === testament)
              .map((book) => (
                <button
                  key={book.n}
                  className={styles.bookCell}
                  onClick={() => setOpenBook(book.n)}
                >
                  {book.abbr}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
