"use client";

import Link from "next/link";
import { useState } from "react";
import { useBibleIndex } from "@/lib/bible/useBibleIndex";
import { getLastRead } from "@/lib/bible/lastRead";
import styles from "./BookPicker.module.css";

/**
 * Two-level picker: book grid, then that book's chapters. Not a single long
 * scroll — 66 books plus up to 150 chapters (Psalms) in one list would bury
 * the thing you actually came for.
 */
export function BookPicker() {
  const { index, loading } = useBibleIndex();
  const [openBook, setOpenBook] = useState<number | null>(null);
  const lastRead = getLastRead();

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
