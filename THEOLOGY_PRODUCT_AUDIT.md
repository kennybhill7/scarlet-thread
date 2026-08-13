# Scarlet Thread — Theology Teaching Product Audit

**Audit date:** 2026-08-12  
**Scope:** Current repository, generated seed structure, production preview, tests/build/security posture, and the learning model required to become a theology teaching app.  
**Verdict:** Scarlet Thread is a promising Scripture reader and personal connection journal. It is **not yet a theology teaching app**. The current product helps users record what they notice, but it does not yet guide them through context, interpretation, doctrinal synthesis, warranted modern application, or teaching another person.

## Product principles to preserve

The original guide's five rules remain the right foundation:

1. Read before you write.
2. Record observations, not summaries.
3. Create a thread on the third genuine sighting.
4. Keep the one rule.
5. Never punish a missed day.

The teaching layer should extend these rules, not replace them. In particular, commentary or AI should not appear until the learner has read the passage and attempted an observation.

## What the code supports today

- Four Bible translations, per-book offline data, chapter reading, parallel Spanish, notes, questions, threads, review, and a visual eleven-stage mountain.
- A durable entry/thread contract and authenticated database/API foundation.
- Deterministic thread radar and a read-only teaching surface.
- Static validation is healthy: 35 tests pass, typecheck passes, lint passes, Drizzle schema check passes, and a network-enabled production build passes.
- A live Vercel preview exists, but database and Google OAuth credentials are not configured; it is a deployment preview, not a usable release.

## Highest-impact gaps

### 1. The data model records reactions, not disciplined interpretation

`Entry` stores a kind, body, chapter, optional verse, and thread links. `Thread` stores a title, definition, and sightings. There is no place to distinguish:

- what the text explicitly says;
- an interpretive inference;
- a theological conclusion;
- a tradition-specific position;
- a modern application;
- supporting passages and sources;
- confidence, disagreement, or pastoral review.

This makes thoughtful observations and unsupported claims structurally indistinguishable.

### 2. The learning journey stops after observation

The note composer exposes observation, question, and note. Although `teaching` exists in the contract and schema, the capture UI cannot create one. The reader does not guide the learner through original audience, genre, literary unit, historical setting, canonical connections, doctrine, application, or teach-back.

The target learning loop should be:

> **Text → Context → Connection → Theology → Conviction → Practice → Teach**

Each step should preserve the learner's own work and label evidence separately from inference.

### 3. The connection system needs typed, evidenced edges

Thread links currently say that two ideas are related, but not *how* they are related. Add connection types such as quotation, allusion, repeated motif, promise/fulfillment, type/antitype, covenant development, contrast, and doctrinal synthesis. Every proposed connection should include both passages and a short rationale.

The current radar is a useful discovery prompt, not a theological engine. It counts repeated words across distinct chapters. It cannot determine semantic equivalence or establish that an existing thread does not already cover a concept. It also lacks dedicated tests.

### 4. The mountain is an outline, not a whole-Bible curriculum

The eleven stages currently contain one anchor chapter each. That is enough for a visual storyline, but not enough to teach how the Law, Prophets, Wisdom literature, Gospels, Epistles, and Revelation contribute to the unified story. Each stage needs representative passages, prerequisite ideas, key doctrines, tensions, fulfillment links, and a learner-facing explanation.

### 5. Modern application has no interpretive guardrail

The app needs to prevent the common shortcut of jumping directly from an ancient sentence to a modern command. Application should capture:

1. What did this mean to the original audience?
2. What enduring principle is warranted by the passage?
3. What changes or remains discontinuous across the canon and the work of Christ?
4. Where does that principle touch modern life?
5. What is one concrete faithful response?
6. What misuse or overreach should be avoided?

Modern-life domains can include work, money, relationships, grief, anxiety, leadership, justice, technology, sexuality, and church life, but each application must remain traceable to text and context.

### 6. The teaching surface is not connected to the user's live data

The Review page reads build-time seed data. The seed contains 70 entries—52 observations, 18 questions, and zero teaching entries. Imported entries have no verse selection, and ten entries have no thread link. The deployed fallback returns empty arrays when private seed files are absent, so missing production setup can look like a legitimately empty account.

The UI should show an explicit **setup incomplete** state instead of silently presenting an empty theological history.

### 7. Product language occasionally claims more than the evidence

“Where God has been working” equates frequency in a user's notes with divine activity. The data only supports “What has been recurring in your study.” Keep spiritual language, but do not turn an algorithmic count into a theological claim.

## Recommended product surfaces

### Passage Workspace

One study workspace with progressive sections:

- **Read:** passage, surrounding literary unit, translation comparison, verse selection.
- **Observe:** repeated words, structure, people, actions, contrasts, questions.
- **Context:** genre, author/audience, historical-cultural setting, before/after, cited sources.
- **Connect:** typed links to other passages with evidence and rationale.
- **Theology:** what the passage reveals about God, humanity, sin, salvation, church, Spirit, kingdom, and new creation.
- **Apply:** original meaning, enduring principle, modern situation, concrete response, caution.
- **Teach:** big idea, text-shaped outline, gospel connection, likely objection, illustration, application, prayer.

### Connection Explorer

Expand the mountain into an evidence-based canonical map. Users should be able to filter by theme, covenant, doctrine, literary echo, person, place, and stage. Curated connections and personal discoveries must be visibly distinct.

### Doctrine Library

