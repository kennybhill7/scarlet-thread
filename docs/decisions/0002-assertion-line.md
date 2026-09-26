# ADR 0002: The assertion line

- Date: 2026-09-25
- Status: Accepted
- Builds on: [2026-08-18-teaching-not-theology.md](2026-08-18-teaching-not-theology.md) (ADR 0001, the decision itself)

## Context

ADR 0001 decided the app teaches a method and does not adjudicate doctrine. A decision like that erodes one lesson at a time unless it is enforced where lessons are compiled. This record fixes what is enforced, and states what is not.

## Decision

The app may assert only: (1) method, (2) cited fact carrying a `sourceId`, (3) named positions reported descriptively from the tradition's own source. It must not assert adjudicated doctrine ("this passage means X", "position Y is correct").

Enforcement is mechanical where possible, in `web/scripts/content/validate.ts`:

1. `lintAssertionLanguage` scans lesson body lines for four verdict phrases (`VERDICT_PATTERNS`: "this passage teaches that", "the correct view is", "this proves", "this means"), case-insensitive.
2. Two exemptions only: lines inside a `## Positions` block (`findPositionsBlockLines`) and markdown blockquote lines (`> ...`, the quoted-source exemption).
3. A match fails `content:validate` (and so `content:build`) unless the lesson frontmatter carries `assertionReviewed: "<reason>"`, which turns the failure into a reported warning. The key is schema-enforced to state a reason, not a bare flag.
4. A lesson with a `## Positions` block must have non-empty `sources[]`.
5. `## Teach-Back Prompts` is a required non-empty section (`hasNonEmptyHeadingSection`), the method-teaching device the ADR 0001 decision leans on.

## Consequences

- The lint is a review aid, not a proof. It is four phrases; a lesson can assert a verdict in words the list does not contain. `validate.ts` says so itself ("a review aid, not a proof"). Human review of source fidelity, assertion-line compliance and position fairness (ADR 0001's three checks) still applies to every lesson.
- The lint covers lesson bodies only. Other surfaces that can assert (the Mountain stage titles and lens, Story Map legend, future tours and place notes) are not linted today. This is recorded as risk G4 in `design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md`; extending the lint there is future work.
- `assertionReviewed` is the single sanctioned bypass. Its use is visible in the build output and in the lesson file's diff, which is the point.
- Reversing this (asserting doctrine) is a deliberate repositioning that reinstates the pastoral-review gate; it must not happen by editing the lint's exemptions.
