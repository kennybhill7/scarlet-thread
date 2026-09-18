# `content/` — the curriculum content pipeline

**No lesson content exists yet. This is the compiler only.**

CONTENTPIPE-001 built the schema, validation, assertion-line lint, and
build/checksum step described in `BUILD_PLAN.md` §5.1. It deliberately did
**not** author any real lesson content — no real Genesis 3 prose, no real
sourced context, no real named positions. Authoring the first real lesson
(Genesis 3, per `BUILD_PLAN.md` §9's named first vertical slice) is a
separate, later, more carefully-scoped task, per `BUILD_PLAN.md`'s own
tenet 6: "Tests certify software; a pastor certifies theology."

This document is for whoever picks up that later task (Ken, or another
agent) — it records the real, current authoring convention this pipeline
already enforces.

## Two scope narrowings from §5.1, real and deliberate

1. **Plain Markdown + YAML-subset frontmatter, not MDX.** §5.1 says lessons
   are authored as MDX. No MDX tooling (`@mdx-js` or similar) exists
   anywhere in this repo's dependencies today, and there is no lesson
   content yet that needs embedded interactive components. Lessons are
   `.md` files with a YAML-subset frontmatter block — see "Frontmatter
   schema" and the parser's own grammar comment in
   `web/scripts/content/validate.ts` (`parseFrontmatterYaml`) for exactly
   what syntax is supported. If real interactive-component needs emerge
   later, upgrading to true MDX is a real, separate, future decision — this
   pipeline does not half-build it now.
2. **Checksummed in Postgres, not signed to external storage.** `build.ts`
   computes a real SHA-256 checksum over the compiled release bundle's
   canonical JSON and writes it to the new `catalog_releases` table
   (`web/db/schema.ts`). It does **not** implement literal cryptographic
   signing (no keypair/signature scheme) — this is a solo-operator tool
   today, not a multi-party trust boundary. "Durable, append-only storage,
   independent of any single Vercel deployment" (§5.1) is satisfied by
   living in Postgres rather than in a Vercel build's output, not by a
   separate object-storage integration this task does not need.

## Where a lesson lives

```
content/curriculum/<track>/<nn-slug>.md
```

## Source registry

`content/source-registry.json` is the authoring bibliography registry. Every
ID in a lesson's `sources` list must appear there before `content:build` can
proceed. The registry stores bibliographic metadata, a provenance URL, a
license/copying note, and access date; it does not reproduce copyrighted
source text. The compiler checks IDs against this file before the publication
status gate and before any database write.

This is the authoring-side resolution gate. A later release migration must
also upsert or verify the same IDs in the curated Postgres `sources` table
before publishing a catalog row; the JSON file alone is not evidence that
those database rows exist.

e.g. `content/curriculum/genesis/03-the-fall.md`. The path (minus `.md`,
forward-slash separated) becomes the lesson's slug in the compiled release
bundle — see `web/scripts/content/build.ts`'s `slugFor`.

## Frontmatter schema

Validated by `web/scripts/content/schema.ts` (`LessonFrontmatterSchema`).
Every field below is **required** unless marked optional; unknown keys are
a real validation error (`.strict()`), not silently ignored.

```
---
passage:
  start: "1.3.1"
  end: "1.3.24"
stage: 3
methodFocus: "Observation vs. inference"
author: "Kenneth Hill"
status: draft
contextId: gen-3-ane-context      # optional
connectionIds:                     # optional, defaults to []
  - conn-fall-romans5
positionIds: []                    # optional, defaults to []
sources:                           # optional, defaults to []
  - source-kidner-genesis-tyndale
assertionReviewed: "reviewed 2026-09-12, quoting Kidner directly"  # optional
---
```

- **`passage`** — a `CanonicalRangeV1` (`web/lib/contracts/range-v1.ts`), the
  same type every other v2 table stores a passage range as — not a parallel
  string format. Write only `start`/`end` (both `book.chapter.verse` keys,
  e.g. `"1.3.1"` = Genesis 3:1); `versificationId` is filled in
  automatically (the one versification this contract speaks today) unless
  you write it explicitly, in which case it must match exactly.
  `schema.ts`'s own bounds check is permissive (catches a malformed key,
  cross-book range, or reversed range, but not an out-of-bounds one);
  `validate.ts` re-checks every passage against the real shipped BSB corpus
  for genuine chapter/verse bounds.
