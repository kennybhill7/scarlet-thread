"""Convert the Obsidian vault into seed JSON matching web/lib/contracts.ts.

This is a one-time (or re-run-on-demand) import, not a live sync. The app's
source of truth after seeding is the database; the vault stays the archival
copy and a permanent export target, per BUILD_PLAN.md section 5.

Output goes to web/data/seed/ — deliberately NOT web/public/, since these are
personal observations and questions that must never be reachable by an
unauthenticated fetch. web/public is served to anyone with the URL; app
routes and API handlers are gated by proxy.ts. web/data/ has no route, so it
is server-only by construction (Next.js never serves files outside app/ and
public/).

Track A owns tools/**, so this script produces the data. Track B owns
web/db/**, so a companion seed script that reads these files and inserts
rows for a specific userId belongs there, not here — see PROGRESS.md.

Usage:  py tools/import_vault.py
Author: Kenneth Hill
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VAULT_DIR = ROOT / "Bible-Brain"
OUTPUT_DIR = ROOT / "web" / "data" / "seed"

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

# Canonical 66-book order -> book number. Kept local rather than imported from
# build_bible.py / build_spanish.py so each tool stays independently runnable.
CANON: dict[str, int] = {
    "Genesis": 1, "Exodus": 2, "Leviticus": 3, "Numbers": 4, "Deuteronomy": 5,
    "Joshua": 6, "Judges": 7, "Ruth": 8, "1 Samuel": 9, "2 Samuel": 10,
    "1 Kings": 11, "2 Kings": 12, "1 Chronicles": 13, "2 Chronicles": 14,
    "Ezra": 15, "Nehemiah": 16, "Esther": 17, "Job": 18, "Psalms": 19,
    "Proverbs": 20, "Ecclesiastes": 21, "Song of Solomon": 22, "Isaiah": 23,
    "Jeremiah": 24, "Lamentations": 25, "Ezekiel": 26, "Daniel": 27,
    "Hosea": 28, "Joel": 29, "Amos": 30, "Obadiah": 31, "Jonah": 32,
    "Micah": 33, "Nahum": 34, "Habakkuk": 35, "Zephaniah": 36, "Haggai": 37,
    "Zechariah": 38, "Malachi": 39, "Matthew": 40, "Mark": 41, "Luke": 42,
    "John": 43, "Acts": 44, "Romans": 45, "1 Corinthians": 46,
    "2 Corinthians": 47, "Galatians": 48, "Ephesians": 49, "Philippians": 50,
    "Colossians": 51, "1 Thessalonians": 52, "2 Thessalonians": 53,
    "1 Timothy": 54, "2 Timothy": 55, "Titus": 56, "Philemon": 57,
    "Hebrews": 58, "James": 59, "1 Peter": 60, "2 Peter": 61, "1 John": 62,
    "2 John": 63, "3 John": 64, "Jude": 65, "Revelation": 66,
}
# Sorted longest-name-first so "1 Corinthians" matches before "1" alone could
# confuse a looser scan, and so "Revelation" doesn't shadow nothing else here
# -- simple safeguard for the regex built below.
BOOK_PATTERN = re.compile(
    "|".join(re.escape(name) for name in sorted(CANON, key=len, reverse=True))
)
CHAPTER_RANGE = re.compile(r"(\d+)(?:\s*[–—-]\s*(\d+))?")


def slugify(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[’'\"]", "", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = FRONTMATTER.match(text)
    if not match:
        return {}, text
    data: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        data[key.strip()] = value.strip()
    return data, text[match.end():]


def parse_sections(body: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = ""
    buffer: list[str] = []
    for line in body.splitlines():
        if line.startswith("## "):
            if current:
                sections[current] = "\n".join(buffer).strip()
            current = line[3:].strip()
            buffer = []
        elif current:
            buffer.append(line)
    if current:
        sections[current] = "\n".join(buffer).strip()
    return sections


def bullets(section: str | None) -> list[str]:
    """Extract real bullet lines, stripped of the leading '- ' and HTML comments."""
    if not section:
        return []
    cleaned = HTML_COMMENT.sub("", section)
    out: list[str] = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if stripped.startswith(("- ", "* ")):
            text = stripped[2:].strip()
            if text and text != "[[]]":
                out.append(text)
    return out


def strip_links(text: str) -> str:
    return WIKILINK.sub(r"\1", text)


def links_in(text: str | None) -> list[str]:
    if not text:
        return []
    return [m.group(1).strip() for m in WIKILINK.finditer(text) if m.group(1).strip()]


def first_chapter_ref(read_line: str) -> str | None:
    """
    Best-effort anchor for stage-level entries. Finds the first book named in
    the "Read:" line and its first chapter number, e.g. "Genesis 3–5;
    Genesis 15:6" -> "1.3". Multi-book spans (Gen 12-Malachi, Matthew-John)
    get anchored to that first book's opening chapter -- this is a stated
    approximation for pre-deep-gear vault content, not a claim that the
    insight applies only to that chapter. See PROGRESS.md.
    """
    book_match = BOOK_PATTERN.search(read_line)
    if not book_match:
        return None
    book_number = CANON[book_match.group(0)]

    tail = read_line[book_match.end():]
    chapter_match = CHAPTER_RANGE.search(tail)
    chapter = int(chapter_match.group(1)) if chapter_match else 1
    return f"{book_number}.{chapter}"


# --------------------------------------------------------------------------


@dataclass
class ImportWarning:
    note: str
    message: str


@dataclass
class Report:
    stages: int = 0
    threads: int = 0
    people: int = 0
    entries: int = 0
    warnings: list[ImportWarning] = field(default_factory=list)


def import_stages(report: Report) -> list[dict]:
    stages: list[dict] = []
    for path in sorted((VAULT_DIR / "01 Passages").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(text)
        raw_stage = frontmatter.get("stage", "").strip()
        if not raw_stage.isdigit():
            continue

        title_match = re.search(r"^# (.+)$", body, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else path.stem
        sections = parse_sections(body)
        read_line_match = re.search(r"\*\*Read:\*\*\s*(.+)", body)
        summary = sections.get("Mirror") or sections.get("Why He sits at the peak") or ""

        chapters: list[str] = []
        if read_line_match:
            anchor = first_chapter_ref(read_line_match.group(1))
            if anchor:
                chapters = [anchor]
            else:
                report.warnings.append(
                    ImportWarning(path.stem, "could not resolve a chapter anchor from Read: line")
                )

        stages.append(
            {
                "slug": slugify(path.stem),
                "title": title,
                "stage": int(raw_stage),
                "side": frontmatter.get("side", "ascent").strip(),
                "mirror": slugify(strip_links(frontmatter.get("mirror", "")))
                or None,
                "chapters": chapters,
                "summary": strip_links(summary),
                # carried through for the entry importer below; not part of the
                # Stage contract, stripped before writing stages.json
                "_note": path.stem,
                "_threads": links_in(sections.get("Threads")),
                "_anchor": chapters[0] if chapters else None,
                "_observations": bullets(sections.get("Observation")),
                "_questions": bullets(sections.get("Questions")),
            }
        )
    report.stages = len(stages)
    return stages


def import_threads(report: Report) -> list[dict]:
    threads: list[dict] = []
    for path in sorted((VAULT_DIR / "02 Threads").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        sections = parse_sections(text)
        one_line = re.search(r"\*\*In one line:\*\*\s*(.+)", text)
        threads.append(
            {
                "slug": slugify(path.stem),
                "title": path.stem,
                "definition": one_line.group(1).strip() if one_line else "",
                "seeing": strip_links(sections.get("What I'm seeing", "")).strip(),
            }
        )
    report.threads = len(threads)
    return threads


def import_people(report: Report) -> list[dict]:
    people: list[dict] = []
    for path in sorted((VAULT_DIR / "03 People").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        sections = parse_sections(text)
        one_line = re.search(r"\*\*In one line:\*\*\s*(.+)", text)
        body_parts = [one_line.group(1).strip()] if one_line else []
        seeing = strip_links(sections.get("What I'm seeing", "")).strip()
        if seeing:
            body_parts.append(seeing)

        people.append(
            {
                "slug": slugify(path.stem),
                "name": path.stem,
                "body": "\n\n".join(body_parts),
                "chapters": [],
                "threads": [slugify(t) for t in links_in(sections.get("Threads"))],
            }
        )
    report.people = len(people)
    return people


def import_entries(stages: list[dict], report: Report) -> list[dict]:
    entries: list[dict] = []
    for stage in stages:
        anchor = stage["_anchor"]
        threads = [slugify(t) for t in stage["_threads"]]
        if not anchor:
            if stage["_observations"] or stage["_questions"]:
                report.warnings.append(
                    ImportWarning(
                        stage["_note"],
                        f"{len(stage['_observations'])} observation(s) and "
                        f"{len(stage['_questions'])} question(s) skipped -- no chapter anchor",
                    )
                )
            continue

        for text in stage["_observations"]:
            entries.append(
                {
                    "kind": "observation",
                    "body": strip_links(text),
                    "chapter": anchor,
                    "threads": threads,
                }
            )
        for text in stage["_questions"]:
            entries.append(
                {
                    "kind": "question",
                    "body": strip_links(text),
                    "chapter": anchor,
                    "threads": threads,
                    "answeredAt": None,
                }
            )
    report.entries = len(entries)
    return entries


def main() -> None:
    if not VAULT_DIR.exists():
        raise SystemExit(f"Vault not found: {VAULT_DIR}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report = Report()

    stages_raw = import_stages(report)
    threads = import_threads(report)
    people = import_people(report)
    entries = import_entries(stages_raw, report)

    # Strip the working fields (prefixed "_") before writing -- they exist
    # only to hand context from import_stages() to import_entries().
    stages = [{k: v for k, v in s.items() if not k.startswith("_")} for s in stages_raw]

    known_slugs = {s["slug"] for s in stages}
    for stage in stages:
        if stage["mirror"] and stage["mirror"] not in known_slugs:
            report.warnings.append(
                ImportWarning(stage["title"], f"mirror slug '{stage['mirror']}' not found")
            )

    (OUTPUT_DIR / "stages.json").write_text(
        json.dumps(stages, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "threads.json").write_text(
        json.dumps(threads, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "people.json").write_text(
        json.dumps(people, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "entries.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"Wrote seed JSON -> {OUTPUT_DIR.relative_to(ROOT)}")
    print(f"  {report.stages} stages · {report.threads} threads · {report.people} people")
    print(f"  {report.entries} entries ({sum(1 for e in entries if e['kind']=='observation')} "
          f"observations, {sum(1 for e in entries if e['kind']=='question')} questions)")

    if report.warnings:
        print(f"\n{len(report.warnings)} warning(s):")
        for w in report.warnings:
            print(f"  ! [{w.note}] {w.message}")


if __name__ == "__main__":
    main()
