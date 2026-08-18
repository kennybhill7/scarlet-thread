"""Download and convert the Spanish Bible from eBible USFM, then diff its versification.

Source: ebible.org — Santa Biblia libre Latinoamericano (spabll), public domain,
"Redistributable: True" in the eBible catalogue. Latin American dialect and modern
vocabulary, which is the point: Reina-Valera 1909 is public domain too but reads as
1909 Spanish (vosotros, archaic vocabulary) and is a poor model for actual fluency.

eBible ships USFM, not JSON, so this needs its own parser -- `build_bible.py` handles
the scrollmapper JSON sources and cannot read this.

The versification diff matters more than it looks. spabll reports 31,103 verses against
BSB's 31,102. A parallel reader that assumes 1:1 alignment and is wrong shows silently
mismatched panes, which is worse than shipping no parallel view at all. This script
locates every divergence instead of guessing.

--- Fail-closed build (CODEX_AUDIT A-004 / Gate 0.6, CORPUS-001) -------------
The archive is downloaded and parsed entirely into memory, then validated
(build_bible.validate_version_payload, imported and reused rather than
duplicated) BEFORE anything is written to disk. Only after validation passes
does this script write the SBL/ directory into a staging path and swap it
into place with build_bible.atomic_replace_dir -- the same fail-closed,
delete-last pattern build_bible.py uses for the English tree. versemap.json
and index.json are themselves only overwritten (via os.replace, atomic for a
single file) once the directory swap above has already succeeded.
A validation failure exits non-zero with a stderr report and leaves
web/public/bible/SBL, versemap.json and index.json byte-identical to what
they were before the run.

Usage:  py tools/build_spanish.py [--force]
Author: Kenneth Hill
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

from build_bible import (
    CANON,
    ROOT,
    TOTAL_CHAPTERS,
    ValidationIssue,
    atomic_replace_dir,
    validate_version_payload,
)

CACHE_DIR = ROOT / "tools" / ".cache"
OUTPUT_DIR = ROOT / "web" / "public" / "bible"
STAGING_DIR = ROOT / "web" / "public" / "bible-sbl.staging"
REPORT_FILE = ROOT / "tools" / "versification-report.md"

USER_AGENT = "bible-brain-build/1.0 (+local study app)"

VERSION_ID = "SBL"
VERSION_META = {
    "id": VERSION_ID,
    "name": "Santa Biblia libre Latinoamericano",
    "short": "Biblia libre",
    "year": "2026",
    "licence": "Public domain. Redistributable per the eBible.org catalogue.",
    "note": "Latin American Spanish, modern vocabulary. The parallel-reading default.",
    "language": "es",
    "source": "https://ebible.org/Scriptures/spabll_usfm.zip",
}

# The English version the Spanish pane is aligned against.
COMPARE_TO = "BSB"

# Declared expectation this edition's total verse count must match
# (tools/versification-report.md: 31,103 vs BSB's 31,102 -- see VERSE_MAP
# below for the +1 explained by the Romans 14/16 doxology placement).
DECLARED_VERSE_TOTAL = 31_103

# Known textual-omission verses for this edition: an empty verse slot is only
# tolerated at validation time if declared here (see build_bible.py's
# DECLARED_OMISSIONS for the same fail-closed pattern applied to English).
#
# HONEST GAP: CODEX_AUDIT A-028 reports 5 empty numbered slots in SBL from
# direct corpus inspection, but does not name their exact references, and
# tools/.cache is gitignored so this checkout cannot inspect the real source
# to confirm them. Left empty rather than guessed: a real build against the
# live source will report each one as an "undeclared_empty_verse" failure
# with its exact book/chapter/verse -- copy those into this dict once
# confirmed. Do not pre-guess.
DECLARED_OMISSIONS: dict[tuple[int, int, int], str] = {}

# --- Verse map -----------------------------------------------------------------
# 1,187 of 1,189 chapters align 1:1. The two that do not are Romans 14 and 16, and
# the cause is textual tradition rather than translation: this Spanish edition places
# Paul's closing doxology at Romans 14:24-26, where English editions following the
# critical text place it at Romans 16:25-27.
#
# Keys and values are RefKey strings ("book.chapter.verse", 1-indexed) as defined in
# web/lib/contracts.ts. A null value means the verse has no counterpart and the
# opposite pane should render a gap rather than slide out of alignment.
#
# Detection is automatic (see the diff below); the resolution is declared here because
# it is an editorial judgement about two known passages, not something to infer.
VERSE_MAP: dict[str, str | None] = {
    "45.14.24": "45.16.25",
    "45.14.25": "45.16.26",
    "45.14.26": "45.16.27",
    "45.16.25": None,  # empty in this edition; the doxology sits at 14:24-26
}

# Shown in the reader wherever a mapped chapter is open, so the difference reads as
# information rather than as a bug.
VERSE_MAP_NOTES: dict[str, str] = {
    "45.14": (
        "This Spanish edition closes Romans 14 with Paul's doxology (verses 24-26). "
        "English editions place the same passage at Romans 16:25-27."
    ),
    "45.16": (
        "The doxology English editions number 16:25-27 appears at Romans 14:24-26 in "
        "this Spanish edition."
    ),
}

USFM_TO_CANON: dict[str, int] = {
    "GEN": 1, "EXO": 2, "LEV": 3, "NUM": 4, "DEU": 5, "JOS": 6, "JDG": 7, "RUT": 8,
    "1SA": 9, "2SA": 10, "1KI": 11, "2KI": 12, "1CH": 13, "2CH": 14, "EZR": 15,
    "NEH": 16, "EST": 17, "JOB": 18, "PSA": 19, "PRO": 20, "ECC": 21, "SNG": 22,
    "ISA": 23, "JER": 24, "LAM": 25, "EZK": 26, "DAN": 27, "HOS": 28, "JOL": 29,
    "AMO": 30, "OBA": 31, "JON": 32, "MIC": 33, "NAM": 34, "HAB": 35, "ZEP": 36,
    "HAG": 37, "ZEC": 38, "MAL": 39, "MAT": 40, "MRK": 41, "LUK": 42, "JHN": 43,
    "ACT": 44, "ROM": 45, "1CO": 46, "2CO": 47, "GAL": 48, "EPH": 49, "PHP": 50,
    "COL": 51, "1TH": 52, "2TH": 53, "1TI": 54, "2TI": 55, "TIT": 56, "PHM": 57,
    "HEB": 58, "JAS": 59, "1PE": 60, "2PE": 61, "1JN": 62, "2JN": 63, "3JN": 64,
    "JUD": 65, "REV": 66,
}

# --- USFM cleaning -----------------------------------------------------------
# Order matters. Footnotes and cross-references are stripped whole (they contain
# their own nested markers); only then are word-level markers unwrapped.

FOOTNOTE = re.compile(r"\\f\s.*?\\f\*", re.DOTALL)
CROSSREF = re.compile(r"\\x\s.*?\\x\*", re.DOTALL)
# \w palabra|strong="H7225"\w*  ->  palabra   (attributes are optional)
WORD = re.compile(r"\\w\s+([^|\\]+?)(?:\|[^\\]*?)?\\w\*")
# \+w nested inside other character markers
NESTED_WORD = re.compile(r"\\\+w\s+([^|\\]+?)(?:\|[^\\]*?)?\\\+w\*")
CHAR_MARKER = re.compile(r"\\\+?[a-z]+\d*\*?")
VERSE_LINE = re.compile(r"^\\v\s+(\d+)(?:-(\d+))?\s*(.*)$")
CHAPTER_LINE = re.compile(r"^\\c\s+(\d+)")
ID_LINE = re.compile(r"^\\id\s+(\w+)")
TITLE_LINE = re.compile(r"^\\(toc3|toc2|h)\s+(.+)$")
WHITESPACE = re.compile(r"\s+")


def clean(raw: str) -> str:
    """USFM markup -> plain verse text."""
    text = FOOTNOTE.sub("", raw)
    text = CROSSREF.sub("", text)
    text = NESTED_WORD.sub(r"\1", text)
    text = WORD.sub(r"\1", text)
    text = CHAR_MARKER.sub("", text)
    text = text.replace("\u00a0", " ")
    return WHITESPACE.sub(" ", text).strip()


def download(force: bool = False) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = CACHE_DIR / "spabll_usfm.zip"
    if target.exists() and not force:
        print(f"  cached ({target.stat().st_size / 1_048_576:.1f} MB)")
        return target
    print(f"  downloading {VERSION_META['source']}")
    request = urllib.request.Request(
        str(VERSION_META["source"]), headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=240) as response:
        payload = response.read()
    target.write_bytes(payload)
    print(f"  {len(payload) / 1_048_576:.1f} MB")
    return target


def parse_book(text: str) -> tuple[str, str, list[list[str]]] | None:
    """-> (usfm code, Spanish display name, chapters as lists of verse strings)."""
    code = ""
    title = ""
    chapters: list[list[str]] = []
    current: dict[int, str] = {}
    max_verse = 0

    def flush() -> None:
        nonlocal current, max_verse
        if not current:
            return
        chapters.append([current.get(n, "") for n in range(1, max_verse + 1)])
        current = {}
        max_verse = 0

    for line in text.splitlines():
        line = line.rstrip()

        id_match = ID_LINE.match(line)
        if id_match:
            code = id_match.group(1).upper()
            continue

        title_match = TITLE_LINE.match(line)
        if title_match and not title:
            title = clean(title_match.group(2)).strip()
            continue

        if CHAPTER_LINE.match(line):
            flush()
            continue

        verse_match = VERSE_LINE.match(line)
        if verse_match:
            start = int(verse_match.group(1))
            end = int(verse_match.group(2) or start)
            body = clean(verse_match.group(3))
            # A verse range (\v 1-2) carries one block of text. Attach it to the
            # first number and leave the rest empty so numbering stays aligned.
            current[start] = body
            for n in range(start + 1, end + 1):
                current.setdefault(n, "")
            max_verse = max(max_verse, end)
            continue

        # Continuation of the previous verse (poetry lines, paragraph breaks).
        if line.startswith("\\") and not line.startswith(("\\v", "\\c")):
            body = clean(line)
            if body and max_verse and max_verse in current:
                current[max_verse] = f"{current[max_verse]} {body}".strip()
            continue

        if line.strip() and max_verse and max_verse in current:
            current[max_verse] = f"{current[max_verse]} {clean(line)}".strip()

    flush()

    if code not in USFM_TO_CANON:
        return None
    return code, title, chapters


def parse_archive(archive: Path) -> tuple[dict[int, str], dict[int, list[list[str]]]]:
    """Parse the whole USFM zip into memory. No filesystem writes to the live tree."""
    names: dict[int, str] = {}
    books: dict[int, list[list[str]]] = {}
    with zipfile.ZipFile(archive) as zf:
        for name in sorted(zf.namelist()):
            if not name.lower().endswith(".usfm"):
                continue
            parsed = parse_book(zf.read(name).decode("utf-8", errors="replace"))
            if parsed is None:
                continue
            code, title, chapters = parsed
            index = USFM_TO_CANON[code]
            names[index] = title
            books[index] = chapters
    return names, books


def load_english_counts() -> dict[int, list[int]]:
    """Verse counts per chapter for the comparison version."""
    counts: dict[int, list[int]] = {}
    base = OUTPUT_DIR / COMPARE_TO
    if not base.exists():
        raise SystemExit(
            f"{COMPARE_TO} not built. Run `py tools/build_bible.py` first -- the diff needs it."
        )
    for n in range(1, 67):
        data = json.loads((base / f"{n}.json").read_text(encoding="utf-8"))
        counts[n] = [len(chapter) for chapter in data["c"]]
    return counts


def _report_failure_and_exit(issues: list[ValidationIssue]) -> None:
    print(
        f"\nCorpus validation FAILED -- {len(issues)} issue(s). "
        "Live web/public/bible/SBL, versemap.json and index.json left untouched.",
        file=sys.stderr,
    )
    for issue in issues:
        print(f"  [{issue.kind}] {issue.detail}", file=sys.stderr)
    sys.exit(1)


def _atomic_write_json(payload: dict, target: Path) -> None:
    """Write JSON to `target` via a same-directory temp file + os.replace, which
    is atomic for a single file (even on Windows) regardless of whether the
    destination already exists."""
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, target)


def main() -> None:
    force = "--force" in sys.argv
    print(f"Building {VERSION_ID} — {VERSION_META['name']}")

    # Precondition, not a corpus-integrity gate: the diff needs a live English
    # baseline already on disk. Already fail-closed (SystemExit -> exit 1,
    # message to stderr) and does not touch anything before this point.
    english = load_english_counts()

    archive = download(force)
    spanish_names, spanish_books = parse_archive(archive)

    issues = validate_version_payload(
        VERSION_ID,
        spanish_books,
        canon=CANON,
        total_chapters=TOTAL_CHAPTERS,
        declared_verse_total=DECLARED_VERSE_TOTAL,
        declared_omissions=DECLARED_OMISSIONS,
    )
    if issues:
        _report_failure_and_exit(issues)

    chapter_total = sum(len(c) for c in spanish_books.values())
    verse_total = sum(len(v) for c in spanish_books.values() for v in c)
    print(f"  {len(spanish_books)}/66 books · {chapter_total:,} chapters · {verse_total:,} verses -- OK")

    # --- versification diff (informational; does not gate the build) --------
    # The two DECLARED divergences (Romans 14/16) are expected and handled via
    # VERSE_MAP below. Any OTHER chapter-level count mismatch against English
    # is still written to the report for a human to see, exactly as before --
    # it is not itself grounds to fail the build closed, because unlike an
    # empty-verse slot it is not necessarily wrong, only different, and this
    # script's job is to surface it, not adjudicate it.
    index_meta = json.loads((OUTPUT_DIR / "index.json").read_text(encoding="utf-8"))
    book_names = {b["n"]: b["name"] for b in index_meta["books"]}

    chapter_diffs: list[tuple[str, int, int, int]] = []
    missing_chapters: list[str] = []

    for n in range(1, 67):
        es = [len(c) for c in spanish_books.get(n, [])]
        en = english.get(n, [])
        if len(es) != len(en):
            missing_chapters.append(f"{book_names[n]}: {len(es)} chapters (ES) vs {len(en)} (EN)")
        for c in range(min(len(es), len(en))):
            if es[c] != en[c]:
                chapter_diffs.append((book_names[n], c + 1, es[c], en[c]))

    total_es = verse_total
    total_en = sum(sum(v) for v in english.values())

    lines = [
        "# Versification report — Spanish vs English",
        "",
        f"**{VERSION_ID}** ({VERSION_META['name']}) compared against **{COMPARE_TO}**.",
        "",
        f"- Spanish verses: **{total_es:,}**",
        f"- English verses: **{total_en:,}**",
        f"- Difference: **{total_es - total_en:+,}**",
        f"- Chapters where counts differ: **{len(chapter_diffs)}**",
        "",
    ]
    if missing_chapters:
        lines += ["## Chapter-count mismatches", ""] + [f"- {m}" for m in missing_chapters] + [""]
    if chapter_diffs:
        lines += [
            "## Chapters needing a verse map",
            "",
            "The parallel reader must not assume 1:1 alignment in these chapters.",
            "",
            "| Book | Chapter | Spanish | English | Δ |",
            "|---|---:|---:|---:|---:|",
        ]
        lines += [
            f"| {book} | {chapter} | {es} | {en} | {es - en:+} |"
            for book, chapter, es, en in chapter_diffs
        ]
        lines.append("")
    else:
        lines += ["## Alignment", "", "Every chapter matches 1:1. The split view needs no verse map.", ""]

    if VERSE_MAP:
        lines += [
            "## Resolution",
            "",
            "Declared in `VERSE_MAP` in `tools/build_spanish.py` and emitted to",
            "`web/public/bible/versemap.json`. The parallel reader consumes it directly;",
            "a `null` target means the opposite pane renders a gap rather than sliding out",
            "of alignment.",
            "",
            "| Spanish | English |",
            "|---|---|",
        ]
        lines += [
            f"| `{source}` | {f'`{target}`' if target else '— (no counterpart)'} |"
            for source, target in VERSE_MAP.items()
        ]
        lines.append("")

    # --- everything below writes to disk; everything above was validation ---
    # or read-only. From here on, the SBL directory is built in staging and
    # swapped in with atomic_replace_dir; versemap.json/index.json/the report
    # are only overwritten after that swap succeeds.

    if STAGING_DIR.exists():
        shutil.rmtree(STAGING_DIR)  # leftover from an earlier interrupted run
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    for index, chapters in spanish_books.items():
        title = spanish_names.get(index, book_names.get(index, ""))
        (STAGING_DIR / f"{index}.json").write_text(
            json.dumps({"b": title, "c": chapters}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    live_sbl_dir = OUTPUT_DIR / VERSION_ID
    atomic_replace_dir(STAGING_DIR, live_sbl_dir)

    REPORT_FILE.write_text("\n".join(lines), encoding="utf-8")

    # The reader loads this instead of assuming 1:1 alignment.
    reverse = {v: k for k, v in VERSE_MAP.items() if v}
    _atomic_write_json(
        {
            VERSION_ID: {
                "comparedTo": COMPARE_TO,
                "toEnglish": VERSE_MAP,
                "toSpanish": reverse,
                "notes": VERSE_MAP_NOTES,
                "divergentChapters": sorted(
                    {source.rsplit(".", 1)[0] for source in VERSE_MAP}
                    | {target.rsplit(".", 1)[0] for target in VERSE_MAP.values() if target}
                ),
            }
        },
        OUTPUT_DIR / "versemap.json",
    )

    # --- register the version in index.json ----------------------------------
    versions = [v for v in index_meta["versions"] if v["id"] != VERSION_ID]
    for v in versions:
        v.setdefault("language", "en")
    versions.append({k: v for k, v in VERSION_META.items() if k != "source"})
    index_meta["versions"] = versions
    index_meta["spanishNames"] = {str(k): v for k, v in sorted(spanish_names.items())}
    _atomic_write_json(index_meta, OUTPUT_DIR / "index.json")

    print(f"\n  Spanish {total_es:,} vs {COMPARE_TO} {total_en:,} ({total_es - total_en:+,})")
    print(f"  {len(chapter_diffs)} chapter(s) differ · report -> {REPORT_FILE.name}")
    for book, chapter, es, en in chapter_diffs[:15]:
        print(f"    {book} {chapter}: ES {es} vs EN {en} ({es - en:+})")


if __name__ == "__main__":
    main()
