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

Usage:  py tools/build_spanish.py [--force]
Author: Kenneth Hill
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "tools" / ".cache"
OUTPUT_DIR = ROOT / "web" / "public" / "bible"
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


def main() -> None:
    force = "--force" in sys.argv
    print(f"Building {VERSION_ID} — {VERSION_META['name']}")

    archive = download(force)
    out_dir = OUTPUT_DIR / VERSION_ID
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    spanish_names: dict[int, str] = {}
    spanish_counts: dict[int, list[int]] = {}
    verse_total = 0
    chapter_total = 0

    with zipfile.ZipFile(archive) as zf:
        for name in sorted(zf.namelist()):
            if not name.lower().endswith(".usfm"):
                continue
            parsed = parse_book(zf.read(name).decode("utf-8", errors="replace"))
            if parsed is None:
                continue
            code, title, chapters = parsed
            index = USFM_TO_CANON[code]
            spanish_names[index] = title
            spanish_counts[index] = [len(c) for c in chapters]
            chapter_total += len(chapters)
            verse_total += sum(len(c) for c in chapters)
            (out_dir / f"{index}.json").write_text(
                json.dumps({"b": title, "c": chapters}, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )

    missing = sorted(set(USFM_TO_CANON.values()) - set(spanish_counts))
    print(f"  {len(spanish_counts)}/66 books · {chapter_total:,} chapters · {verse_total:,} verses")
    if missing:
        print(f"  ! missing book indexes: {missing}")

    # --- versification diff --------------------------------------------------
    english = load_english_counts()
    index_meta = json.loads((OUTPUT_DIR / "index.json").read_text(encoding="utf-8"))
    book_names = {b["n"]: b["name"] for b in index_meta["books"]}

    chapter_diffs: list[tuple[str, int, int, int]] = []
    missing_chapters: list[str] = []

    for n in range(1, 67):
        es = spanish_counts.get(n, [])
        en = english.get(n, [])
        if len(es) != len(en):
            missing_chapters.append(f"{book_names[n]}: {len(es)} chapters (ES) vs {len(en)} (EN)")
        for c in range(min(len(es), len(en))):
            if es[c] != en[c]:
                chapter_diffs.append((book_names[n], c + 1, es[c], en[c]))

    total_es = sum(sum(v) for v in spanish_counts.values())
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

    REPORT_FILE.write_text("\n".join(lines), encoding="utf-8")

    # The reader loads this instead of assuming 1:1 alignment.
    reverse = {v: k for k, v in VERSE_MAP.items() if v}
    (OUTPUT_DIR / "versemap.json").write_text(
        json.dumps(
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
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    # --- register the version in index.json ----------------------------------
    versions = [v for v in index_meta["versions"] if v["id"] != VERSION_ID]
    for v in versions:
        v.setdefault("language", "en")
    versions.append({k: v for k, v in VERSION_META.items() if k != "source"})
    index_meta["versions"] = versions
    index_meta["spanishNames"] = {str(k): v for k, v in sorted(spanish_names.items())}
    (OUTPUT_DIR / "index.json").write_text(
        json.dumps(index_meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    print(f"\n  Spanish {total_es:,} vs {COMPARE_TO} {total_en:,} ({total_es - total_en:+,})")
    print(f"  {len(chapter_diffs)} chapter(s) differ · report -> {REPORT_FILE.name}")
    for book, chapter, es, en in chapter_diffs[:15]:
        print(f"    {book} {chapter}: ES {es} vs EN {en} ({es - en:+})")


if __name__ == "__main__":
    main()
