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
    compute_dir_revision,
    compute_revision,
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


class ComputeRevisionTests(unittest.TestCase):
    """CODEX_AUDIT A-020: compute_revision() is the pure, synthetic-fixture-
    testable core of the corpus content-revision mechanism. It must be a real
    hash of content -- deterministic across runs/insertion order, sensitive
    to any real change, and blind to anything not passed in (mtimes, path
    enumeration order, etc. never reach it at all, since it takes an
    in-memory dict)."""

    def test_same_content_same_revision_regardless_of_dict_order(self) -> None:
        a = {"BSB/1.json": b"genesis", "KJV/1.json": b"genesis kjv"}
        b = {"KJV/1.json": b"genesis kjv", "BSB/1.json": b"genesis"}
        self.assertEqual(compute_revision(a), compute_revision(b))

    def test_different_content_different_revision(self) -> None:
        a = {"BSB/1.json": b"genesis"}
        b = {"BSB/1.json": b"genesis, corrected"}
        self.assertNotEqual(compute_revision(a), compute_revision(b))

    def test_a_single_byte_change_changes_the_revision(self) -> None:
        # Guards against a hash that only notices whole-file swaps/insertions
        # and would miss a corpus rebuild that changes one verse.
        a = {"BSB/1.json": b'{"c":[["In the beginning."]]}'}
        b = {"BSB/1.json": b'{"c":[["In the beginning!"]]}'}
        self.assertNotEqual(compute_revision(a), compute_revision(b))

    def test_adding_or_removing_a_file_changes_the_revision(self) -> None:
        base = {"BSB/1.json": b"genesis"}
        with_extra = {"BSB/1.json": b"genesis", "BSB/2.json": b"exodus"}
        self.assertNotEqual(compute_revision(base), compute_revision(with_extra))

    def test_renaming_a_path_changes_the_revision(self) -> None:
        # The path is hashed alongside the bytes, so identical content under a
        # different key (e.g. a version ID typo/rename) is not silently
        # treated as identical.
        a = {"BSB/1.json": b"same bytes"}
        b = {"KJV/1.json": b"same bytes"}
        self.assertNotEqual(compute_revision(a), compute_revision(b))

    def test_empty_corpus_is_deterministic_not_a_crash(self) -> None:
        self.assertEqual(compute_revision({}), compute_revision({}))

    def test_revision_is_a_short_hex_string(self) -> None:
        revision = compute_revision({"BSB/1.json": b"genesis"})
        self.assertRegex(revision, r"^[0-9a-f]{16}$")

    def test_revision_is_not_a_disguised_timestamp(self) -> None:
        # Calling it twice, with a real wall-clock gap, on IDENTICAL content
        # must produce the IDENTICAL revision -- the whole point of A-020 is
        # that a rebuild with no real content change must not invalidate
        # every device's cache.
        import time

        content = {"BSB/1.json": b"genesis", "KJV/1.json": b"genesis kjv"}
        first = compute_revision(content)
        time.sleep(0.01)
        second = compute_revision(content)
        self.assertEqual(first, second)


class ComputeDirRevisionTests(unittest.TestCase):
    """Filesystem wrapper around compute_revision() -- exercised against real
    (temp-directory) files, the same style AtomicReplaceDirTests above uses
    for atomic_replace_dir()."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="corpus-revision-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _make_corpus(self, root: Path, *, genesis: bytes = b'{"b":"Genesis","c":[["v1"]]}') -> None:
        (root / "BSB").mkdir(parents=True, exist_ok=True)
        (root / "BSB" / "1.json").write_bytes(genesis)
        (root / "BSB" / "2.json").write_bytes(b'{"b":"Exodus","c":[["v1"]]}')
        (root / "index.json").write_text('{"placeholder": true}', encoding="utf-8")

    def test_identical_content_same_revision_across_two_independently_built_dirs(self) -> None:
        one = self.tmp / "one"
        two = self.tmp / "two"
        self._make_corpus(one)
        self._make_corpus(two)
        self.assertEqual(compute_dir_revision(one), compute_dir_revision(two))

    def test_a_real_content_change_changes_the_revision(self) -> None:
        one = self.tmp / "one"
        two = self.tmp / "two"
        self._make_corpus(one)
        self._make_corpus(two, genesis=b'{"b":"Genesis","c":[["v1 corrected"]]}')
        self.assertNotEqual(compute_dir_revision(one), compute_dir_revision(two))

    def test_index_json_itself_is_excluded_from_the_hash(self) -> None:
        # index.json is the file THIS revision gets written into -- if it were
        # hashed, the revision would depend on its own stale prior value (or
        # not exist yet on a first build), not on "the content this revision
        # identifies". Rewriting index.json with a different placeholder must
        # not move the revision at all.
        root = self.tmp / "corpus"
        self._make_corpus(root)
        before = compute_dir_revision(root)
        (root / "index.json").write_text('{"placeholder": false, "extra": 123}', encoding="utf-8")
        after = compute_dir_revision(root)
        self.assertEqual(before, after)

    def test_nested_version_subdirectories_are_all_included(self) -> None:
        root = self.tmp / "corpus"
        self._make_corpus(root)
        without_kjv = compute_dir_revision(root)
        (root / "KJV").mkdir()
        (root / "KJV" / "1.json").write_bytes(b'{"b":"Genesis","c":[["v1 kjv"]]}')
        with_kjv = compute_dir_revision(root)
        self.assertNotEqual(without_kjv, with_kjv, "adding a whole translation must change the revision")


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
        self.assertIs(build_spanish.compute_dir_revision, build_bible.compute_dir_revision)

    def test_declared_verse_total_matches_versification_report(self) -> None:
        import build_spanish

        # tools/versification-report.md (read-only for this task) declares
        # 31,103 Spanish verses against BSB's 31,102.
        self.assertEqual(build_spanish.DECLARED_VERSE_TOTAL, 31_103)


if __name__ == "__main__":
    unittest.main(verbosity=2)
