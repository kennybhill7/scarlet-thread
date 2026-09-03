"""Download freely-licensed Bible translations and emit compact per-book JSON.

Source: github.com/scrollmapper/bible_databases (formats/json).
Only translations that are public domain or released for free use are included --
see LICENSING below. Modern copyrighted translations (NIV, ESV, NASB, NKJV, CSB)
are deliberately absent; they cannot be redistributed.

Input shape:   {"translation": str, "books": [{"name", "chapters": [{"chapter", "verses": [{"verse","text"}]}]}]}
Output shape:  web/public/bible/<VERSION>/<bookNumber>.json  ->  {"b": name, "c": [[verse, ...], ...]}
               web/public/bible/index.json                   ->  versions + canon metadata

Splitting per book keeps the service worker able to cache what you actually read
instead of forcing a 20 MB download before the first verse appears.

--- Fail-closed build (CODEX_AUDIT A-027 / Gate 0.6, CORPUS-001) --------------
Every translation is downloaded and parsed into memory, then validated
(validate_version_payload) BEFORE anything is written to disk. Only if every
translation in VERSIONS passes validation does the script write a full new
tree into a staging directory and swap it into place with atomic_replace_dir.
A validation failure exits non-zero with a stderr report and leaves the live
corpus at web/public/bible byte-identical to what it was before the run --
nothing is deleted, nothing is partially overwritten.

validate_version_payload and atomic_replace_dir are plain functions with no
filesystem/network side effects of their own (validate_version_payload takes
already-parsed data; atomic_replace_dir takes two paths) specifically so
tools/test_corpus_validation.py can exercise them with synthetic fixtures --
the real translation sources in tools/.cache are gitignored and will not
exist in a clean checkout.

Usage:  py tools/build_bible.py [--force]
Author: Kenneth Hill
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "tools" / ".cache"
OUTPUT_DIR = ROOT / "web" / "public" / "bible"
STAGING_DIR = ROOT / "web" / "public" / "bible.staging"
SOURCE = "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/{file}"

# A plain urllib request gets a 403 from raw.githubusercontent -- it wants a UA.
USER_AGENT = "bible-brain-build/1.0 (+local study app)"


@dataclass(frozen=True)
class Version:
    """One translation. `licence` is why we are allowed to ship it."""

    id: str
    file: str
    name: str
    short: str
    year: str
    licence: str
    note: str


VERSIONS: list[Version] = [
    Version(
        id="BSB",
        file="BSB.json",
        name="Berean Standard Bible",
        short="Berean Standard",
        year="2022",
        licence="Released by the publisher for free use worldwide, including redistribution.",
        note="Modern readable English. The daily-reading default.",
    ),
    Version(
        id="KJV",
        file="KJV.json",
        name="King James Version",
        short="King James",
        year="1611",
        licence=(
            "Public domain worldwide, except the United Kingdom, where the Crown holds a "
            "perpetual printing patent over this text. No access restriction is applied here; "
            "UK readers should be aware of this text's status there before relying on it."
        ),
        note="The cadence most memorised verses and older commentaries assume.",
    ),
    Version(
        id="ASV",
        file="ASV.json",
        name="American Standard Version",
        short="American Standard",
        year="1901",
        licence="Public domain.",
        note="Very literal; the direct ancestor of the NASB and ESV.",
    ),
    Version(
        id="YLT",
        file="YLT.json",
        name="Young's Literal Translation",
        short="Young's Literal",
        year="1862",
        licence="Public domain.",
        note="Word-for-word, preserving Hebrew and Greek tense and word order.",
    ),
]

# The 66-book canon: name as it appears in the source, abbreviation, expected chapters.
CANON: list[tuple[str, str, int]] = [
    ("Genesis", "Gen", 50), ("Exodus", "Ex", 40), ("Leviticus", "Lev", 27),
    ("Numbers", "Num", 36), ("Deuteronomy", "Deut", 34), ("Joshua", "Josh", 24),
    ("Judges", "Judg", 21), ("Ruth", "Ruth", 4), ("1 Samuel", "1 Sam", 31),
    ("2 Samuel", "2 Sam", 24), ("1 Kings", "1 Kgs", 22), ("2 Kings", "2 Kgs", 25),
    ("1 Chronicles", "1 Chr", 29), ("2 Chronicles", "2 Chr", 36), ("Ezra", "Ezra", 10),
    ("Nehemiah", "Neh", 13), ("Esther", "Est", 10), ("Job", "Job", 42),
    ("Psalms", "Ps", 150), ("Proverbs", "Prov", 31), ("Ecclesiastes", "Eccl", 12),
    ("Song of Solomon", "Song", 8), ("Isaiah", "Isa", 66), ("Jeremiah", "Jer", 52),
    ("Lamentations", "Lam", 5), ("Ezekiel", "Ezek", 48), ("Daniel", "Dan", 12),
    ("Hosea", "Hos", 14), ("Joel", "Joel", 3), ("Amos", "Amos", 9),
    ("Obadiah", "Obad", 1), ("Jonah", "Jonah", 4), ("Micah", "Mic", 7),
    ("Nahum", "Nah", 3), ("Habakkuk", "Hab", 3), ("Zephaniah", "Zeph", 3),
    ("Haggai", "Hag", 2), ("Zechariah", "Zech", 14), ("Malachi", "Mal", 4),
    ("Matthew", "Matt", 28), ("Mark", "Mark", 16), ("Luke", "Luke", 24),
    ("John", "John", 21), ("Acts", "Acts", 28), ("Romans", "Rom", 16),
    ("1 Corinthians", "1 Cor", 16), ("2 Corinthians", "2 Cor", 13),
    ("Galatians", "Gal", 6), ("Ephesians", "Eph", 6), ("Philippians", "Phil", 4),
    ("Colossians", "Col", 4), ("1 Thessalonians", "1 Thess", 5),
    ("2 Thessalonians", "2 Thess", 3), ("1 Timothy", "1 Tim", 6),
    ("2 Timothy", "2 Tim", 4), ("Titus", "Titus", 3), ("Philemon", "Phlm", 1),
    ("Hebrews", "Heb", 13), ("James", "Jas", 5), ("1 Peter", "1 Pet", 5),
    ("2 Peter", "2 Pet", 3), ("1 John", "1 Jn", 5), ("2 John", "2 Jn", 1),
    ("3 John", "3 Jn", 1), ("Jude", "Jude", 1), ("Revelation", "Rev", 22),
]

# Source files spell a few books differently between translations.
ALIASES: dict[str, str] = {
    "Song of Songs": "Song of Solomon",
    "Canticles": "Song of Solomon",
    "The Song of Songs": "Song of Solomon",
    "Psalm": "Psalms",
    "Revelation of John": "Revelation",
    "The Revelation": "Revelation",
    "I Samuel": "1 Samuel", "II Samuel": "2 Samuel",
    "I Kings": "1 Kings", "II Kings": "2 Kings",
    "I Chronicles": "1 Chronicles", "II Chronicles": "2 Chronicles",
    "I Corinthians": "1 Corinthians", "II Corinthians": "2 Corinthians",
    "I Thessalonians": "1 Thessalonians", "II Thessalonians": "2 Thessalonians",
    "I Timothy": "1 Timothy", "II Timothy": "2 Timothy",
    "I Peter": "1 Peter", "II Peter": "2 Peter",
    "I John": "1 John", "II John": "2 John", "III John": "3 John",
}

TOTAL_CHAPTERS = sum(chapters for _, _, chapters in CANON)
TOTAL_BOOKS = len(CANON)

# Every English version handled by this script shares one textual tradition's
# verse numbering (CODEX_AUDIT A-027: "never asserts the claimed 31,102 verses
# per version"). SBL (Spanish) is handled by build_spanish.py against its own
# declared total -- it is NOT one of these four.
DECLARED_VERSE_TOTAL = 31_102

# Known textual-omission verses per version: an empty verse slot is only
# tolerated at validation time if its exact (book index, chapter, verse) is
# declared here. Anything else empty is treated as a partial-download or
# parser regression and fails the build closed (CODEX_AUDIT A-028).
#
# HONEST GAP: A-028 reports 16 empty slots in BSB and 16 in ASV from direct
# corpus inspection; only the two most famous, independently-verifiable
# disputed-verse references (Matthew 17:21, Acts 8:37 -- both long-documented
# textual variants, not something that requires re-downloading the corpus to
# know) are declared below. Running a real build against the live source will
# report the exact refs for any *other* empty slot as an "undeclared_empty_
# verse" validation failure -- copy those refs in here once confirmed against
# the actual source text. Do not pre-guess the remaining ~14 per version; a
# wrong guess would silently wave through a real omission that isn't one.
DECLARED_OMISSIONS: dict[str, dict[tuple[int, int, int], str]] = {
    "BSB": {
        (40, 17, 21): "Matthew 17:21 -- absent from the earliest manuscripts.",
        (44, 8, 37): "Acts 8:37 -- absent from the earliest manuscripts.",
    },
    "KJV": {},
    "ASV": {
        (40, 17, 21): "Matthew 17:21 -- footnoted omission in the ASV source text.",
        (44, 8, 37): "Acts 8:37 -- footnoted omission in the ASV source text.",
    },
    "YLT": {},
}


@dataclass(frozen=True)
class ValidationIssue:
    """One fail-closed corpus validation problem."""

    kind: str  # "missing_book" | "chapter_count" | "total_chapters" | "verse_total" | "undeclared_empty_verse"
    detail: str


class CorpusValidationError(RuntimeError):
    """Raised (and always caught by main()) when a built version fails validation."""

    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__(f"{len(issues)} corpus validation issue(s)")


def validate_version_payload(
    version_id: str,
    books: dict[int, list[list[str]]],
    *,
    canon: list[tuple[str, str, int]] = CANON,
    total_chapters: int = TOTAL_CHAPTERS,
    declared_verse_total: int | None = DECLARED_VERSE_TOTAL,
    declared_omissions: dict[tuple[int, int, int], str] | None = None,
) -> list[ValidationIssue]:
    """Fail-closed structural check for one already-parsed translation.

    Pure function over in-memory data -- no filesystem, no network -- so it
    can be exercised with SYNTHETIC fixtures independent of the real corpus
    (tools/.cache is gitignored and will not exist in a clean checkout).

    `books` maps 1-indexed canon book number -> list of chapters -> list of
    verse text strings, i.e. exactly the shape parse_version() produces.

    Checks, all of which must pass for an empty issue list:
      - all 66 canon books present (missing_book)
      - each book's chapter count matches the canon (chapter_count)
      - total chapters across the version equals 1189 (total_chapters)
      - total verses across the version equals declared_verse_total, if given
        (verse_total)
      - every empty verse slot is a declared omission, if declared_omissions
        is given (undeclared_empty_verse) -- an empty dict means "no omissions
        are tolerated", not "omissions are unchecked"
    """
    declared_omissions = declared_omissions or {}
    issues: list[ValidationIssue] = []
    verse_total = 0
    chapter_total = 0

    for index, (name, _abbr, expected_chapters) in enumerate(canon, start=1):
        chapters = books.get(index)
        if chapters is None:
            issues.append(
                ValidationIssue(
                    "missing_book", f"{version_id}: missing book '{name}' (index {index})"
                )
            )
            continue

        if len(chapters) != expected_chapters:
            issues.append(
                ValidationIssue(
                    "chapter_count",
                    f"{version_id}: {name} has {len(chapters)} chapters, expected {expected_chapters}",
                )
            )

        chapter_total += len(chapters)
        for chapter_num, verses in enumerate(chapters, start=1):
            verse_total += len(verses)
            for verse_num, text in enumerate(verses, start=1):
                if text.strip() == "" and (index, chapter_num, verse_num) not in declared_omissions:
                    issues.append(
                        ValidationIssue(
                            "undeclared_empty_verse",
                            f"{version_id}: {name} {chapter_num}:{verse_num} is empty "
                            "and is not a declared omission",
                        )
                    )

    if chapter_total != total_chapters:
        issues.append(
            ValidationIssue(
                "total_chapters",
                f"{version_id}: {chapter_total} total chapters, expected {total_chapters}",
            )
        )

    if declared_verse_total is not None and verse_total != declared_verse_total:
        issues.append(
            ValidationIssue(
                "verse_total",
                f"{version_id}: {verse_total} total verses, expected {declared_verse_total}",
            )
        )

    return issues


def atomic_replace_dir(staged: Path, live: Path) -> None:
    """Swap `staged` into `live`'s place, deleting the prior contents of
    `live` only AFTER the swap into place has succeeded -- never before.

    This is two renames rather than one atomic filesystem call (Windows has
    no single syscall that atomically replaces a non-empty directory), which
    is "as close to atomic as the platform allows": the window between the
    two renames is a single OS rename call, and if the process dies inside
    that window, the next call to this function detects the half-swapped
    state (backup present, `live` missing) and restores the last known-good
    corpus before attempting anything else.
    """
    backup = live.parent / f"{live.name}.prior"

    if backup.exists() and not live.exists():
        # A previous swap crashed between the two renames below. Recover the
        # last known-good corpus before doing anything else.
        os.rename(backup, live)

    if backup.exists():
        shutil.rmtree(backup)

    moved_old = False
    if live.exists():
        os.rename(live, backup)
        moved_old = True

    try:
        os.rename(staged, live)
    except Exception:
        if moved_old:
            os.rename(backup, live)
        raise
    else:
        if moved_old and backup.exists():
            shutil.rmtree(backup)


def download(version: Version, force: bool = False) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = CACHE_DIR / version.file
    if target.exists() and not force:
        print(f"  {version.id}: cached ({target.stat().st_size / 1_048_576:.1f} MB)")
        return target
    url = SOURCE.format(file=version.file)
    print(f"  {version.id}: downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = response.read()
    target.write_bytes(payload)
    print(f"  {version.id}: {len(payload) / 1_048_576:.1f} MB")
    return target


def normalise(name: str) -> str:
    cleaned = name.strip()
    return ALIASES.get(cleaned, cleaned)


def parse_version(source: Path) -> dict[int, list[list[str]]]:
    """Parse a downloaded scrollmapper JSON file into canon-indexed chapters.

    No filesystem writes. Missing books are simply absent from the returned
    dict -- validate_version_payload() is what turns that into a hard failure.
    """
    data = json.loads(source.read_text(encoding="utf-8"))
    by_name: dict[str, list[dict]] = {}
    for book in data.get("books", []):
        by_name[normalise(book.get("name", ""))] = book.get("chapters", [])

    books: dict[int, list[list[str]]] = {}
    for index, (name, _abbr, _expected_chapters) in enumerate(CANON, start=1):
        chapters = by_name.get(name)
        if chapters is None:
            continue
        payload: list[list[str]] = []
        for chapter in chapters:
            verses = [str(v.get("text", "")).strip() for v in chapter.get("verses", [])]
            payload.append(verses)
        books[index] = payload
    return books


def write_version(version: Version, books: dict[int, list[list[str]]], into_dir: Path) -> tuple[int, int]:
    """Write one already-validated version's per-book JSON into into_dir/<id>/."""
    out_dir = into_dir / version.id
    out_dir.mkdir(parents=True, exist_ok=True)

    verse_total = 0
    chapter_total = 0
    for index, (name, _abbr, _expected) in enumerate(CANON, start=1):
        chapters = books.get(index, [])
        chapter_total += len(chapters)
        verse_total += sum(len(verses) for verses in chapters)
        (out_dir / f"{index}.json").write_text(
            json.dumps({"b": name, "c": chapters}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    return chapter_total, verse_total


def _report_failure_and_exit(issues: list[ValidationIssue]) -> None:
    print(
        f"\nCorpus validation FAILED -- {len(issues)} issue(s). "
        "Live corpus at web/public/bible left untouched.",
        file=sys.stderr,
    )
    for issue in issues:
        print(f"  [{issue.kind}] {issue.detail}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    force = "--force" in sys.argv

    if STAGING_DIR.exists():
        shutil.rmtree(STAGING_DIR)  # leftover from an earlier interrupted run -- staging only, never the live tree
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Building {len(VERSIONS)} translations -> staging ({STAGING_DIR.relative_to(ROOT)})")
    all_issues: list[ValidationIssue] = []
    built: list[Version] = []

    for version in VERSIONS:
        source = download(version, force)
        books = parse_version(source)
        issues = validate_version_payload(
            version.id, books, declared_omissions=DECLARED_OMISSIONS.get(version.id, {})
        )
        if issues:
            print(f"  {version.id}: FAILED validation ({len(issues)} issue(s))")
            all_issues.extend(issues)
            continue
        chapters, verses = write_version(version, books, STAGING_DIR)
        built.append(version)
        print(f"  {version.id}: {chapters:,} chapters * {verses:,} verses -- OK")

    if all_issues:
        shutil.rmtree(STAGING_DIR, ignore_errors=True)
        _report_failure_and_exit(all_issues)

    index = {
        "versions": [
            {
                "id": v.id,
                "name": v.name,
                "short": v.short,
                "year": v.year,
                "licence": v.licence,
                "note": v.note,
                "language": "en",
            }
            for v in built
        ],
        "default": "BSB",
        "totalChapters": TOTAL_CHAPTERS,
        "books": [
            {
                "n": index_,
                "name": name,
                "abbr": abbr,
                "chapters": chapters,
                "testament": "OT" if index_ <= 39 else "NT",
            }
            for index_, (name, abbr, chapters) in enumerate(CANON, start=1)
        ],
    }
    (STAGING_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    size = sum(f.stat().st_size for f in STAGING_DIR.rglob("*.json"))
    file_count = len(list(STAGING_DIR.rglob("*.json")))
    print(f"\nAll {len(VERSIONS)} translations passed validation. {file_count} files * {size / 1_048_576:.1f} MB.")

    atomic_replace_dir(STAGING_DIR, OUTPUT_DIR)
    print(f"Live corpus updated at {OUTPUT_DIR.relative_to(ROOT)}.")
    print(
        "Note: this replaces the ENTIRE bible/ tree, including any Spanish "
        "output -- re-run tools/build_spanish.py afterward."
    )


if __name__ == "__main__":
    main()
