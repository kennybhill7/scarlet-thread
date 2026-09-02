/**
 * COVENANTTIMELINE-001 — Part 2: the timeline rail's data (prophetic books
 * only, matching what `design/COVENANT_TIMELINE_RESEARCH.md` Part 2
 * actually researched).
 *
 * Covers exactly the books that document's §2.3 table covers: the 14
 * prophetic books (Isaiah, Jeremiah, Ezekiel, Hosea, Joel, Amos, Obadiah,
 * Micah, Nahum, Habakkuk, Zephaniah, Haggai, Zechariah, Malachi) plus Ezra
 * and Nehemiah as post-exilic context. Every king name, BC range, and
 * confidence grade is transcribed from that table (or §2.4 for the Persian
 * kings referenced in Haggai/Zechariah/Ezra/Nehemiah's entries) — nothing
 * here is invented or filled in from background knowledge.
 *
 * SCOPE BOUNDARY (per the task brief, carrying forward the research doc's
 * own §2.1/§2.3 framing): this module does NOT attempt chapter-level
 * correlation within 1–2 Kings, 1–2 Chronicles, or any other narrative book
 * to a specific king's reign. The doc gives reign-year tables and
 * book-level prophet placements, not a chapter-by-chapter mapping, and
 * inventing one would go beyond what was actually sourced. `getTimeline`
 * therefore returns data for exactly the 16 books below and undefined for
 * every other book, INCLUDING Kings/Chronicles themselves — that is an
 * honest absence, not a bug.
 *
 * OBADIAH AND JOEL: the doc grades both as genuinely disputed among
 * scholars, not merely uncertain-but-converging. Both entries carry
 * `disputedWindows` (two labeled candidate windows) and NO single
 * `dateRange`, so no UI built on this data can silently collapse them to
 * one guessed date — `getTimeline("Obadiah")`/`("Joel")` simply has no
 * single date to hand a careless caller.
 *
 * BC-YEAR ATTRIBUTION: the task brief requires every BC year here to carry
 * a visible "per Thiele's chronology" (or equivalent) attribution — the
 * doc's own §2.5 recommendation, because Thiele's is a real, named,
 * reconstructed scholarly chronology, not the app's own claim (§2.1's
 * "bottom line": treat exact BC year boundaries as historical_context /
 * inference, not text_explicit). That attribution is literally correct for
 * every pre-exilic/exilic entry below (Isaiah through Ezekiel), because
 * Thiele's 1951 work is specifically a reconciliation of the Hebrew kings'
 * regnal years. It would be a NEW inaccuracy — not present in the doc — to
 * stamp "Thiele's chronology" on the Persian-period entries (Haggai,
 * Zechariah, Malachi, Ezra, Nehemiah): Thiele's book does not cover Persian
 * regnal years at all; those BC conversions rest on independently attested
 * Persian-period records (per the doc's own §2.3/§2.4 sourcing — ESV Global
 * Study Bible charts, Ligonier's post-exilic overview). Those five entries
 * are attributed instead to "standard Persian-period regnal chronology",
 * which is what the doc's own citations actually support, while still
 * satisfying the task brief's "'per Thiele's chronology' — or similar"
 * instruction. Flagged as a deliberate, documented judgment call in the
 * task report, not a silent deviation from the doc.
 */

import type { EpistemicBasis } from "@/lib/contracts/study-v2";

const THIELE_ATTRIBUTION = "BC dates per Thiele's chronology (a scholarly reconstruction, not stated in the biblical text) — ESV Global Study Bible charts.";
const PERSIAN_ATTRIBUTION = "BC dates per standard Persian-period regnal chronology (Ligonier's post-exilic prophets overview; ESV Global Study Bible) — a separate, independently attested reconstruction from the Hebrew-kings system used elsewhere in this data, since the Judah/Israel monarchy had already ended by this period.";

export interface DisputedWindow {
  /** Human label for the candidate window, e.g. "9th century BC". */
  label: string;
  /** The doc's own approx range for that candidate, e.g. "c. 850–840 BC". */
  range: string;
  /** What ties this candidate to the text, in the doc's own words. */
  basis: string;
}

export interface ProphetTimelineEntry {
  /** Canonical 1–66 book number (web/public/bible/index.json). */
  book: number;
  bookName: string;
  kingdom: string;
  /** King(s) named or inferred, in the doc's own language. */
  kings: string[];
  kingListConfidence: EpistemicBasis;
  /**
   * Null only for the two genuinely disputed books (Obadiah, Joel) — see
   * `disputedWindows` instead. Every other entry has exactly one.
   */
  dateRange: { label: string; confidence: EpistemicBasis } | null;
  /** Populated only for Obadiah and Joel: two candidate windows, neither privileged as "the" answer. */
  disputedWindows?: DisputedWindow[];
  /** Doc's own commentary — states what the text/scholarship says, asserts nothing about meaning. */
  notes: string;
  /** Visible, one-line BC-year sourcing disclosure (task brief requirement). */
  attribution: string;
}

