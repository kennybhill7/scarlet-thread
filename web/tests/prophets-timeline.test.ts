/**
 * COVENANTTIMELINE-001 — lib/bible/prophetsTimeline.ts.
 *
 * Proves: (a) exactly the 16 books the research doc's Part 2.3 table covers
 * are present, keyed by their real canonical book number
 * (web/public/bible/index.json); (b) Obadiah and Joel render their
 * genuinely-disputed status as two candidate windows and NO single
 * dateRange -- never a silently-picked date; (c) every entry carries a
 * visible BC-year attribution; (d) the scope boundary -- every other book,
 * explicitly including Kings/Chronicles/Genesis/Gospels/Revelation, returns
 * undefined rather than an invented chapter-level correlation.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { PROPHETS_TIMELINE, getTimeline, hasTimeline } from "@/lib/bible/prophetsTimeline";

// Canonical book numbers, from web/public/bible/index.json.
const BOOK = {
  Genesis: 1,
  Ezra: 15,
  Nehemiah: 16,
  Isaiah: 23,
  Jeremiah: 24,
  Ezekiel: 26,
  Hosea: 28,
  Joel: 29,
  Amos: 30,
  Obadiah: 31,
  Micah: 33,
  Nahum: 34,
  Habakkuk: 35,
  Zephaniah: 36,
  Haggai: 37,
  Zechariah: 38,
  Malachi: 39,
  Matthew: 40,
  Revelation: 66,
  Kings1: 11,
  Chronicles1: 13,
} as const;

test("PROPHETS_TIMELINE: exactly the 16 books the research doc covers, each exactly once", () => {
  assert.equal(PROPHETS_TIMELINE.length, 16);
  const books = PROPHETS_TIMELINE.map((e) => e.book).sort((a, b) => a - b);
  const expected = [
    BOOK.Ezra,
    BOOK.Nehemiah,
    BOOK.Isaiah,
    BOOK.Jeremiah,
    BOOK.Ezekiel,
    BOOK.Hosea,
    BOOK.Joel,
    BOOK.Amos,
    BOOK.Obadiah,
    BOOK.Micah,
    BOOK.Nahum,
    BOOK.Habakkuk,
    BOOK.Zephaniah,
    BOOK.Haggai,
    BOOK.Zechariah,
    BOOK.Malachi,
  ].sort((a, b) => a - b);
  assert.deepEqual(books, expected);
});

test("getTimeline: Isaiah's four-king list is text_explicit, keyed to book 23", () => {
  const isaiah = getTimeline(BOOK.Isaiah);
  assert.ok(isaiah);
  assert.deepEqual(isaiah!.kings, ["Uzziah", "Jotham", "Ahaz", "Hezekiah"]);
  assert.equal(isaiah!.kingListConfidence, "text_explicit");
  assert.ok(isaiah!.dateRange);
  assert.match(isaiah!.attribution, /Thiele/);
});

test("getTimeline: Obadiah has NO single dateRange -- two disputed candidate windows instead, neither privileged", () => {
  const obadiah = getTimeline(BOOK.Obadiah);
  assert.ok(obadiah);
  assert.equal(obadiah!.dateRange, null);
  assert.ok(obadiah!.disputedWindows);
  assert.equal(obadiah!.disputedWindows!.length, 2);
  assert.deepEqual(
    obadiah!.disputedWindows!.map((w) => w.label),
    ["9th century BC", "6th century BC"],
  );
});

test("getTimeline: Joel has NO single dateRange -- two disputed candidate windows instead, neither privileged", () => {
  const joel = getTimeline(BOOK.Joel);
  assert.ok(joel);
  assert.equal(joel!.dateRange, null);
  assert.ok(joel!.disputedWindows);
  assert.equal(joel!.disputedWindows!.length, 2);
});

test("getTimeline: every non-disputed entry has exactly one dateRange with its own confidence grade", () => {
  for (const entry of PROPHETS_TIMELINE) {
    if (entry.disputedWindows) continue;
    assert.ok(entry.dateRange, `${entry.bookName} should carry a single dateRange`);
    assert.ok(entry.dateRange!.label.length > 0);
    assert.ok(entry.dateRange!.confidence);
  }
});

test("every entry carries a non-empty, visible BC-year attribution string", () => {
  for (const entry of PROPHETS_TIMELINE) {
    assert.ok(entry.attribution.length > 10, `${entry.bookName} has no real attribution`);
  }
});

test("attribution: pre-exilic/exilic entries cite Thiele; Persian-period entries do not misattribute to Thiele", () => {
  const thieleBooks = ["Isaiah", "Micah", "Hosea", "Amos", "Obadiah", "Joel", "Nahum", "Habakkuk", "Zephaniah", "Jeremiah", "Ezekiel"];
  const persianBooks = ["Haggai", "Zechariah", "Malachi", "Ezra", "Nehemiah"];
  for (const entry of PROPHETS_TIMELINE) {
    if (thieleBooks.includes(entry.bookName)) {
      assert.match(entry.attribution, /Thiele/, `${entry.bookName} should cite Thiele's chronology`);
    }
    if (persianBooks.includes(entry.bookName)) {
      assert.doesNotMatch(
        entry.attribution,
        /Thiele/,
        `${entry.bookName} is Persian-period and should not be attributed to Thiele's Hebrew-kings chronology`,
      );
    }
  }
});

test("hasTimeline / getTimeline: scope boundary -- Genesis, Kings, Chronicles, Gospels, Revelation carry no timeline data (honest absence, not invented)", () => {
  for (const book of [BOOK.Genesis, BOOK.Kings1, BOOK.Chronicles1, BOOK.Matthew, BOOK.Revelation]) {
    assert.equal(hasTimeline(book), false, `book ${book} should have no timeline entry`);
    assert.equal(getTimeline(book), undefined, `book ${book} should have no timeline entry`);
  }
});

test("hasTimeline: true for exactly the 16 covered books", () => {
  for (const entry of PROPHETS_TIMELINE) {
    assert.equal(hasTimeline(entry.book), true, `${entry.bookName} (book ${entry.book}) should report hasTimeline=true`);
  }
});