- **`stage`** — an integer 1–11 (this app's real mountain-stage numbers,
  `lib/contracts.ts`'s `Stage.stage`).
- **`methodFocus`** — free text naming the study skill this lesson teaches.
- **`author`** — required, never defaulted (BUILD_PLAN tenet 6: "every
  curated lesson names its author").
- **`status`** — `draft` | `in_review` | `published`.
- **`contextId` / `connectionIds[]` / `positionIds[]` / `sources[]`** — id
  strings referencing `passageContexts` / `graph_edges` (as authored rows,
  distinct from GRAPHEDGES-001's bulk-imported ones) / `positions` / a full
  sources table. **None of those tables exist yet** (`web/db/schema.ts`'s
  own GRAPHEDGES-001 comment: "passageContexts/doctrines/graph_edge_evidence
  remain unbuilt"). This schema can therefore only check these are
  well-formed, non-empty, whitespace-free strings — never that they resolve
  to a real row. Building that resolution is future work for whichever task
  builds those tables.
- **`assertionReviewed`** — see "The assertion-line lint" below. Optional;
  when present, must state an actual reason, not just be a bare flag.

## The `## Positions` convention

A markdown ATX level-2 heading whose text is exactly `## Positions` opens a
"Positions" block; the block runs from that heading line through the next
`## `-level heading (or the end of the lesson body, whichever comes first).
This is the one convention `validate.ts` recognizes — no HTML-comment
delimiters, no case-insensitive matching, so it stays a convention a human
author can spot on sight, not just a machine one.

```markdown
## Positions

Reformed confessions hold that ..., citing [these texts].

Wesleyan interpreters hold that ..., citing [these texts].
```

Every lesson with a `## Positions` block must also list at least one entry
in `sources[]` (a lightweight heuristic standing in for §5.1's real rule —
"every positions block names ≥2 traditions each with their own source" —
until real per-tradition source resolution exists).

## The `## Literary Design` convention (optional)

LESSONSHAPE-001. Same technique as `## Positions` above — a markdown ATX
level-2 heading whose text is exactly `## Literary Design` opens a block
running from that heading to the next `## `-level heading or the end of the
body, extracted via `lib/content/publishedLessons.ts`'s `extractHeadingProse`
(the same generic function `contextProse`/`positionsProse` already use,
parameterized by heading text — no new parsing logic exists for this
heading). `BUILD_PLAN.md` §5.2 names "literary design notes" as part of what
each lesson ships, but §5.1's own required-CI-rules bullet does not name it —
so, like `## Context`, it is optional: no schema field requires it, and
`content:validate`/`content:build` never check for it. There is no dedicated
workspace UI slot for it as of LESSONSHAPE-001 (unlike `## Context`,
`## Positions`, `## Practice Bridge Example`, and `## Teach-Back Prompts`,
which each render somewhere in the study workspace) — `literaryDesignProse`
is available on `PublishedLessonMatch` for a future task to surface.

```markdown
## Literary Design

Notes on the passage's own structure -- chiasm, repetition, inclusio,
narrative arc -- as an aid to reading it well. This is about how the text
is built, not a claim about what that structure means theologically.
```

## The `## Practice Bridge Example` convention (optional)

LESSONSHAPE-001. Same technique again. `BUILD_PLAN.md` §5.2 names "a worked
Practice Bridge example" as part of what each lesson ships, and §5.1 says so
explicitly: "Worked Practice Bridge examples must follow the bridge shape
but are not required in every lesson" — optional, the same tier as
`## Context`/`## Literary Design`. When present, `practiceBridgeProse`
renders in the Apply section (`components/workspace/ApplySection.tsx`) as a
clearly labeled, read-only worked example ABOVE the learner's own real
Application composer — the composer always still mounts regardless of
whether this section exists; curated content supplements the learner's own
attempt, never replaces it, the same rule `## Context`/`## Positions`
already follow for Context/Theology.

```markdown
## Practice Bridge Example

One way to walk the bridge from this passage's original meaning to a
modern situation: what it meant to its original audience, the enduring
principle carried forward, how that principle bridges to today, and a
concrete modern application worked all the way through, as an example.
The learner's own attempt below is a separate, required step -- this is a
model, not an answer key.
```

## The `## Teach-Back Prompts` convention (REQUIRED)

LESSONSHAPE-001. Unlike every other named heading in this document,
`## Teach-Back Prompts` is REQUIRED — §5.1's own CI-rules bullet says so in
as many words: "a teach-back prompt set exists." `validate.ts`'s
`validateLessonSource` fails the whole lesson file — a real, specific error
naming the file — when this heading is entirely absent, or present but empty
(only blank lines under it counts as absent too, the same "bare heading has
no real content" standard `extractHeadingProse` already applies when
*reading* `## Context`/`## Positions`). As with `## Positions`'s own
sources[]-when-present heuristic, this is a STRUCTURAL check only ("the
heading exists with real, non-blank content under it"), never a semantic
one — the compiler does not confirm all five prompts named below actually
appear; a human reviewer still does that judgment call.

BUILD_PLAN.md §5.2 names five specific prompts a complete teach-back set
should carry. This is the expected shape for whoever authors this section —
a labeled list is fine; it does not need to be machine-parsed sub-structure:

1. **Blind explain** — explain the passage's meaning without notes.
2. **Five-minute outline** — outline how you would teach this in five
   minutes.
3. **Likely objection** — name a likely objection to your own reading, and
   how you would answer it.
4. **What this passage does not establish** — name one thing this passage
   does NOT establish, even if a popular reading assumes it does.
5. **Defend or decline** — defend one connection you have drawn from this
   passage, or give a reasoned `no_warrant_yet` if you cannot yet defend one.

When present, `teachBackPromptsProse` renders in the Teach section
(`components/workspace/TeachSection.tsx`) as a clearly labeled set of
suggested prompts, ABOVE the learner's own real teaching-draft form and
outline builder — never in place of it.

```markdown
## Teach-Back Prompts

1. Explain this passage's meaning without your notes.
2. Outline how you would teach it in five minutes.
3. Name a likely objection to your reading, and how you would answer it.
4. Name one thing this passage does not establish.
5. Defend one connection you have drawn from it, or give a reasoned
   `no_warrant_yet`.
```

The currently-published `content/curriculum/genesis/03-the-fall.md` predates
this rule and does not yet have a `## Teach-Back Prompts` section — as of
LESSONSHAPE-001 it correctly FAILS `content:validate`/`content:build` until a
follow-up content-authoring task adds one. That is the intended, expected
behavior of this rule, not a bug.

## The assertion-line lint — a review aid, not a proof

`validate.ts`'s `lintAssertionLanguage` flags four declarative
doctrinal-verdict phrases anywhere in lesson body prose, case-insensitive:

- "this passage teaches that"
- "the correct view is"
- "this proves"
- "this means"

A match is **not** flagged when the line:

- falls inside a `## Positions` block (see above), or
- is a markdown blockquote (`> ...`) — the "quoted, attributed source"
  exemption.

Otherwise a match fails validation loudly. §5.1's own words: "imperfect by
nature — it is a review aid, not a proof." It cannot tell whether verdict
language is theologically correct, only that it *reads* like an
unattributed verdict outside the two exemptions above — a human reviewer
still does the real "does this cross the assertion line" judgment call
(`BUILD_PLAN.md` §5.3, "assertion-line compliance... partly mechanized by
the verdict-language lint, finished by human review").

### Silencing a match — `assertionReviewed`, and only that

The **only** way to publish a lesson past a lint match is an explicit
frontmatter key naming a real reason:

```yaml
assertionReviewed: "reviewed 2026-09-12 -- direct Kidner quote, not this project's own verdict"
```

This is legitimate when a human has actually looked at every flagged line
and confirmed it does not cross the assertion line (e.g. the lint's regex
caught a false positive, or the phrasing is being tightened in a follow-up
edit). It is **not** legitimate as a way to bulk-silence unread lint
output — `assertionReviewed` silences the *entire lesson's* lint results at
once (this pipeline does not yet support silencing individual lines), so it
should only be set after reading every match `content:validate` reported.
A silenced lesson still prints its matches as warnings, every time — never
swallowed.

## Running the pipeline

```
cd web
npm run content:validate   # schema + lint over every content/curriculum/**/*.md
npm run content:build      # validate, then compile a release bundle, checksum it,
                            # and write one row to catalog_releases (requires DATABASE_URL)
```

`content:build` succeeds with an empty, zero-lesson release when
`content/curriculum/` doesn't exist or has no lessons yet — exactly the
state this repository is in right now.