export const PROPHETS_TIMELINE: readonly ProphetTimelineEntry[] = [
  {
    book: 23,
    bookName: "Isaiah",
    kingdom: "Judah (oracles also address Israel/nations)",
    kings: ["Uzziah", "Jotham", "Ahaz", "Hezekiah"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "c. 740–681 BC", confidence: "historical_context" },
    notes:
      "The four-king list is directly named in Isaiah 1:1. Isaiah 6:1 dates the inaugural vision to the year of Uzziah's death, usually placed c. 740/739 BC.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 33,
    bookName: "Micah",
    kingdom: "Judah (addresses both Judah and Samaria/Israel)",
    kings: ["Jotham", "Ahaz", "Hezekiah"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "c. 735–710 BC (most-cited range; some sources place the start closer to 750 BC)", confidence: "inference" },
    notes: "King list directly named in Micah 1:1; contemporary with the latter part of Isaiah's ministry.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 28,
    bookName: "Hosea",
    kingdom: "Israel (Northern Kingdom), addressed from within Israel",
    kings: ["Jeroboam II (Israel)", "Uzziah, Jotham, Ahaz, Hezekiah (Judah)"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "c. 750–722 BC (Jeroboam II's reign through the fall of Samaria)", confidence: "inference" },
    notes:
      "Hosea 1:1 names four Judahite kings but only one Israelite king, despite Hosea ministering mainly to Israel — the superscription itself, not a gap in this data.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 30,
    bookName: "Amos",
    kingdom: "Israel (a Judean sent to prophesy against the Northern Kingdom)",
    kings: ["Uzziah (Judah)", "Jeroboam II (Israel)"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "c. 760–750 BC, a short ministry window (some sources say as brief as ~2 years)", confidence: "inference" },
    notes:
      "King pairing directly named in Amos 1:1; the book adds \"two years before the earthquake,\" a datable event placed archaeologically c. 760/750 BC.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 31,
    bookName: "Obadiah",
    kingdom: "Judah/Edom oracle",
    kings: [],
    kingListConfidence: "inference",
    dateRange: null,
    disputedWindows: [
      {
        label: "9th century BC",
        range: "c. 850–840 BC",
        basis: "Reign of Jehoram of Judah, tied to 2 Chronicles 21's Edom/Philistine raid.",
      },
      {
        label: "6th century BC",
        range: "c. 586–553 BC",
        basis: "Post-586 BC, responding to Edom's role in Jerusalem's fall to Babylon.",
      },
    ],
    notes:
      "No king is named in the text at all. Genuinely disputed — proposed dates in the wider literature range from the 9th to the 4th century BC; no scholarly consensus exists. Do not treat either candidate window as settled.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 29,
    bookName: "Joel",
    kingdom: "Judah",
    kings: [],
    kingListConfidence: "inference",
    dateRange: null,
    disputedWindows: [
      {
        label: "9th century BC (older conservative view)",
        range: "9th century BC, before Amos",
        basis: "On the theory that Amos quotes Joel; no royal superscription to confirm it.",
      },
      {
        label: "Post-exilic (modern critical consensus)",
        range: "c. 400s BC",
        basis: "Argued from internal evidence and quotation patterns, not a named king.",
      },
    ],
    notes:
      "No royal superscription at all — dating is argued entirely from internal evidence. The most uncertain prophet in this set; no king can be named with confidence either way.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 34,
    bookName: "Nahum",
    kingdom: "Judah (oracle against Nineveh/Assyria)",
    kings: ["Josiah (by common association — not named in the text)"],
    kingListConfidence: "inference",
    dateRange: {
      label: "c. 663–612 BC (fall of Thebes to fall of Nineveh), most commonly narrowed to c. 640s–630s BC",
      confidence: "inference",
    },
    notes:
      "No king is named in the text. The outer bounds (after Thebes fell, 663 BC, mentioned as past; before Nineveh's fall, 612 BC) are text-internal and fairly firm; the narrower window and the \"under Josiah\" placement are inference.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 35,
    bookName: "Habakkuk",
    kingdom: "Judah",
    kings: ["Jehoiakim (by internal evidence — not named in the text)"],
    kingListConfidence: "inference",
    dateRange: { label: "c. 609–598 BC, often narrowed to c. 605–597 BC", confidence: "inference" },
    notes:
      "No king is named directly; internal evidence (the rise of the Chaldeans/Babylonians and the coming Babylonian invasion, Habakkuk 1:5–6) places it in Jehoiakim's reign.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 36,
    bookName: "Zephaniah",
    kingdom: "Judah",
    kings: ["Josiah"],
    kingListConfidence: "text_explicit",
    dateRange: {
      label: "c. 640–609 BC, commonly narrowed to c. 630s BC (before Josiah's reforms of 622 BC, per most readings)",
      confidence: "inference",
    },
    notes: "King directly named in Zephaniah 1:1; the narrower-year placement is inference.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 24,
    bookName: "Jeremiah",
    kingdom: "Judah",
    kings: ["Josiah (from his 13th year)", "Jehoahaz (implied)", "Jehoiakim", "Jehoiachin (implied)", "Zedekiah"],
    kingListConfidence: "text_explicit",
    dateRange: {
      label: "Ministry c. 627–586 BC (some sources start 626 BC)",
      confidence: "inference",
    },
    notes:
      "Jeremiah 1:2–3 directly frames the start (13th year of Josiah) and endpoint (\"to the captivity of Jerusalem in the fifth month\"); the exact calendar-year conversion is inference.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 26,
    bookName: "Ezekiel",
    kingdom: "Judah/exiles (ministered from Babylon, among the exiles)",
    kings: [
      "Dated by years of Jehoiachin's exile, not a king's own regnal year",
      "Zedekiah reigned as vassal-king in Jerusalem during this ministry",
    ],
    kingListConfidence: "text_explicit",
    dateRange: {
      label: "First oracle 593 BC (\"5th year of Jehoiachin's exile,\" Ezekiel 1:2); last dated oracle c. 571 BC",
      confidence: "historical_context",
    },
    notes:
      "The dating method itself and the start year are directly stated (Ezekiel 1:1–2). The underlying anchor — Jehoiachin's exile beginning 597 BC — is a Thiele-dependent reconstruction, though well-corroborated by independent Babylonian records.",
    attribution: THIELE_ATTRIBUTION,
  },
  {
    book: 37,
    bookName: "Haggai",
    kingdom: "Post-exilic Judah (no king — Persian-period province)",
    kings: ["Darius I of Persia (dated by his regnal year, not a Judahite king — the monarchy had ended)"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "520 BC, a very short, tightly-dated ministry (a few months)", confidence: "text_explicit" },
    notes: "Every oracle is dated to Darius's regnal year, month, and day (2nd year of Darius).",
    attribution: PERSIAN_ATTRIBUTION,
  },
  {
    book: 38,
    bookName: "Zechariah",
    kingdom: "Post-exilic Judah",
    kings: ["Darius I of Persia"],
    kingListConfidence: "text_explicit",
    dateRange: {
      label: "520–518 BC for the dated oracles (chapters 1–8); undated material in chapters 9–14 is more uncertain",
      confidence: "text_explicit",
    },
    notes:
      "Chapters 1–8 are directly dated to Darius I. Chapters 9–14 carry no internal date marker; some scholars argue for later or composite authorship — that authorship question is unresolved and not adjudicated here.",
    attribution: PERSIAN_ATTRIBUTION,
  },
  {
    book: 39,
    bookName: "Malachi",
    kingdom: "Post-exilic Judah",
    kings: ["No king named — Persian-period province; commonly placed under Artaxerxes I by context, not by any date the text itself gives"],
    kingListConfidence: "inference",
    dateRange: {
      label: "Commonly placed c. 460–430 BC, in the general era of Ezra/Nehemiah's reforms",
      confidence: "inference",
    },
    notes:
      "No explicit regnal dating anywhere in the text. Placement is by content resemblance (temple already rebuilt, a corrupt priesthood, concerns similar to Nehemiah's reforms), not an internal date marker.",
    attribution: PERSIAN_ATTRIBUTION,
  },
  {
    book: 15,
    bookName: "Ezra",
    kingdom: "Return from exile",
    kings: ["Cyrus (initial decree)", "Artaxerxes I (Ezra's own return)"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "538 BC decree; Ezra's own mission 458 BC", confidence: "historical_context" },
    notes:
      "Dates within Ezra are directly stated relative to these kings' reigns. Scholars note a roughly 57-year narrative gap between Ezra 6 and Ezra 7.",
    attribution: PERSIAN_ATTRIBUTION,
  },
  {
    book: 16,
    bookName: "Nehemiah",
    kingdom: "Return from exile",
    kings: ["Artaxerxes I (Nehemiah was his cupbearer)"],
    kingListConfidence: "text_explicit",
    dateRange: { label: "Mission 445 BC; the wall completed the same year", confidence: "historical_context" },
    notes: "Dates within Nehemiah are directly stated relative to Artaxerxes I's reign.",
    attribution: PERSIAN_ATTRIBUTION,
  },
] as const;

const TIMELINE_BY_BOOK: ReadonlyMap<number, ProphetTimelineEntry> = new Map(
  PROPHETS_TIMELINE.map((entry) => [entry.book, entry]),
);

/**
 * The only lookup this module offers: by canonical book number. Returns
 * undefined for every book outside the 14 prophetic books + Ezra/Nehemiah —
 * including Kings/Chronicles, Genesis, the Gospels, Revelation, and every
 * other book in the canon. That is a scope boundary, not a bug: see the
 * module header.
 */
export function getTimeline(book: number): ProphetTimelineEntry | undefined {
  return TIMELINE_BY_BOOK.get(book);
}

/** True for exactly the 16 books this module covers — a cheap existence check for callers that just need to decide whether to render anything. */
export function hasTimeline(book: number): boolean {
  return TIMELINE_BY_BOOK.has(book);
}
