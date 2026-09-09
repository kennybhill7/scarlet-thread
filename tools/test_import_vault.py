"""Synthetic-fixture tests for the vault-wide person backlink index in
tools/import_vault.py (CODEX_AUDIT A-010 / A-017).

CODEX_AUDIT A-010: import_people() used to hardcode `chapters: []` for every
person and only read OUTBOUND links from that person's own '03 People/*.md'
'## Threads' section. It never resolved INBOUND links -- a passage note or
thread note that mentions/links to a person without that person's own note
linking back. Result: the generated people.json reported all five people as
orphans (zero chapters, zero threads) when the source material only has
three real orphans; web/db/seed.ts's preflight() (read-only, not touched
here) correctly rejected the mismatch via its own expectedPersonOrphans =
{abraham, david, noah} allowlist.

Deliberately NEVER reads from or writes to the real Bible-Brain/ vault --
that directory holds Ken's real personal data and is a standing off-limits
path for automated tests. Every fixture below is a small synthetic vault
tree built with tempfile, mirroring the real '01 Passages'/'02 Threads'/
'03 People' folder structure and the note formats import_stages()/
import_threads()/import_people() already parse (frontmatter, '**Read:**'
line, '## ' sections, '[[wikilinks]]').

Run:  python tools/test_import_vault.py
      (on Windows use /c/Users/kenny/AppData/Local/Python/bin/python.exe --
      bare `python` triggers a Windows Store stub)
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_vault import (  # noqa: E402
    EXPECTED_PERSON_ORPHANS,
    Report,
    build_person_backlinks,
    check_person_orphans,
    import_people,
    links_in,
    parse_sections,
    person_slugs,
    slugify,
)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_synthetic_vault(root: Path) -> None:
    """Builds a small, fully-synthetic vault:

    - One passage note ("The Call", Genesis 12 -> anchor "1.12") whose
      '## Observation' section links [[Zeke Testperson]] -- an INBOUND
      person link written in ordinary journaling prose, not a dedicated
      "People" heading, matching A-010's own framing that the vault's link
      convention (wikilinks anywhere in the note), not a specific section
      name, is what carries the relationship.
    - One thread note ("Faith Journey") whose '## What I'm seeing' section
      links [[Mira Testperson]] -- an INBOUND person link from a thread
      note instead of a passage note.
    - Four person notes:
        * Zeke Testperson  -- NO outbound '## Threads' section of his own;
          only ever referenced inbound (from the passage note above).
        * Mira Testperson  -- NO outbound '## Threads' section of her own;
          only ever referenced inbound (from the thread note above).
        * Nadia Outbound   -- HAS an outbound '## Threads' link of her own
          (to Faith Journey) and is never mentioned anywhere else. Proves
          the pre-existing outbound path still works after the fix.
        * Otto Orphan      -- referenced nowhere, and has no outbound
          '## Threads' section either. A genuine, correctly-reported orphan.
    """
    write(
        root / "01 Passages" / "The Call.md",
        "---\n"
        "stage: 1\n"
        "side: ascent\n"
        "---\n"
        "# The Call\n"
        "\n"
        "**Read:** Genesis 12\n"
        "\n"
        "## Observation\n"
        "\n"
        "- [[Zeke Testperson]] steps out in faith without knowing the destination.\n"
        "\n"
        "## Questions\n"
        "\n"
        "- What does obedience cost him?\n"
        "\n"
        "## Threads\n"
        "\n"
        "- [[Faith Journey]]\n",
    )

    write(
        root / "02 Threads" / "Faith Journey.md",
        "# Faith Journey\n"
        "\n"
        "**In one line:** Trusting God before seeing the outcome.\n"
        "\n"
        "## What I'm seeing\n"
        "\n"
        "Across many figures, obedience precedes understanding. "
        "[[Mira Testperson]] wrestles with the same pattern in her own account.\n"
        "\n"
        "## Passages\n"
        "\n"
        "- [[01 Passages/The Call]]\n",
    )

    write(
        root / "03 People" / "Zeke Testperson.md",
        "# Zeke Testperson\n"
        "\n"
        "**In one line:** A journeyer who trusts without seeing the end.\n"
        "\n"
        "## What I'm seeing\n"
        "\n"
        "He obeys before he understands.\n",
    )

    write(
        root / "03 People" / "Mira Testperson.md",
        "# Mira Testperson\n"
        "\n"
        "**In one line:** A companion who notices the same rhythm.\n"
        "\n"
        "## What I'm seeing\n"
        "\n"
        "She notices the same rhythm in her own life.\n",
    )

    write(
        root / "03 People" / "Nadia Outbound.md",
        "# Nadia Outbound\n"
        "\n"
        "**In one line:** Links out to her own thread explicitly.\n"
        "\n"
        "## What I'm seeing\n"
        "\n"
        "She names her own thread connection directly.\n"
        "\n"
        "## Threads\n"
        "\n"
        "- [[Faith Journey]]\n",
    )

    write(
        root / "03 People" / "Otto Orphan.md",
        "# Otto Orphan\n"
        "\n"
        "**In one line:** No one links to him, and he links to no one.\n"
        "\n"
        "## What I'm seeing\n"
        "\n"
        "He remains isolated in this fixture.\n",
    )


class VaultFixtureTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="import-vault-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.vault = self.tmp / "Bible-Brain"
        make_synthetic_vault(self.vault)
        self.report = Report()
        self.known = person_slugs(self.vault)

    def old_outbound_only_chapters_and_threads(self, note_stem: str) -> tuple[list, set]:
        """Reproduces the PRE-FIX behavior exactly: chapters hardcoded to
        [], threads read only from that person's own '## Threads' section --
        no backlink index at all. Used to prove the regression tests below
        actually exercise the bug (they must fail under this old logic and
        pass under the real, fixed import_people())."""
        text = (self.vault / "03 People" / f"{note_stem}.md").read_text(encoding="utf-8")
        sections = parse_sections(text)
        outbound_threads = {slugify(t) for t in links_in(sections.get("Threads"))}
        return [], outbound_threads


class KnownPersonSlugsTests(VaultFixtureTestCase):
    def test_person_slugs_finds_all_four_synthetic_people(self) -> None:
        self.assertEqual(
            self.known,
            {"zeke-testperson", "mira-testperson", "nadia-outbound", "otto-orphan"},
        )


class InboundFromPassageNoteTests(VaultFixtureTestCase):
    """A-010's core regression: a person referenced ONLY by an inbound link
    from a passage note must NOT be reported as an orphan after the fix."""

    def test_zeke_gets_an_inbound_chapter_from_the_passage_note(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        self.assertEqual(backlinks["zeke-testperson"]["chapters"], {"1.12"})
        self.assertEqual(backlinks["zeke-testperson"]["threads"], set())

    def test_zeke_has_no_outbound_threads_section_of_his_own(self) -> None:
        # Confirms the fixture actually represents "inbound-only" -- if this
        # assertion ever failed, the test above would not be proving what it
        # claims to prove.
        old_chapters, old_threads = self.old_outbound_only_chapters_and_threads(
            "Zeke Testperson"
        )
        self.assertEqual(old_chapters, [])
        self.assertEqual(old_threads, set())

    def test_old_outbound_only_logic_would_have_reported_zeke_as_an_orphan(self) -> None:
        # This is the mutation-proof: replays the exact pre-fix computation
        # (chapters=[], threads=outbound-'## Threads'-section-only) and
        # shows it lands on "orphan" for Zeke -- i.e. the bug this task
        # fixes is real and this fixture reproduces it.
        old_chapters, old_threads = self.old_outbound_only_chapters_and_threads(
            "Zeke Testperson"
        )
        is_orphan_under_old_logic = not old_chapters and not old_threads
        self.assertTrue(
            is_orphan_under_old_logic,
            "fixture does not reproduce the A-010 bug -- old logic must "
            "mark an inbound-only person as an orphan for this test to have teeth",
        )

    def test_new_import_people_does_not_report_zeke_as_an_orphan(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        people = import_people(self.report, self.vault, backlinks)
        zeke = next(p for p in people if p["slug"] == "zeke-testperson")
        self.assertEqual(zeke["chapters"], ["1.12"])
        self.assertFalse(
            not zeke["chapters"] and not zeke["threads"],
            "zeke has an inbound passage link and must not be an orphan after the fix",
        )


class InboundFromThreadNoteTests(VaultFixtureTestCase):
    """Same regression, but the inbound link comes from a thread note's body
    (e.g. its 'What I'm seeing' reflection) rather than a passage note."""

    def test_mira_gets_an_inbound_thread_edge_from_the_thread_note(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        self.assertEqual(backlinks["mira-testperson"]["threads"], {"faith-journey"})
        self.assertEqual(backlinks["mira-testperson"]["chapters"], set())

    def test_old_outbound_only_logic_would_have_reported_mira_as_an_orphan(self) -> None:
        old_chapters, old_threads = self.old_outbound_only_chapters_and_threads(
            "Mira Testperson"
        )
        is_orphan_under_old_logic = not old_chapters and not old_threads
        self.assertTrue(
            is_orphan_under_old_logic,
            "fixture does not reproduce the A-010 bug for a thread-sourced inbound link",
        )

    def test_new_import_people_does_not_report_mira_as_an_orphan(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        people = import_people(self.report, self.vault, backlinks)
        mira = next(p for p in people if p["slug"] == "mira-testperson")
        self.assertEqual(mira["threads"], ["faith-journey"])
        self.assertFalse(not mira["chapters"] and not mira["threads"])


class OutboundLinkStillWorksTests(VaultFixtureTestCase):
    """A-010's fix is additive, not a replacement -- a person's own outbound
    '## Threads' section link must keep working exactly as before."""

    def test_nadia_gets_her_own_outbound_thread_with_zero_inbound_edges(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        # Nadia is never mentioned in any passage/thread note body -- her
        # only link is the one she wrote herself.
        self.assertEqual(backlinks["nadia-outbound"]["chapters"], set())
        self.assertEqual(backlinks["nadia-outbound"]["threads"], set())

        people = import_people(self.report, self.vault, backlinks)
        nadia = next(p for p in people if p["slug"] == "nadia-outbound")
        self.assertEqual(nadia["threads"], ["faith-journey"])
        self.assertEqual(nadia["chapters"], [])
        self.assertFalse(not nadia["chapters"] and not nadia["threads"])


class GenuineOrphanStillReportedTests(VaultFixtureTestCase):
    """The fix must not make EVERYONE look linked -- a person with truly
    zero links in either direction must still be reported as an orphan."""

    def test_otto_has_zero_backlinks(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        self.assertEqual(backlinks["otto-orphan"]["chapters"], set())
        self.assertEqual(backlinks["otto-orphan"]["threads"], set())

    def test_otto_is_still_reported_as_an_orphan_after_the_fix(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        people = import_people(self.report, self.vault, backlinks)
        otto = next(p for p in people if p["slug"] == "otto-orphan")
        self.assertEqual(otto["chapters"], [])
        self.assertEqual(otto["threads"], [])
        self.assertTrue(
            not otto["chapters"] and not otto["threads"],
            "a genuinely unlinked person must still be reported as an orphan",
        )


class CheckPersonOrphansTests(VaultFixtureTestCase):
    """This synthetic vault's real orphan set is {otto-orphan} (Zeke and
    Mira are inbound-only-but-linked, Nadia is outbound-linked) -- deliberately
    NOT {abraham, david, noah}, so these tests exercise check_person_orphans()
    reporting a real, specific mismatch rather than the happy path."""

    def test_expected_person_orphans_constant_matches_seed_ts_allowlist(self) -> None:
        # web/db/seed.ts's expectedPersonOrphans (read-only for this task) is
        # {"abraham", "david", "noah"} -- this constant must mirror it exactly.
        self.assertEqual(EXPECTED_PERSON_ORPHANS, {"abraham", "david", "noah"})

    def test_synthetic_vault_orphan_mismatch_is_reported_specifically(self) -> None:
        backlinks = build_person_backlinks(self.known, self.report, self.vault)
        people = import_people(self.report, self.vault, backlinks)
        issues = check_person_orphans(people)

        # otto-orphan is an unexpected orphan (not in {abraham, david, noah}).
        self.assertTrue(any("otto-orphan" in issue for issue in issues))
        # abraham/david/noah are expected orphans that this synthetic vault
        # doesn't even define people notes for -- also reported, specifically.
        for slug in ("abraham", "david", "noah"):
            self.assertTrue(
                any(slug in issue for issue in issues),
                f"missing expected-orphan mismatch report for '{slug}'",
            )

    def test_exact_match_reports_no_issues(self) -> None:
        # A hand-built people list whose orphan set is exactly the expected
        # {abraham, david, noah} -- the real seed.ts-matching happy path.
        people = [
            {"slug": "abraham", "chapters": [], "threads": [], "name": "Abraham"},
            {"slug": "david", "chapters": [], "threads": [], "name": "David"},
            {"slug": "noah", "chapters": [], "threads": [], "name": "Noah"},
            {"slug": "adam", "chapters": ["1.2"], "threads": [], "name": "Adam"},
            {"slug": "jesus", "chapters": [], "threads": ["faith-journey"], "name": "Jesus"},
        ]
        self.assertEqual(check_person_orphans(people), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