For each doctrine: concise definition, core passages, whole-Bible development, historical formulation, common misunderstandings, and primary/secondary/open-hand classification. Where Christian traditions differ, present named positions and their strongest textual arguments without manufacturing false certainty.

### Modern Life Lab

Case studies should ask the learner to identify the biblical principle, relevant context, competing wisdom, faithful action, and possible misuse. The goal is formed judgment, not canned inspirational answers.

### Teach-back Mode

Ask learners to explain a passage without notes, build a five-minute lesson, answer a likely objection, and say what they would *not* claim from the passage. Understanding should be measured by accurate explanation, not streaks or time spent.

## Data model additions

Introduce versioned, source-aware records rather than adding more free-text fields to `Entry`:

- `PassageContext`: passage/unit, genre, author/audience, historical setting, literary structure, sources, disputed flags.
- `StudyClaim`: observation/interpretation/theology/application, body, evidence references, viewpoint, confidence, reviewer.
- `Connection`: from/to references, connection type, rationale, source, curated/user provenance, confidence.
- `Doctrine`: definition, core texts, historical formulations, tradition tags, primary/secondary/open-hand status.
- `Application`: original audience, enduring principle, modern domain, concrete practice, cautions, review date.
- `TeachingDraft`: big idea, outline, gospel connection, objections, applications, prayer, audience, duration.
- `Source` and `Citation`: author, title, publisher, edition, page/URL, license, and access date.

## Theological and editorial governance

Before publishing teaching content, decide and disclose:

- the statement of faith and interpretive method;
- whether the app teaches one denominational tradition or compares multiple traditions;
- which doctrines are essential, secondary, or open questions;
- who can approve curated lessons and correct them later;
- source licensing and citation rules;
- pastoral-safety boundaries for mental health, abuse, medical, legal, and financial topics.

AI should come later. It should retrieve only from licensed or curated sources, cite every substantive claim, separate Scripture from interpretation, disclose disagreement, fail closed when evidence is absent, and never impersonate a living teacher. It should question, coach, compare, and help the user explain—not replace the user's encounter with the text.

## Release and engineering gaps to close first

These are prerequisites because wrong or missing Scripture, private-data leakage, and broken auth undermine the teaching experience:

1. Configure Neon and Google OAuth; run real multi-user tenant-isolation tests.
2. Move private seed content out of the build path and migrate it into the authenticated database.
3. Make missing production data an explicit setup error, not an empty success state.
4. Fix offline navigation for unvisited dynamic chapters and fail closed when a verse-alignment map is unavailable.
5. Make Scripture corpus generation non-destructive and validate omissions before replacing known-good data.
6. Add verse selection and preserve exact verse references through import, capture, sync, and export.
7. Add sign-out, clear-local-data, sync registration, accurate offline state, and authenticated cache purging.
8. Add CSP, frame restrictions, `nosniff`, referrer policy, and permissions policy.
9. Resolve the current dependency audit: three high findings overall, including one production-path `nanoid` advisory.
10. Resolve translation licensing, especially worldwide KJV distribution.
11. Update `CODEX_AUDIT.md`; it still lists already-fixed branding and third-sighting items as open while newer release findings are absent.

## Recommended build sequence

### Phase 0 — Truthful and safe foundation

Close the release gates above. Do not advertise the current Vercel preview as a working app until database-backed sign-in and account isolation are verified.

### Phase 1 — Study method and evidence model

Add verse selection, passage units, `StudyClaim`, `Connection`, sources/citations, and the Text → Context → Connection workflow. Build search across passages, threads, questions, and claims.

### Phase 2 — Pilot curriculum

Build two fully reviewed book experiences: **Genesis 1–12** for the Scarlet Thread foundation and **Matthew** for sustained, Christ-centered, book-by-book study. Each lesson should include context, literary design, canonical links, theology, application, and teach-back.

### Phase 3 — Doctrine, life, and teaching

Add the doctrine library, Modern Life Lab, teach-back builder, retrieval review, and pastoral/editorial review flow.

### Phase 4 — Optional cited assistant

Only after the source model and human-reviewed curriculum exist, add an assistant constrained by citations, interpretive labels, and explicit theological perspective.

## Acceptance rubric

A lesson is ready only when a learner can:

- distinguish observation, interpretation, theology, and application;
- explain the passage in its literary and historical context;
- defend a canonical connection using both passages;
- identify where faithful interpreters disagree;
- state a modern application without bypassing the original audience;
- teach a clear five-minute lesson with cited sources;
- name one claim the passage does **not** justify.

Automated tests should cover connection typing, source requirements, radar behavior, application guardrails, and permissions. Browser tests should cover the complete learning loop. Curated lessons need a golden-fixture review by a qualified pastor or theologian; software tests cannot certify theology.

## Teaching influence, without imitation

Assuming “Philip Anthony” means **Philip Anthony Mitchell**, the useful high-level patterns are sustained exposition, a clear gospel center, candor about sin and repentance, and a call to discipleship. From Dharius Daniels, the useful patterns are accurate biblical understanding, practical ethical navigation, coaching/community, and proving understanding by explaining it in one's own words. Scarlet Thread should embody those pedagogical principles without copying either living teacher's voice, persona, sermon language, or proprietary material.

## Bottom line

Do not turn Scarlet Thread into a commentary feed. Turn it into a **formation system**: the user reads first, learns how to interpret responsibly, discovers evidenced connections, forms theological judgment, applies the text faithfully, and becomes able to teach it clearly to someone else.
