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

Usage:  py tools/build_bible.py [--force]
Author: Kenneth Hill
"""

from __future__ import annotations

import json
import shutil
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "tools" / ".cache"
OUTPUT_DIR = ROOT / "web" / "public" / "bible"
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
        licence="Public domain in the United States.",
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


def convert(version: Version, source: Path) -> tuple[int, int, list[str]]:
    data = json.loads(source.read_text(encoding="utf-8"))
    by_name: dict[str, list[dict]] = {}
    for book in data.get("books", []):
        by_name[normalise(book.get("name", ""))] = book.get("chapters", [])

    out_dir = OUTPUT_DIR / version.id
    out_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    verse_total = 0
    chapter_total = 0

    for index, (name, _abbr, expected_chapters) in enumerate(CANON, start=1):
        chapters = by_name.get(name)
        if chapters is None:
            warnings.append(f"{version.id}: missing book '{name}'")
            continue
        if len(chapters) != expected_chapters:
            warnings.append(
                f"{version.id}: {name} has {len(chapters)} chapters, expected {expected_chapters}"
            )

        payload: list[list[str]] = []
        for chapter in chapters:
            verses = [str(v.get("text", "")).strip() for v in chapter.get("verses", [])]
            payload.append(verses)
            verse_total += len(verses)
        chapter_total += len(payload)

        (out_dir / f"{index}.json").write_text(
            json.dumps({"b": name, "c": payload}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    return chapter_total, verse_total, warnings


def main() -> None:
    force = "--force" in sys.argv

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Building {len(VERSIONS)} translations -> {OUTPUT_DIR.relative_to(ROOT)}")
    all_warnings: list[str] = []
    built: list[Version] = []

    for version in VERSIONS:
        source = download(version, force)
        chapters, verses, warnings = convert(version, source)
        all_warnings.extend(warnings)
        built.append(version)
        flag = "" if chapters == TOTAL_CHAPTERS else f"  <-- expected {TOTAL_CHAPTERS}"
        print(f"  {version.id}: {chapters:,} chapters · {verses:,} verses{flag}")

    index = {
        "versions": [
            {
                "id": v.id,
                "name": v.name,
                "short": v.short,
                "year": v.year,
                "licence": v.licence,
                "note": v.note,
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
    (OUTPUT_DIR / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    size = sum(f.stat().st_size for f in OUTPUT_DIR.rglob("*.json"))
    print(f"\nWrote {len(list(OUTPUT_DIR.rglob('*.json')))} files · {size / 1_048_576:.1f} MB total")

    if all_warnings:
        print(f"\n{len(all_warnings)} warning(s):")
        for warning in all_warnings[:25]:
            print(f"  ! {warning}")
    else:
        print("All translations match the 66-book canon exactly.")


if __name__ == "__main__":
    main()
