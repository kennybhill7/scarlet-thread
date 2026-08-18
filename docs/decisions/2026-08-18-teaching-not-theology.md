# Decision: Scarlet Thread is a teaching app, not a theology app

**Date:** 2026-08-18
**Decided by:** Ken (owner)
**Status:** Adopted. Supersedes the pastoral-review requirement in `BUILD_PLAN.md` Phase 3 and the "Doctrine Library" framing in Phase 4.

## The decision

Scarlet Thread teaches a **repeatable method for studying Scripture** and makes the
learner do the interpretive work. It does **not** assert doctrinal conclusions.

## Why

The previous plan required a qualified pastor or elder to independently certify the
doctrinal content of 30 curriculum units before publication. Ken is not ordained and
cannot supply that review. That single dependency was the schedule's hard wall: every
other phase compresses under parallel agent work, and this one did not compress at all.

Two ways out existed. Recruit a reviewer — real, but it makes the project's critical
path depend on someone else's availability indefinitely. Or narrow what the app claims
so the remaining claims are checkable without doctrinal authority.

The second is chosen, and not merely as the cheaper option: **it is closer to the
product's own founding tenet than the thing it replaces.** Design tenet 1 has always
been *read before you write — no curated conclusion reaches the learner before their
own attempt*. An app that ships adjudicated doctrine is in tension with that tenet.
An app that teaches method, supplies sourced facts, and shows what faithful
interpreters have concluded and why — leaving the verdict to the learner — is the
truer version of what was originally described.

## The assertion line

The app **may** assert:

1. **Method** — how to bound a literary unit, how observation differs from inference,
   what evidence each connection type requires, how the Practice Bridge works.
   Pedagogy. The project owns it.
2. **Cited fact** — genre, author/audience, historical setting, cultural background,
   lexical meaning, textual variants. Each carries a `sourceId` to a real published
   work, and must say what that source says. Verifying this is a *factual* check, not
   an *authority* check.
3. **Named positions, reported descriptively** — what identified traditions hold and
   the texts they cite, sourced to their own published statements, without adjudication.

The app **must not** assert:

4. **Adjudicated doctrine** — "this passage means X", "position Y is correct",
   "doctrine Z is true". This is the learner's work, and it is precisely the category
   that required a pastor.

## What changes

- **Phase 3** becomes a *method* curriculum. Review is three checks the project can
  perform: source fidelity, assertion-line compliance, position fairness. A
  verdict-language lint in `validate.ts` mechanizes part of check 2 and fails the
  build loudly; it is silenced only by an explicit reviewed frontmatter key.
- **Phase 4's Doctrine Library becomes a Positions Library** — it reports rather than
  adjudicates. The status badge now describes how widely a position is held, not which
  is correct.
- **Phase 3 is no longer content-blocked**, dropping from ~4–6 weeks gated on an
  unavailable reviewer to ~3–4 weeks of work the project can actually execute.

## What does NOT change

- The full loop: Read → Observe → Context → Interpret → Connect → Theology →
  Conviction → Practice → Teach. The Theology step stays, and stays central — it is
  the *learner* forming and warranting a claim.
- The evidence model: typed claims, epistemic basis, required evidence, confidence
  labels. This is the core teaching device; it exists to train the distinction between
  observation, inference, and conclusion.
- Typed connections with evidence labels, the Practice Bridge, teach-back, the
  Conviction Room's privacy guarantees, and every pastoral-safety boundary.

## Risks accepted

- **Drift.** Lesson-by-lesson, an author may slide from "traditions hold X" into
  "X is true." The verdict-language lint plus the §5.0 rule in review are the defense;
  neither is perfect, and the lint is explicitly a review aid, not a proof.
- **Sourcing burden moves, it does not vanish.** Every factual claim now needs a real
  citation. That is more work per lesson than asserting a conclusion — deliberately so,
  because it is work that can be checked without ordination.
- **Reversibility.** If the product later chooses to assert doctrine, that is a
  deliberate repositioning that reinstates the pastoral gate. It must not drift back in
  one lesson at a time.

## Naming

`THEOLOGY_MASTER_BUILD_PLAN.md` and `THEOLOGY_PRODUCT_AUDIT.md` keep their filenames
for now — they are referenced across the ledger, the queue, and several commit
messages, and renaming them would break more than it clarifies. Their *content* is
governed by this decision. A rename can be done later as a single deliberate change.
