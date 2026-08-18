"""Synthetic-fixture tests for the fail-closed corpus validation logic in
build_bible.py and build_spanish.py (CORPUS-001 / Gate 0.6, CODEX_AUDIT
A-004 / A-027 / A-028).

Deliberately does NOT touch tools/.cache or download anything -- that
directory is gitignored and will not exist in a clean checkout, so no test
here depends on the real translation sources. Every fixture is a small
hand-built dict exercising validate_version_payload() and
atomic_replace_dir() directly, per the CORPUS-001 acceptance criterion:

    "Extract validation into importable, testable functions and add
    tools/test_corpus_validation.py exercising them with SYNTHETIC fixtures
    (good corpus; short-by-one-chapter; missing book; undeclared empty
    verse). Do not require a real corpus rebuild to prove the fix."

None of the expected values below are derived from build_bible.py's/
build_spanish.py's own logic -- they are independently known facts (66
books in the Protestant canon, 1189 total chapters, arithmetic on
hand-written fixtures) or values taken from tools/versification-report.md
and CODEX_AUDIT.md (31,102 / 31,103 declared verse totals).

Run:  python tools/test_corpus_validation.py
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_bible import (  # noqa: E402
    CANON,
    TOTAL_CHAPTERS,
    atomic_replace_dir,
    validate_version_payload,
)


def make_good_corpus() -> dict[int, list[list[str]]]:
    """One non-empty verse per chapter, every canon book/chapter present.

    Independently verifiable shape: 66 keys (1..66), and
    sum(len(chapters) for chapters in books.values()) == 1189, because that
    is just CANON's own chapter counts summed -- not anything
    validate_version_payload computes.
    """
    return {
        index: [[f"book{index} {chapter}:1"] for chapter in range(1, expected_chapters + 1)]
        for index, (_name, _abbr, expected_chapters) in enumerate(CANON, start=1)
    }


def total_verses(books: dict[int, list[list[str]]]) -> int:
    return sum(len(verses) for chapters in books.values() for verses in chapters)


class CanonConstantsSanityTests(unittest.TestCase):
    """Guards the ground truth the rest of the suite is built on."""

    def test_canon_has_66_books(self) -> None:
        self.assertEqual(len(CANON), 66)

    def test_canon_chapters_sum_to_1189(self) -> None:
        self.assertEqual(sum(chapters for _n, _a, chapters in CANON), 1189)
        self.assertEqual(TOTAL_CHAPTERS, 1189)


class GoodCorpusPassesTests(unittest.TestCase):
    def test_good_corpus_has_no_issues(self) -> None:
        books = make_good_corpus()
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=total_verses(books), declared_omissions={}
        )
        self.assertEqual(issues, [], f"expected a clean synthetic corpus to pass, got {issues}")

    def test_good_corpus_has_66_books_and_1189_chapters(self) -> None:
        books = make_good_corpus()
        self.assertEqual(len(books), 66)
        self.assertEqual(sum(len(c) for c in books.values()), 1189)


class ShortByOneChapterFailsTests(unittest.TestCase):
    def test_dropping_one_chapter_fails_chapter_count_and_total_chapters(self) -> None:
        books = make_good_corpus()
        books[1] = books[1][:-1]  # book 1 (Genesis, 50ch) now has 49 chapters
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=total_verses(books), declared_omissions={}
        )
        kinds = {issue.kind for issue in issues}
        self.assertIn("chapter_count", kinds)
        self.assertIn("total_chapters", kinds)
        detail = " ".join(issue.detail for issue in issues)
        self.assertIn("49", detail)
        self.assertIn("expected 50", detail)


class MissingBookFailsTests(unittest.TestCase):
    def test_dropping_a_whole_book_fails_missing_book_and_total_chapters(self) -> None:
        books = make_good_corpus()
        del books[66]  # Revelation entirely absent: the partial-download scenario
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=None, declared_omissions={}
        )
        kinds = {issue.kind for issue in issues}
        self.assertIn("missing_book", kinds)
        self.assertIn("total_chapters", kinds)
        detail = " ".join(issue.detail for issue in issues)
        self.assertIn("Revelation", detail)

    def test_missing_book_does_not_also_report_a_chapter_count_mismatch(self) -> None:
        books = make_good_corpus()
        del books[66]
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=None, declared_omissions={}
        )
        spurious = [i for i in issues if i.kind == "chapter_count" and "Revelation" in i.detail]
        self.assertEqual(spurious, [])


class UndeclaredEmptyVerseFailsTests(unittest.TestCase):
    def test_undeclared_empty_verse_fails_closed(self) -> None:
        books = make_good_corpus()
        books[1][0][0] = ""  # book 1 chapter 1 verse 1 silently blanked, undeclared
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=None, declared_omissions={}
        )
        kinds = {issue.kind for issue in issues}
        self.assertIn("undeclared_empty_verse", kinds)
        detail = " ".join(issue.detail for issue in issues)
        self.assertIn("1:1", detail)

    def test_declaring_that_exact_reference_makes_it_pass(self) -> None:
        books = make_good_corpus()
        books[1][0][0] = ""
        issues = validate_version_payload(
            "TEST",
            books,
            declared_verse_total=total_verses(books),
            declared_omissions={(1, 1, 1): "synthetic test declaration"},
        )
        self.assertEqual(issues, [])

    def test_declaring_the_wrong_reference_does_not_cover_the_real_gap(self) -> None:
        # A declared-omissions entry for book 2 must not paper over a real,
        # undeclared blank sitting in book 1 -- exercises that the check is
        # per-reference, not "any declared omission exists anywhere".
        books = make_good_corpus()
        books[1][0][0] = ""
        issues = validate_version_payload(
            "TEST",
            books,
            declared_verse_total=None,
            declared_omissions={(2, 1, 1): "wrong book, does not cover book 1"},
        )
        kinds = {issue.kind for issue in issues}
        self.assertIn("undeclared_empty_verse", kinds)


class VerseTotalMismatchFailsTests(unittest.TestCase):
    def test_verse_total_off_by_one_fails(self) -> None:
        books = make_good_corpus()
        actual = total_verses(books)
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=actual + 1, declared_omissions={}
        )
        kinds = {issue.kind for issue in issues}
        self.assertIn("verse_total", kinds)

    def test_verse_total_check_is_skipped_when_no_expectation_is_declared(self) -> None:
        books = make_good_corpus()
        issues = validate_version_payload(
            "TEST", books, declared_verse_total=None, declared_omissions={}
        )
        kinds = {issue.kind for issue in issues}
        self.assertNotIn("verse_total", kinds)


class AtomicReplaceDirTests(unittest.TestCase):
    """Exercises the delete-last swap with real (temp-directory) filesystem
    operations -- this is the actual behavior a passing suite must prove,
    not just a mock of it."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="corpus-validation-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_swap_replaces_live_content_and_cleans_up(self) -> None:
        live = self.tmp / "live"
        staged = self.tmp / "staged"
        live.mkdir()
        (live / "old.txt").write_text("old", encoding="utf-8")
        staged.mkdir()
        (staged / "new.txt").write_text("new", encoding="utf-8")

        atomic_replace_dir(staged, live)

        self.assertTrue((live / "new.txt").exists())
        self.assertFalse((live / "old.txt").exists())
        self.assertFalse(staged.exists())
        self.assertFalse((self.tmp / "live.prior").exists())

    def test_swap_works_when_live_does_not_exist_yet(self) -> None:
        live = self.tmp / "live"
        staged = self.tmp / "staged"
        staged.mkdir()
        (staged / "new.txt").write_text("new", encoding="utf-8")

        atomic_replace_dir(staged, live)

        self.assertTrue((live / "new.txt").exists())

    def test_failed_second_rename_restores_the_original_live_content(self) -> None:
        # staged does not exist -> the rename(staged, live) step must raise,
        # and the pre-swap `live` content must come back exactly.
        live = self.tmp / "live"
        staged = self.tmp / "staged"  # deliberately never created
        live.mkdir()
        (live / "old.txt").write_text("old", encoding="utf-8")

        with self.assertRaises(OSError):
            atomic_replace_dir(staged, live)

        self.assertTrue((live / "old.txt").exists())
        self.assertFalse((self.tmp / "live.prior").exists())

    def test_crash_recovery_restores_backup_when_live_is_missing(self) -> None:
        # Simulates a process that died between the two renames of an earlier
        # run: `live` is gone, but `<live>.prior` (the pre-swap corpus) is
        # still on disk. The next call must not silently drop that corpus.
        live = self.tmp / "live"
        staged = self.tmp / "staged"
        backup = self.tmp / "live.prior"
        backup.mkdir()
        (backup / "old.txt").write_text("old", encoding="utf-8")
        staged.mkdir()
        (staged / "new.txt").write_text("new", encoding="utf-8")

        atomic_replace_dir(staged, live)

        self.assertTrue((live / "new.txt").exists())
        self.assertFalse(backup.exists())


class BuildSpanishWiringTests(unittest.TestCase):
    """build_spanish.py must reuse build_bible.py's validation/swap functions
    rather than duplicating (and risking drifting from) them, and must not
    do any filesystem or network I/O merely on import."""

    def test_module_imports_cleanly(self) -> None:
        import build_spanish  # noqa: F401  (import success is the assertion)

    def test_reuses_build_bible_validate_and_swap_functions(self) -> None:
        import build_bible
        import build_spanish

        self.assertIs(build_spanish.validate_version_payload, build_bible.validate_version_payload)
        self.assertIs(build_spanish.atomic_replace_dir, build_bible.atomic_replace_dir)

    def test_declared_verse_total_matches_versification_report(self) -> None:
        import build_spanish

        # tools/versification-report.md (read-only for this task) declares
        # 31,103 Spanish verses against BSB's 31,102.
        self.assertEqual(build_spanish.DECLARED_VERSE_TOTAL, 31_103)


if __name__ == "__main__":
    unittest.main(verbosity=2)
