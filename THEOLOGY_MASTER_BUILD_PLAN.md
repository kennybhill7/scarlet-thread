# Scarlet Thread — Master Theology Product Buildout

**Status:** Proposed implementation blueprint  
**Prepared:** 2026-08-12  
**Repository baseline:** `5bd64ee`  
**Companion documents:** `THEOLOGY_PRODUCT_AUDIT.md` diagnoses the product gaps; `CODEX_AUDIT.md` remains the release-risk ledger; `BUILD_PLAN.md` is Claude's concurrent shorter execution draft. Git history preserves the original foundation plan.

---

## 1. Executive product decision

Scarlet Thread should become a **formation system for everyday believers**:

> Read Scripture closely, understand it in context, trace its place in the whole biblical story, apply it faithfully, and explain it clearly to someone else.

It should not become another devotional feed, a collection of generated answers, a professional seminary platform, or a sermon-writing machine. Its distinctive value is teaching the learner a repeatable method while preserving the learner's own observations.

### Public promise

> Do not just finish a reading plan. Learn to understand the text, see how the whole story connects, live it faithfully, and give it away clearly.

### Product position

Scarlet Thread occupies the space between:

- a daily Bible reader, which provides access but little interpretive formation;
- a curated teaching library, which provides answers but can leave the learner passive;
- professional Bible software, which provides powerful tools but assumes expertise;
- a private journal, which preserves reflection but cannot reliably teach method or correct unsupported leaps.

Scarlet Thread combines text-first study, a whole-Bible connection map, theological clarity, responsible application, and teach-back. It remains usable alone, offline, and without AI.

### North-star outcome

The primary outcome is not reading streak, time in app, number of notes, or lesson completion. It is:

> **Can the learner accurately explain and responsibly apply a studied passage using textual evidence?**

### Recommended theological posture

Before public release, ratify a disclosed theological profile. The recommended default is:

- historic orthodox Christianity rooted in the Apostles' and Nicene creeds;
- a clearly disclosed evangelical Protestant interpretive posture;
- Christ-centered and attentive to the whole canon;
- honest about denominational and interpretive differences;
- core doctrines distinguished from convictions, open questions, and wisdom judgments;
- no claim of being perspective-free or theologically neutral.

This recommendation is a product default, not a decision the software should make silently. Kenneth and the appointed theological reviewers must ratify the actual statement of faith and hermeneutic.

### Teaching influences

Assuming “Philip Anthony” means Philip Anthony Mitchell, translate the named influences into high-level product qualities:

- sustained, text-first exposition;
- a clear gospel center;
- candor about sin, repentance, grace, and discipleship;
- theological depth expressed in plain language;
- connection between Sunday truth and ordinary Tuesday decisions;
- proof of understanding through explanation and faithful practice;
- community and coaching without passive consumption.

Do not copy a living teacher's voice, cadence, phrases, sermon structure, likeness, proprietary content, or branded program.

---

## 2. Non-negotiable product laws

These are acceptance criteria, not slogans.

### Law 1 — Read before guidance

- Scripture must load successfully before the read gate can open.
- Before the learner attempts an observation, hide commentary, curated interpretation, doctrine summaries, connection suggestions, examples, and AI.
- A neutral book/passage orientation may appear before reading, but it must not answer the interpretive question.
- Do not use a forced timer. The learner explicitly marks the reading complete.
- Preserve the learner's first observation even if it is later revised.

### Law 2 — Observations are not summaries

Prompt for words, actions, repetition, contrasts, structure, surprise, tension, and exact verse evidence. The app may coach form, but it must not declare an observation spiritually correct.

### Law 3 — A new thread begins on the third genuine sighting

- Record first and second sightings as provisional `MotifSighting` records.
- Count distinct passages, not raw word frequency or repeated entries from one chapter.
- On the third sighting, ask the learner whether the pattern is becoming a thread.
- The learner names and confirms it. The system never silently creates theology from a repeated token.

### Law 4 — The one rule remains enforceable

Every **finalized passage study** links to at least one established thread; the normalized relationship creates the reverse edge automatically.

This resolves a current design conflict:

- drafts must save without a thread so no writing is lost;
- linking an already-established thread never violates the third-sighting rule;
- a provisional sighting does **not** satisfy the one rule;
- if no honest thread fits, the learner may close the encounter in `needs_connection` without seeing unfinished-work debt;
- on the third distinct sighting, the learner may promote the motif and link the earlier passages;
- only a linked study earns the separate `connected` state.

Closing a study session and completing its connection work are therefore different states. The system preserves an honest orphan for review rather than forcing an artificial connection.

### Law 5 — Never punish a missed day

- No broken-streak copy, red overdue states, catch-up debt, guilt notification, or leader attendance score.
- The return experience always says “Continue where you are.”
- Review is available anytime, even if it retains a suggested Sunday rhythm.
- Progress means cumulative coverage and growing skill, not consecutive days.
- Prayer and conviction are never graded.

### Law 6 — Every claim discloses what kind of claim it is

The UI must visibly distinguish:

- Scripture text;
- learner observation;
- context fact;
- interpretation;
- canonical synthesis;
- theological position;
- tradition-specific view;
- personal application;
- coach feedback;
- assistant suggestion.

This separation prevents an algorithm, editor, teacher, or learner opinion from being presented as the biblical text itself.

### Law 7 — Personal writing is private by default

- No content is shared merely because a learner joins a church, class, or cohort.
- Prayer, conviction, and private questions require explicit artifact-level sharing.
- Editorial roles never grant access to private journals.
- No ads and no sale of journal, prayer, behavioral, or study data.

### Law 8 — Help unlocks only after the matching learner attempt

- Neutral context facts unlock after an observation.
- Curated literary or interpretive conclusions unlock after the learner attempts an interpretation.
- Connection suggestions unlock after the learner attempts to compare passages.
- Application examples or coaching unlock after the learner attempts the meaning-to-practice bridge.
- Teach-back feedback unlocks only after a learner draft.

A first observation is not a universal key that reveals every later answer.

---

## 3. Target users and jobs to be done

### Primary learner

An everyday believer who reads Scripture but wants to move beyond familiarity, isolated verses, inspirational summaries, and inherited conclusions.

**Job:** “Teach me how to understand Scripture for myself without leaving me alone with tools I do not know how to use.”

### Developing teacher or leader

A small-group leader, parent, mentor, or emerging teacher who needs to explain Scripture accurately and apply it responsibly.

**Job:** “Help me turn responsible study into a clear, text-shaped teaching without writing the sermon for me.”

### Invited coach or pastor — later phase

A trusted person who can comment on specific shared claims or teaching artifacts.

**Job:** “Let me ask better questions and correct unsupported leaps without gaining access to the learner's private journal.”

### Content author and reviewer

A qualified writer, biblical scholar, theologian, pastor, safeguarding reviewer, or editor.

**Job:** “Give me a versioned workflow that makes evidence, theological position, review, correction, and licensing visible before publication.”

### Explicit non-users for the initial product

- people seeking accredited seminary coursework;
- churches seeking a management or attendance system;
- professional scholars needing full original-language research software;
- creators seeking one-click sermon generation;
- public social-media audiences.

---

## 4. The complete formation method

The internal learning path is:

> **Read → Observe → Context → Interpret → Connect → Theology → Conviction → Practice → Teach**

The learner-facing passage workspace groups it into seven approachable stages:

| Workspace | Learner question | Required artifact |
|---|---|---|
| **Text** | What is actually here? | Verse-anchored observations and a live question |
| **Context** | What did this communicate there and then? | Context notes and original-audience statement |
| **Connections** | How does Scripture itself develop this? | Typed link with both passages and a rationale |
| **Theology** | What truth about God and his work emerges? | Theological claim, evidence, status, and viewpoint |
| **Conviction** | What corrects, confronts, comforts, or calls me? | Private reflection and prayer |
| **Practice** | What is one warranted response now? | Application bridge, action, and caution |
| **Teach** | Can I explain this accurately? | Teach-back or lesson draft |

### Three study rhythms

Do not overload the original daily practice with a seminary-length workflow.

#### Daily Encounter — 10 or 25 minutes

1. Read with guidance closed.
2. Record three observations, not a summary.
3. Link an established thread; if no honest thread fits, record a provisional sighting and close in `needs_connection`.
4. Write one live question.
5. Record one sentence, pray, and close.

The ten-minute version remains “read and link.” The learner may stop after any saved step. A closed `needs_connection` encounter is not displayed as debt, but its provisional sighting does not count as a completed backlink.

#### Deep Study — 35 to 60 minutes, learner initiated

1. Reopen the untouched first observations.
2. Reveal literary and historical context.
3. Revise or add an interpretation without replacing the original.
4. Compare and classify canonical connections.
5. Form a theological claim and disclose its status.
6. Build one warranted modern application.
7. Optionally begin a teach-back.

#### Sunday Synthesis — 20 to 30 minutes

1. Review what has recurred in the learner's own study.
2. Revisit two or three threads.
3. Refine, answer, or deliberately leave questions open.
4. Defend a prior connection from both passages.
5. Choose one insight worth teaching.
6. Complete a short teach-back, pray, and close.

Use **“What has been recurring in your study”**, not “Where God has been working.” Note frequency does not establish divine agency.

---

## 5. Information architecture

Preserve the discipline of three primary tabs. Context, theology, practice, and teaching are stages inside a passage—not seven competing destinations.

### Host and root-route decision

The authenticated PWA keeps Climb at `/` on `app.<domain>`. Public marketing and the no-save interactive sample live separately at `www.<domain>`. Define canonical URLs, Auth.js callback origins, proxy exceptions, manifest `scope/start_url`, CSP, and offline behavior per host. Do not assign the same root route to both marketing and the private Climb.

| Primary location | Purpose | Main destinations |
|---|---|---|
| **Climb** | Whole-Bible orientation and curriculum | Continue, mountain, stages, guided journeys |
| **Read** | Scripture and active study | Bible browser, search, reader, passage workspace |
| **Review** | Retrieval, synthesis, and teaching | Recurring themes, questions, weak links, teach-back |
| **Profile menu** | Utilities | Library, settings, downloads, privacy, export, account |

### Recommended route map

```text
/
  Climb dashboard
/read
  Bible browser, recent passages, search, downloads
/read/[book]/[chapter]
  Immersive Scripture reader
/study/[sessionId]
  Progressive passage workspace
/stages/[stageSlug]
  Mountain stage, modules, representative passages
/journeys/[journeySlug]
  Guided curriculum journey
/threads/[threadSlug]
  Personal thread and canonical connections
/doctrines/[doctrineSlug]
  Doctrine development, texts, views, implications
/life/[caseSlug]
  Modern Life Lab case
/review
  Anytime/Sunday synthesis
/settings
  Offline, account, privacy, sync, export, licenses
/library
  Journeys, doctrines, sources, glossary, and later Life Labs
/admin/*
  Role-gated authoring and review; later phase
```

### Responsive layout

- **Phone:** one workspace step at a time; sticky step navigator; Scripture can be reopened without losing the draft.
- **Tablet portrait:** Scripture above or beside the active study card.
- **Tablet landscape/desktop:** resizable Scripture, workspace, and optional sources panes.
- Keep Scripture visible while the learner writes a claim whenever space permits.
- Remove the portrait orientation lock.

---

## 6. Screen-by-screen design

### 6.1 Public landing and sample

Purpose: explain the outcome without exposing the private app.

- Product promise.
- A short interactive sample that contains no personal data.
- “See the whole story,” “Learn the method,” and “Explain what you believe.”
- Clear theological-position and privacy links.
- Sign in to save; browsing the public sample does not create a journal.
- No claims of endorsement by named teachers.
- The sample obeys the read/attempt gate: it requires an observation or an explicit “I am not sure yet” attempt before showing category examples or interpretation.

### 6.2 Onboarding

1. Explain the formation promise and privacy model.
2. Disclose the statement of faith, interpretive method, and viewpoint policy.
3. Choose Free Study, Genesis Foundations, or Matthew.
4. Choose default translation and optional Spanish parallel text.
5. Offer an offline starter bundle with exact download size.
6. Teach the five original rules.
7. Complete a five-minute sample passage that distinguishes observation, interpretation, theology, and application.
8. Choose guidance density: Guided, Standard, or Minimal. This is a preference, not a spiritual rank.
9. Offer vault import only after account and data readiness are verified.

Persist the selected journey, current lesson, guidance density, preferred translation, and cumulative progress in `journey_enrollments`. These records have no deadlines or missed-day state.

### 6.3 Climb

The mountain becomes a canonical-story overview rather than eleven decorative anchors.

Each stage contains:

- storyline thesis;
- representative books and passage units;
- covenant development;
- key doctrines and unresolved tensions;
- relationship to Christ and new creation;
- mirror-stage explanation;
- “why this matters now”;
- personal discoveries separated from curated teaching;
- modules and next recommended passage.

Every graphic has an equivalent semantic list/tree. The learner can explore freely without changing progress.

### 6.4 Read home

- Continue last passage.
- Search by reference, word, phrase, question, thread, doctrine, or course.
- Choose Bible book and chapter.
- Recent passages and active studies.
- Downloaded/offline availability by book and course.
- Never show missed-plan debt.

### 6.5 Scripture reader

- Exact verse and passage-range selection.
- English translation switcher and optional mapped Spanish parallel text.
- Contextual title showing the selected literary unit without explaining it prematurely.
- Read gate enabled only after Scripture successfully loads.
- Day/night mode, font controls, audio when trustworthy, and accessible language markup.
- Offline status distinguishes ready, partial, unavailable, and alignment unavailable.
- From a selection: Observe, Ask, Mark sighting, or Start Deep Study.

### 6.6 Passage workspace

The workspace persists as a resumable `StudySession`.

Every session records:

- `mode`: encounter, deep, or guided;
- `workflow_state`: active, closed, or archived;
- `connection_state`: unexamined, provisional, linked, or no-warrant-yet;
- current workspace step and the exact passage range.

An encounter may close after saved observation/question work. A deep session may close at any step. Teach-back is a curriculum-completion requirement only for a completed guided/deep lesson, never for an ordinary daily encounter.

#### Text

- Selected range and surrounding passage.
- Observation prompts for repetition, action, contrast, structure, surprise, and tension.
- Exact evidence references.
- Live question capture.
- Original attempt frozen in history; revision adds a new version.

#### Context

- Genre and how it communicates.
- Literary boundaries and before/after flow.
- Author, audience, occasion, historical-cultural facts, and key terms.
- Sources beside each substantive claim.
- Disputed matters clearly labeled.
- Learner writes the original-audience meaning before seeing curated interpretive conclusions or an exemplar.

#### Connections

- Side-by-side source and destination passages.
- Connection type, rationale, evidence label, and viewpoint.
- Curated and personal edges never visually merge.
- First/second motif sightings can remain provisional.
- Third distinct sighting prompts, but does not force, thread creation.
- Curated suggestions stay hidden until the learner first attempts the comparison or explicitly records “I do not see a connection yet.”

#### Theology

Prompt by categories such as God, creation, humanity, sin, covenant, Christ, Spirit, salvation, church, mission, kingdom, resurrection, judgment, and new creation.

Each claim records:

- what this passage directly reveals;
- what whole-Bible synthesis supports;
- core, conviction, open question, or wisdom-judgment status;
- tradition/viewpoint when relevant;
- evidence and sources;
- what remains uncertain.

Do not force a Christ connection into incidental details. Classify it as direct, explicit quotation, canonical development, typological, thematic, or not explicit.

#### Conviction

Private prompts:

- What corrects or confronts me?
- What comforts or gives hope?
- What exposes a false belief, desire, habit, or fear?
- What calls for trust, repentance, courage, or obedience?
- What question am I carrying?
- How will I pray?

This section is optional, never scored or required for completion, excluded from learning telemetry, and excluded from sharing by default.

#### Practice

Force the interpretive bridge:

1. Original audience and situation.
2. Textual claim.
3. Enduring principle.
4. Covenant continuity or discontinuity.
5. Modern domain and actual situation.
6. One concrete faithful response.
7. Misuse or overreach to avoid.
8. Optional later reflection date with no overdue status.

Classify the application as direct command, enduring wisdom, gospel-shaped practice, prudential inference, or personal conviction.

Also classify the faithful response as belief, repentance, prayer, lament, worship, rest, relationship, service, or concrete action. Do not force every passage into outward productivity.

Classify promises as original individual, Israel/covenant community, fulfilled in Christ, church-wide, eschatological, general wisdom, or not a personal guarantee.

#### Teach

Offer four formats:

- 60-second explanation;
- five-minute table talk;
- fifteen-minute small-group lesson;
- thirty-minute teaching draft.

Required components:

- one-sentence big idea;
- passage-shaped outline;
- context in plain language;
- one supported canonical connection;
- theological truth and its status;
- gospel relationship without forcing it;
- likely objection or difficult question;
- one faithful application;
- what this passage does **not** justify;
- discussion question and prayer.

The system scaffolds; it does not generate the final sermon.

Feedback and exemplars stay hidden until a learner draft exists.

### 6.7 Thread explorer

Tabs: Overview, Sightings, Connections, Teaching summary, Sources.

Show:

- definition and creation rationale;
- distinct-passage sightings in canonical order;
- connection type, rationale, evidence label, viewpoint, and provenance;
- curated connections separate from learner discoveries;
- weak or contradicted links that need reconsideration;
- both sides of each canonical edge;
- teaching summary built from learner-selected reviewed claims.

Evidence levels:

- **Explicit:** the text identifies the relationship.
- **Strong:** distinctive language and context make the relationship persuasive.
- **Plausible:** meaningful and reviewed, but not explicit.
- **Devotional:** personally fruitful resonance, not a claim about authorial intent or doctrine.

### 6.8 Doctrine library

Every doctrine page contains:

- concise definition;
- classification;
- core passages in context;
- development through the canon;
- historical creed/confession references;
- Scarlet Thread's disclosed position;
- named alternatives and their strongest biblical arguments;
- common misunderstandings and historical misuse;
- practical implications;
- citations, authors, reviewers, version, and changelog.

### 6.9 Modern Life Lab

The issue may be the entry point, but it is not allowed to become the source of the answer.

Flow:

1. State the real decision or tension.
2. Read a curated passage set.
3. Establish original meaning.
4. Classify command, promise, wisdom, example, or inference.
5. Account for covenant continuity/discontinuity.
6. Compare faithful options.
7. Choose one response and name a potential misuse.
8. Identify whether pastoral or professional help is needed.

### 6.10 Review

Cards:

- Resume where you stopped.
- What has been recurring in your study.
- Questions still worth carrying.
- Draft writing that needs a connection.
- Connections to defend again from both texts.
- Explain this passage without notes.
- One thing worth teaching.
- Revisit a previous application.

Use “Ready when you are,” never “overdue,” “missed,” or “behind.”

### 6.11 Settings and privacy

- Bible translations and license details.
- Offline Scripture/course bundles with version and size.
- Accurate sync state and conflicts.
- Device list and revoke device.
- Shared-device warning and optional inactivity lock.
- Export all personal writing in human-readable form.
- Clear this device.
- Delete account/data with reauthentication.
- Theological profile, content version, correction log, privacy, and terms.

### 6.12 Editorial system — later

Separate role-gated workspace for authoring, source capture, validation, theological review, pastoral/application review, accessibility/copy review, licensing review, approval, publishing, withdrawal, and correction.

Start with content-as-code. Build this UI only after the schemas and real editorial workflow stabilize.

---

## 7. Lesson anatomy and content standard

Every curated lesson contains the following.

### Metadata

- stable key and immutable version;
- exact passage range and literary unit;
- book, genre, canonical era, and mountain stage;
- prerequisites and learning objectives;
- estimated depth, never an overdue deadline;
- author, reviewers, review date, theological profile;
- sources, citations, and licenses;
- sensitive-topic and disputed-view flags.

### Encounter

- neutral orientation;
- Scripture reading;
- optional audio/translation comparison;
- learner observation and question before interpretive guidance.

### Context

- literary design and before/after structure;
- genre;
- author, audience, occasion, and historical-cultural background;
- key terms only when linguistically responsible;
- disputed facts labeled;
- citations attached to substantive claims.

### Interpretation

The learner writes:

- the passage's main claim;
- evidence from the passage;
- what it meant for the original audience;
- what remains uncertain;
- one interpretation the passage does not support.

### Canonical connections

Each edge requires:

- both passage ranges;
- a typed relationship;
- a rationale that uses both texts;
- an evidence label — explicit | strong | plausible | devotional;
- viewpoint when disputed;
- provenance and reviewer;
- citations where appropriate.

Allowed types:

- direct quotation;
- explicit reference;
- allusion/echo;
- repeated literary pattern or motif;
- promise/fulfillment;
- type/antitype;
- covenant development;
- contrast/reversal;
- parallel;
- doctrinal synthesis;
- personal resonance, which cannot support curated doctrine.

The serialized snake_case values for these types and labels are fixed in `BUILD_PLAN.md` §3.2 and are the single vocabulary for every table, payload, and document; `personal_resonance` requires the `devotional` evidence label by database constraint.

### Theology

- direct textual revelation;
- whole-Bible synthesis;
- implicated doctrines;
- doctrine status;
- major alternatives;
- historical formulation or misuse where important;
- Christ/gospel relationship accurately classified.

### Practice

Every application includes the full meaning-to-practice chain and a misuse warning. Generic inspiration is insufficient.

### Teach-back

Every lesson culminates in explanation, not passive completion.

### Retrieval and transfer

- Immediate: big idea plus supporting verse.
- Two to seven days: explain without notes.
- Module end: defend one connection and one application.
- Transfer: use the method on an unfamiliar passage.
- Course end: a five-minute teaching artifact.

Do not calculate a spiritual-maturity score.

---

## 8. Curriculum buildout

### 8.1 Orientation — five mirror pairs plus the Christ summit

Eleven stages produce five mirror pairs and one unpaired summit, not six pairs. Preserve the current six-week rhythm while teaching careful comparison.

Begin with a short genre-and-connection primer covering literary units, narrative and apocalyptic genre, explicit quotation versus thematic resemblance, evidence labels, and why every proposed mirror relationship is a claim to test rather than an answer supplied by a diagram.

| Week | First passage | Mirror | Skill |
|---|---|---|---|
| 1 | Creation | New creation | Repeated images and canonical conclusion |
| 2 | Sin and serpent | Evil finally defeated | Test promise, conflict, and reversal claims; label Genesis 3:15 viewpoints and evidence |
| 3 | Flood and judgment | Final judgment | Reviewed comparison, discontinuity, mercy, and justice—not an assumed direct prediction |
| 4 | Babel | Babylon | Reviewed comparison of empire, idolatry, scattering, and downfall |
| 5 | Israel | Church | Covenant continuity/discontinuity, Romans 9–11, and explicit safeguards against simplistic replacement claims |
| 6 | Jesus at the summit | Whole climb | Christ as fulfillment and center without forced allegory |

The first side is its own encounter and reflection. The app offers **Ready to compare** only after the learner revisits those observations; it does not enforce a calendar timer or punish an early or late return. Flood/final judgment, Babel/Babylon, and Babel/Acts 2 remain evidence-rated canonical comparisons unless the texts establish a more explicit relationship.

### 8.2 Genesis Foundations — first production course

Use chapter-sized headings as modules and bounded literary units as lessons:

1. Genesis 1:1–2:3 — ordered creation and divine rest.
2. Genesis 2:4–25 — humanity, vocation, place, and relationship.
3. Genesis 3:1–7; 3:8–24 — deception/rebellion, then judgment, contested promise, and exile.
4. Genesis 4:1–16; 4:17–26 — Cain/Abel, then violence, culture, and hope.
5. Genesis 5 — image, genealogy, mortality, and hope.
6. Genesis 6:1–8 — corruption and the difficult “sons of God” question.
7. Genesis 6:9–7:24 — ark, judgment, and de-creation.
8. Genesis 8:1–22 — remembrance, re-creation, worship, and divine resolve.
9. Genesis 9:1–17 — covenant, image, life, and sign.
10. Genesis 9:18–29 — Noah, Canaan, interpretation, and historical misuse.
11. Genesis 10 — nations and the biblical world.
12. Genesis 11:1–9 — Babel, empire, name, and scattering; Acts 2 is a comparison to evaluate, not a presupposed reversal.
13. Genesis 11:10–26 — lineage from Shem to Terah.
14. Genesis 11:27–12:9 — Abraham, promise, blessing, land, and mission.
15. Synthesis — creation, rebellion, judgment, mercy, seed, nations, and blessing.

Two complete golden lessons should be produced before engineering generalizes the system: Genesis 3 and Genesis 11:1–9 are recommended because they exercise observation, disputed interpretation, canonical connections, doctrine, modern application, and misuse safeguards.

### 8.3 Matthew — second production course

#### Pilot wave: Matthew 1–7

1. Matthew 1:1–17 — genealogy, exile, promise, and Messiah.
2. Matthew 1:18–25 — conception, naming, presence, and fulfillment.
3. Matthew 2:1–12 — nations, worship, kingship, and conflict.
4. Matthew 2:13–23 — flight, violence, return, and fulfillment formulas.
5. Matthew 3:1–12 — kingdom announcement, repentance, and coming judgment.
6. Matthew 3:13–17 — baptism, righteousness, Spirit, and beloved Son.
7. Matthew 4:1–11 — testing and Israel echoes.
8. Matthew 4:12–25 — kingdom proclamation, calling, teaching, and healing.
9. Matthew 5:1–16 — kingdom character, blessing, salt, and light.
10. Matthew 5:17–48 — Jesus, Torah, righteousness, reconciliation, fidelity, truth, retaliation, and enemy love.
11. Matthew 6:1–18 — hidden devotion, giving, prayer, and fasting.
12. Matthew 6:19–34 — treasure, allegiance, provision, trust, and anxiety.
13. Matthew 7:1–12 — judgment, discernment, prayer, and the Law/Prophets.
14. Matthew 7:13–29 — ways, fruit, profession, obedience, and foundation.
15. Synthesis — Jesus, kingdom, fulfillment, discipleship, and faithful practice.

#### Expansion wave: full Matthew

Build approximately twenty literary modules rather than twenty-eight isolated chapter lessons. Preserve discourse/narrative structure, fulfillment motifs, conflict, parables, community formation, passion, resurrection, and commission.

### 8.4 Doctrine library sequence

The public library can ultimately contain these twelve doctrines, but the founding pilot should deeply publish only the six most directly exercised by Genesis 1–12 and Matthew 1–7: Scripture/interpretation, creation/providence, humanity/image, sin/evil, covenant/kingdom, and Christ/salvation. The other six begin as clearly labeled introductory overviews and receive full canonical-development treatment only after representative Torah, Prophets, Wisdom, Acts/Epistles, and Revelation content exists.

1. Scripture.
2. Triune God.
3. Creation and providence.
4. Humanity and the image of God.
5. Sin and evil.
6. Covenant.
7. Person and work of Christ.
8. Holy Spirit.
9. Salvation.
10. Church and mission.
11. Christian formation and ethics.
12. Resurrection, judgment, and new creation.

### 8.5 Initial Modern Life Labs

1. Ambition, vocation, and identity.
2. Money, provision, and generosity.
3. Anxiety, trust, and professional care.
4. Conflict, forgiveness, boundaries, and safety.
5. Leadership, power, and service.
6. Technology, attention, formation, and witness.

### 8.6 Whole-mountain expansion

The current eleven anchors become a hierarchy:

```text
Mountain
  Stage
    Module
      Passage unit
        Lesson
```

Recommended stage coverage:

1. Creation and vocation.
2. Rebellion, exile, violence, and death.
3. Judgment, mercy, covenant, and re-creation.
4. Nations, Babel, empire, and scattering.
5. Israel: Abraham, patriarchs, exodus, Sinai, land, kingdom, wisdom, prophets, exile, and return.
6. Jesus: incarnation, kingdom, teaching, signs, cross, resurrection, and ascension.
7. Church: Spirit, witness, Jew/Gentile unity, holiness, suffering, mission, and new humanity.
8. Babylon: idolatrous empire, compromise, witness, and downfall.
9. Judgment and the victory of the Lamb.
10. Evil, death, and the final defeat of the adversary.
11. New creation, presence, healing, vocation, and unending life.

Do not attempt to author the full canon before the Genesis and Matthew pilots prove the method.

---

## 9. Theological and editorial governance

### 9.1 Required charter

Publish these documents before publishing curated lessons:

- Statement of faith.
- Interpretive method.
- Canon and translation policy.
- Core/conviction/open-question/wisdom taxonomy.
- Denominational and multi-tradition viewpoint policy.
- Original-language claims standard.
- Citation and source-quality standard.
- Licensing and permitted-use register.
- Modern-application and sensitive-topic policy.
- AI use and disclosure policy.
- Correction, withdrawal, and changelog policy.

The charter must explicitly identify the actual product canon—currently the 66-book Protestant canon—state that Scripture is the final textual authority while creeds are subordinate historical summaries, and include the Chalcedonian Christological baseline alongside the Apostles' and Nicene creeds unless the reviewers document a different decision.

The original-language standard must prohibit root fallacies, treating a lexicon gloss as contextual meaning, and “the Greek/Hebrew really means” claims unsupported by grammar, syntax, discourse, credible sources, and qualified review. Show transliteration and translation impact only when they materially aid interpretation.

### 9.2 Interpretive method

1. Read a bounded literary unit rather than an isolated verse.
2. Attend to words, grammar, structure, genre, and discourse.
3. Seek the communication to the original audience.
4. Distinguish explicit text from inference.
5. Locate the passage in its book and canonical era.
6. Trace explicit quotations and strong literary relationships first.
7. Account for progressive revelation, covenant development, Christ, and the new covenant.
8. Form doctrine from the whole witness of Scripture, giving clearer texts appropriate weight.
9. Consult the historic church and credible scholarship.
10. State disagreement and uncertainty honestly.
11. Move from meaning to significance and only then to modern application.
12. Read prayerfully and in accountable Christian community.

### 9.3 Doctrine status

- **Core:** central, creedal truths of historic Christianity.
- **Conviction:** important conclusions on which faithful traditions differ.
- **Open question:** an issue the product does not resolve dogmatically.
- **Wisdom judgment:** contextual application rather than settled doctrine.

### 9.4 Review roles

- Lead theological editor.
- Old Testament reviewer.
- New Testament reviewer.
- Pastor/application reviewer.
- Safeguarding reviewer for sensitive content.
- Source, copyright, and copy editor.
- Accessibility reviewer.
- Publisher with final release authority.

One person may hold several roles during the pilot, but no curated theological lesson publishes without independent theological review.

Content policy and CI must enforce that the independent theological reviewer is not the author and the publisher is not the sole theological reviewer. A disputed position should be reviewed by someone demonstrably competent in, or sympathetically representing, that position. If such review is unavailable, disclose that limitation instead of claiming to present the position's strongest case.

### 9.5 Publishing workflow

```text
Draft
  → biblical/theological review
  → pastoral/application and safeguarding review
  → source/license review
  → editorial/accessibility review
  → product QA
  → approved
  → immutable published release
```

Corrections create a new version with a public changelog. Materially harmful or inaccurate releases can be withdrawn immediately. AI cannot approve or publish.

“Withdrawn immediately” means removed from new downloads and marked by a signed correction/revocation manifest on reconnect. A disconnected device cannot be remotely recalled. Harmful bundles are quarantined when the device reconnects; historical releases remain available for study reconstruction unless legal or safety review requires revocation, in which case the export preserves the exact cited blocks and correction notice.

### 9.6 Modern-life safeguards

- Never imply that faith replaces medical or mental-health treatment.
- Never tell an abuse victim that forgiveness requires remaining unsafe.
- Never turn wisdom literature into a financial guarantee.
- Distinguish biblical moral claims from particular political-policy judgments.
- Never claim suffering identifies a person's sin or lack of faith.
- Never present a personal impression as “God told you.”
- Provide crisis, pastoral, and professional-help paths where appropriate.

Every Modern Life Lab records why its passage set was selected, relevant counterbalancing texts, major canonical tension, and familiar prooftexts rejected as out of context. A topical collection is not allowed to reproduce the prooftexting the product exists to correct.

---

## 10. Target technical architecture

Keep a **modular Next.js monolith**. Do not introduce microservices until real scale or organizational boundaries require them.

### Four data planes

```text
Immutable Scripture
  Per-book translation files, verse maps, checksums, search shards
                         ┐
Immutable reviewed content ──→ Passage Workspace / Climb / Review
  Versioned lessons, graph, │
  doctrines, citations      │
                         ┘

Private learner vault
  Account-scoped IndexedDB → outbox → authenticated API → Neon

Auth and operations
  Users, workspaces, devices, memberships, editorial roles, audit log
```

### Architectural separations

- Scripture is immutable public data with an explicit license manifest.
- Published teaching is immutable reviewed content with a release version and checksum.
- Personal study is private mutable data, local-first and workspace scoped.
- AI output is transient or stored as a visibly separate assistant artifact; it never becomes learner-authored or curated content automatically.
- Curated connections and personal connections use different records and visual treatments.

### Canonical reference contract — define before any v2 table

All stored ranges use one canonical, translation-independent versification ID. The initial identifier can be `eng-protestant-66-31102-v1`; SBL display references map through the versioned verse map.

```ts
interface CanonicalRangeV1 {
  versificationId: "eng-protestant-66-31102-v1";
  start: RefKey;
  end: RefKey; // inclusive; same book, cross-chapter allowed
}

interface DisplayReferenceV1 {
  canonicalRange: CanonicalRangeV1;
  translationId: VersionId;
  corpusReleaseId: string;
  mappedStart: RefKey;
  mappedEnd: RefKey;
}
```

Validate canonical order, real book/chapter/verse bounds, and mapped ranges. Every quoted evidence record stores translation and corpus release so a later text or verse-map update cannot silently change what the learner saw.

---

## 11. Repository target structure

Use versioned additions so the existing reader/journal remains operational during migration.

```text
content/
  profiles/                 theological profile and hermeneutic
  curricula/
    genesis-foundations/
    matthew/
  doctrines/
  life-labs/
  sources/
  schemas/
  fixtures/                 human-reviewed golden lessons

web/lib/contracts/
  study-v2.ts               additive contracts; imports RefKey/Entry/Thread
  content-v1.ts
  graph-v1.ts

web/lib/learning/           study sessions, claims, application, teach-back
web/lib/content/            bundle loader, manifest verification, citations
web/lib/graph/              graph queries and personal overlay
web/lib/search/             Scripture/content/personal search adapters
web/lib/coach/              optional cited coach; later phase

web/db/schema/
  auth.ts
  tenancy.ts
  learner.ts
  content.ts
  graph.ts
  sync.ts
  index.ts

web/app/(app)/study/[sessionId]/
web/app/(app)/stages/[stageSlug]/
web/app/(app)/journeys/[journeySlug]/
web/app/(app)/doctrines/[doctrineSlug]/
web/app/(app)/life/[caseSlug]/
web/app/api/v2/
web/app/admin/               later, role gated

web/scripts/content/
  validate.ts
  build.ts
  publish.ts
  verify-release.ts

web/.generated/content/      local/CI staging, not the permanent archive
```

Do not edit or remove v1 fields in `web/lib/contracts.ts`. Add v2 contracts and coordinate any semantic change across both existing ownership tracks.

`content/` is the only authoring source. Its compiler creates immutable bundles in durable append-only object/CDN storage and optional read-only Postgres search/query indexes. The app, offline downloader, and APIs all consume the same signed catalog release. Historical bundles must not depend on remaining inside a particular Vercel deployment.

---

## 12. Domain and database design

### 12.1 Tenancy and permissions

The current single-email allowlist and `user_id`-only model are not sufficient for a world-facing product.

#### `workspaces`

`id`, `kind(personal)`, `name`, `created_by`, `created_at`, `deleted_at`.

Every user receives exactly one personal workspace.

#### `workspace_memberships`

`workspace_id`, `user_id`, `role(owner)`, `status`, `created_at` for the initial product.

Cohort/church workspaces, mentor roles, and sharing are deferred until invite-only coaching is authorized. Future cohorts store enrollment and consented aggregate progress; they never own learner journals. Sharing will use an enforceable `shareable_artifacts` registry plus concrete foreign keys—not an unchecked polymorphic type/ID pair—and it will never grant a cohort owner implicit access.

#### `editorial_roles`

`user_id`, `role(author|theology_reviewer|pastoral_reviewer|publisher|admin)`.

Editorial authority never implies access to private study artifacts.

All learner-owned roots, children, joins, revisions, receipts, and private search rows receive `workspace_id`; this includes `claim_evidence`, `teaching_sections`, `learning_attempts`, motif/thread joins, `entry_threads`, artifact revisions, and sync receipts. Enforce composite tenant foreign keys plus PostgreSQL row-level security. Every repository still includes explicit workspace predicates; RLS is defense in depth, not a replacement for application authorization.

Every private route is nested under `/api/v2/workspaces/[workspaceId]/...`. The server resolves the route value against the authenticated user's active membership and ignores any spoofable workspace ID inside payload data. Bootstrap returns the selected personal workspace explicitly.

With Neon/serverless pooling, each private operation runs inside a transaction that uses transaction-local `set_config('app.user_id', ..., true)` and `set_config('app.workspace_id', ..., true)`. Never use session-level `SET` on pooled connections. Apply RLS to every private read, search, sync, export, share, background job, and mutation; Auth.js adapter tables use a separately defined access pattern. Missing or malformed context fails closed and is tested.

### 12.2 Existing journal model

Keep `Entry`, `Thread`, `Person`, `DailyLog`, and `ReadingProgress` for fast backward-compatible journal capture. New structured workspace observations are canonical `StudyClaim` records. `legacy_entry_id` is a unique optional bridge used only for import or explicit “promote to study” actions; there is no routine dual-write. Export and search union and deduplicate both models.

Add normalized motif candidates and sightings so observations one and two can exist before a thread is created.

### 12.3 Learner formation records

#### `study_sessions`

`id`, `workspace_id`, `created_by`, `mode(encounter|deep|guided)`, `workflow_state(active|closed|archived)`, `connection_state(unexamined|provisional|linked|no_warrant_yet)`, optional `passage_unit_id`, canonical range, optional `catalog_release_id`, `read_gate_at`, `current_step`, `revision`, timestamps.

Free study may have no passage unit or content release. When a unit is attached, database constraints require it to belong to the pinned catalog release. The exact canonical range remains on the session even if a curriculum is upgraded or withdrawn.

#### `study_claims`

`id`, `workspace_id`, `session_id`, unique optional `legacy_entry_id`, `claim_kind(observation|question|context|interpretation|theology|application|conviction|teaching_seed)`, `epistemic_basis(text_explicit|historical_context|inference|canonical_synthesis|tradition|prudential_judgment|personal_reflection)`, `body`, `confidence(tentative|developing|well_supported)`, optional `viewpoint_id`, `doctrine_status(core|conviction|open|disputed|wisdom)`, `provenance(learner|imported)`, `status(draft|revisited|confirmed|needs_revision)`, `revision`, timestamps, `deleted_at`.

Curated claims live in published content blocks, coach responses in `coach_feedback`, and saved assistant suggestions in `assistant_artifacts` with source response IDs. They never masquerade as learner claims.

#### `claim_evidence`

`id`, `workspace_id`, `claim_id`, `evidence_type(passage|context|connection|source)`, canonical/display reference, `content_block_id`, `citation_id`, `note`.

#### `motif_candidates` and `motif_sightings`

Candidates store `id`, `workspace_id`, learner label, normalized key, and status. Sightings reference the candidate, canonical passage-unit key, exact range, optional entry/claim, and status. Enforce one counting sighting per motif and distinct passage unit. Promotion creates the thread and links earlier sightings transactionally; dismissal never deletes the underlying observation.

#### `user_connections`

`id`, `workspace_id`, `created_by`, source range, destination range, `edge_type`, `rationale`, `evidence_label(explicit|strong|plausible|devotional)`, `thread_slug`, `status(draft|confirmed|revisit)`, `revision`, timestamps.

#### `applications`

`id`, `workspace_id`, `session_id`, `source_claim_id`, `original_audience_meaning`, `enduring_principle`, `canonical_bridge`, `application_class`, `promise_scope`, `modern_domain`, `situation`, `response_type`, `faithful_response`, `cautions`, optional `available_after`, `status`, `revision`, timestamps.

Draft applications save partially. Completeness is required only for the explicit finalize transition.

#### `teaching_drafts`

`id`, `workspace_id`, `session_id`, `title`, `big_idea`, `audience`, `duration_minutes`, `gospel_connection`, `status`, `revision`, timestamps.

#### `teaching_sections`

`id`, `workspace_id`, `draft_id`, `kind(outline|context|connection|theology|illustration|objection|application|not_justified|discussion|prayer)`, `sort_order`, `body`.

#### `review_items` and `learning_attempts`

Review items support explain, compare, defend-connection, name-misuse, and objection prompts. Attempts preserve the learner's response, self-rating, rubric feedback, and source of feedback. Use `available_after` or a suggested revisit window, never due dates, backlog totals, or late/overdue state.

#### `journey_enrollments`

`id`, `workspace_id`, `journey_release_id`, `guidance_density`, `current_lesson_key`, cumulative completed lesson keys, timestamps. No deadline or missed-day field.

### 12.4 Curated content records

These records are compiler-produced, read-only release indexes for query/search. Authors edit only the schema-validated files under `content/`; nobody independently edits an equivalent Postgres copy.

#### `theological_profiles`

Versioned statement of faith, hermeneutic, denominational notes, status, authors, reviewers.

#### `content_collections` and `content_releases`

Collections represent curricula, book courses, doctrine libraries, graph sets, or life labs. Each release has semantic version, status, theological profile, immutable manifest URL/hash, predecessor, and publication date, with unique `(collection_id, semver)`.

#### `catalog_releases`

An immutable release-set manifest pins the exact Genesis, Matthew, doctrine, graph, source, and search collection versions that work together. Study sessions pin a catalog release, not an ambiguous global semver. Correction/revocation state lives in a separate signed catalog record so the released artifacts remain immutable.

#### `passage_units`

Stable key, release, title, start/end references, genre, unit type, canonical/mountain location, and order.

#### `content_nodes` and `content_blocks`

Nodes represent lessons, context, doctrine, case studies, or teaching help. Ordered blocks carry a claim class: text, context fact, inference, tradition, application, warning, prompt, or viewpoint.

#### `sources` and `citations`

Source type, author, title, publisher, edition, year, URL, license, access date; citation locator, passage range, and note. Published releases snapshot or version their bibliography so editing a global source cannot alter historical content.

#### `viewpoints`

Stable key, tradition, summary, competent reviewers, disclosure state, and source set. Content and graph records reference a defined viewpoint rather than an uncontrolled tag.

#### `content_reviews`

Concrete node/release foreign key, reviewer, discipline, decision, notes, timestamp. Avoid unenforceable polymorphic review targets. Publication policy enforces author/reviewer independence and discipline-specific approvals.

### 12.5 Typed canonical graph

#### `graph_nodes`

Passage, doctrine, theme, person, place, covenant, or mountain stage.

#### `graph_edges`

Source, destination, type, direction, rationale block, evidence label, viewpoint, release, and review status.

#### `graph_edge_evidence`

Passage range, citation, evidence role, and counterpoint.

Personal overlays remain in `user_connections`; never store them as reviewed graph edges.

---

## 13. Backward-compatible migration plan

1. **Preserve v1 compatibility.** Keep existing `/api/*` and `lib/contracts.ts` operational except for the explicitly staged thread-invariant correction below.
2. **Add v2 contracts.** Introduce additive `study-v2`, content, graph, and sync contracts.
3. **Create workspaces.** Add nullable `workspace_id`, create one personal workspace per current user, and backfill all private rows.
4. **Bridge without dual-writing.** Existing repositories derive the personal workspace. New structured work writes `StudyClaim`; a unique optional legacy link preserves imported/promoted entries.
5. **Enforce tenancy.** Make workspace fields non-null, add composite foreign keys and RLS, then run hostile two-user tests.
6. **Add formation/content/graph tables.** No destructive rewrite of current journal bodies.
7. **Backfill claims.** Observation → observation, question → question, teaching → teaching seed. Free notes remain journal notes unless the learner promotes them.
8. **Correct the thread invariant as a coordinated migration.** Change `syncEntrySchema`, entry create/update/sync validation, thread-existence checks, and migration `0003` deferred triggers so drafts can exist unlinked. Move the enforced rule to the study-session transition into `linked`; preserve automatic backlinks whenever a link exists. Provide a rollback and import test before accepting unthreaded records.
9. **Namespace IndexedDB.** Migrate from the current single `bible-brain` store to account/workspace-specific storage; verify record counts and hashes before marking migration complete.
10. **Keep recovery.** Do not delete v1 local stores until server acknowledgement and a verified export exist.
11. **Capability bootstrap.** Advertise API version, IDB schema version, minimum supported client, active catalog release set, per-workspace sync cursor, and setup readiness.
12. **Retire v1 only after evidence.** Telemetry, migration counts, rollback tests, and an announced compatibility window must all pass.

---

## 14. Sync v2

The current client-clock last-write-wins model is adequate for a small single-user prototype but can silently overwrite long-form work in a multi-device public product.

### Server records

- `devices`: user-scoped device identity, label, last seen, revoked.
- `device_workspace_state`: device, workspace, last cursor, snapshot state.
- `sync_change_log`: monotonic cursor, workspace, entity, entity ID, operation, revision, timestamp.
- `sync_op_receipts`: workspace, device, operation ID, result, acceptance timestamp.
- `artifact_revisions`: immutable prior versions for prose conflicts and recovery.
- tombstones for deletions.

### Protocol

Push:

```json
{
  "opId": "uuid",
  "deviceId": "uuid",
  "entity": "study_claim",
  "entityId": "uuid",
  "mutation": "upsert",
  "baseRevision": 4,
  "mutationGroupId": "uuid",
  "dependsOn": [],
  "payload": {},
  "clientTime": "ISO-8601"
}
```

The server responds accepted, rejected, or conflict, including the authoritative revision. Pull uses an opaque monotonic cursor and pagination.

Initial sync is a paginated snapshot taken against a transactional high-watermark, followed by changes after that watermark. If a cursor expires because the log was compacted, the server returns `resetRequired` and a new snapshot token. Define retention, maximum batch/log sizes, conflict-payload limits, create `baseRevision` semantics, delete conflicts, and rejected-receipt replay.

Related offline creations—session, claim, evidence, motif, and connection—use a bounded atomic `mutationGroupId`, or explicit `dependsOn` ordering when atomicity is not possible. An accepted mutation atomically writes the entity/revision, prior artifact revision, tombstone where relevant, change-log entry, and idempotency receipt.

### Merge rules

- Long prose: optimistic revision; preserve both versions on conflict.
- Reading progress: monotonic union/max.
- Connections and thread links: explicit add/remove set operations.
- Deletes: tombstones.
- Duplicate retry: idempotent receipt.
- Clock skew: never used as the authoritative database cursor.

### Local transaction rule

Every learner action writes the local entity and its outbox operation in the same IndexedDB transaction. UI states distinguish:

- saved locally;
- waiting to sync;
- synced;
- conflicted;
- rejected with a reason.

No state is silently swallowed.

### One mutation path

`POST /api/v2/workspaces/[workspaceId]/sync/push` is the sole browser write path for offline-capable learner entities. The browser must not both enqueue an operation and call an independent REST mutation. Resource routes are reads; the conflict-resolution endpoint invokes the same authoritative revision/idempotency/change-log transaction used by sync.

---

## 15. API design

Every private operation—not only mutations—requires Auth.js session, validated route workspace, active membership, transaction-local RLS context, Zod validation, request/body limits, private/no-store response, rate limiting where appropriate, and a request ID. Sync mutations additionally require idempotency.

### Bootstrap and sync

- `GET /api/v2/bootstrap`
- `POST /api/v2/workspaces/[workspaceId]/sync/push`
- `GET /api/v2/workspaces/[workspaceId]/sync/pull?cursor=&limit=`
- `GET /api/v2/workspaces/[workspaceId]/sync/conflicts`
- `POST /api/v2/workspaces/[workspaceId]/sync/conflicts/[id]/resolve`

### Study

- `GET /api/v2/workspaces/[workspaceId]/study-sessions`
- `GET /api/v2/workspaces/[workspaceId]/study-sessions/[id]`
- `GET /api/v2/workspaces/[workspaceId]/study-sessions/[id]/claims`
- `GET /api/v2/workspaces/[workspaceId]/claims/[id]/evidence`
- `GET /api/v2/workspaces/[workspaceId]/motif-sightings`
- `GET /api/v2/workspaces/[workspaceId]/connections`
- `GET /api/v2/workspaces/[workspaceId]/applications`
- `GET /api/v2/workspaces/[workspaceId]/teaching-drafts`

Browser creation/edit/deletion for these resources goes through sync. A future server-only editorial or import path must call the same domain transaction, not write tables directly.

### Reviewed content

- `GET /api/v2/passages/context?start=&end=&versification=&catalogRelease=`
- `GET /api/v2/graph/neighbors?start=&end=&versification=&types=&catalogRelease=`
- `GET /api/v2/doctrines/[slug]`
- `GET /api/v2/journeys`
- `GET /api/v2/journeys/[slug]/lessons/[lesson]`
- `GET /api/v2/content/catalog/current`

### Search and account

- `GET /api/v2/workspaces/[workspaceId]/search?q=&scope=&translation=&catalogRelease=&cursor=` for private or blended search
- `GET /api/v2/workspaces/[workspaceId]/export`
- `POST /api/v2/account/delete` with reauthentication.

### Editorial — later

- draft, submit, review, approve, publish, withdraw, and correction routes under `/api/v2/editor/*`.
- Editorial RBAC and immutable audit events are mandatory.

### Error contract

Return stable code, human-safe message, field issues when relevant, retryability, and request ID. Never expose database, OAuth, secret, source path, or personal-record details.

Published Scripture/content endpoints may be intentionally public, immutable, and cacheable. Private study, blended search, sync, export, account, and personalized document/RSC responses remain authenticated and `private, no-store`. The policies must be tested separately rather than applied as one blanket rule.

---

## 16. Search and connection discovery

### Online search

Start with PostgreSQL full-text search, not embeddings.

Index visibly separate document classes:

- Scripture;
- reviewed teaching;
- doctrine/source records;
- personal observations/questions/threads;
- teaching drafts.

Persist `search_documents(id, workspace_id nullable, visibility, entity_type, entity_id, catalog_release_id, translation_id, canonical_range, title, body, language_config, tsvector)` with GIN indexes, lifecycle jobs/triggers, and RLS. Rank exact reference, title, phrase, lexical match, then personal recency. Use appropriate English/Spanish configuration and index only licensed corpora.

### Offline search

- Compressed Scripture token shards per permitted translation/book.
- Reviewed-content search shards per immutable release.
- Incremental personal index in account-scoped IndexedDB.
- Query in a Web Worker so the reader remains responsive.
- Merge unsynced local results with server results and deduplicate by stable identity so newly written offline work remains searchable.

### Radar

The deterministic radar remains a **prompt generator** only.

- Count across distinct passage units.
- Improve normalization, lemmas, and phrase handling only after test fixtures exist.
- Exclude stop words and known thread concepts.
- Label output “possible recurring language.”
- Require the learner to compare passages and confirm meaning.
- Never call a lexical match a canonical connection or theological conclusion.

Embeddings may later retrieve candidates, but similarity is never evidence.

---

## 17. Offline and PWA design

### Cache policy

Stop runtime-caching arbitrary authenticated document or RSC responses.

Cache only:

- an explicitly public offline application shell;
- hashed JavaScript, CSS, fonts, icons, and static assets;
- selected immutable Scripture books;
- revisioned verse map;
- selected immutable curriculum/doctrine/search bundles.

Keep session, API, personalized HTML/RSC, and export responses network-only. Purge private caches and close the account-scoped local database on sign-out.

### Offline bundle manifest

Every bundle states:

- release and schema version;
- required Scripture books/translations;
- verse-map version;
- lesson/context/graph/doctrine/search files;
- source metadata and licenses;
- byte size and SHA-256 for every artifact.

Download to a staging cache, verify all files, and atomically activate the release. If verification fails, retain the last known-good release.

### Offline readiness states

- Ready offline.
- Partially downloaded.
- Download interrupted; retry available.
- Update available.
- Alignment unavailable; parallel rendering stopped.
- Content version incompatible; prior release retained.

A cached Bible book must allow navigation to its unvisited chapters through a generic cached client shell.

Prototype that shell before the rest of the workspace. Next App Router dynamic/RSC navigation does not become offline-safe merely because the book JSON is cached. Define a static fallback/start route that restores navigation and hydrates the selected passage from local data.

### Trusted-device offline identity

- Offline vault access is opt-in through **Enable offline on this trusted device** after an online authentication.
- Bind the local vault to the authenticated user ID, device ID, and personal workspace; show the identity before unlock.
- A previously enabled device may reopen its local vault offline under the declared local-lock policy.
- Account switching is blocked offline.
- Online sign-out purges local private data and caches after a verified export warning.
- Remote revocation prevents future authentication/sync but cannot erase a device that remains disconnected; state this plainly.
- Define inactivity lock, failed-unlock handling, recovery, and optional WebAuthn/user-secret encryption before world beta. Never imply that an unencrypted trusted-device database is protected from someone who controls the device.

Each study pins a catalog release that remains downloadable, or its export embeds the exact referenced content blocks, citations, translation/corpus version, and correction notices. Cache eviction or later withdrawal must not make an old study unintelligible.

---

## 18. Optional cited study coach — final product phase

The app must be complete and valuable without AI.

### Allowed modes

- Socratic questioning.
- Compare two interpretations.
- Check whether a proposed connection is warranted.
- Check the meaning-to-application bridge.
- Ask a harder teach-back question.
- Help simplify the learner's own explanation.

### Attempt gate

Assistance uses stage-specific gates: context facts after observation; interpretation help after an interpretation attempt; connection help after a comparison attempt; application help after a meaning-to-practice attempt; teach-back feedback after a learner draft.

### Retrieval boundary

Use only:

- the exact selected Scripture;
- the active published content release;
- explicitly opted-in learner artifacts for that request.

Private notes are excluded by default. Any provider must be covered by approved contractual/API data controls, retention/deletion settings, region and DPA decisions, and an explicit prohibition on training where the provider offers it. Scarlet Thread cannot promise provider behavior that it has not contractually and technically verified.

### Structured response

Every response separates questions, claims, epistemic labels, citations, uncertainties, and viewpoints. A deterministic verifier rejects citations not in the retrieval set and checks direct Scripture quotations against the exact translation/corpus release and verse map. It fails closed when exact mapping is unavailable.

### Prohibitions

The coach may not:

- interpret before the learner attempts;
- impersonate Mitchell, Daniels, or any living teacher;
- invent Hebrew/Greek claims;
- generate personalized divine messages;
- auto-close questions;
- declare a personal connection canonical;
- publish curriculum;
- write a final sermon for the learner;
- replace pastoral, medical, mental-health, legal, financial, abuse, or crisis care.

When reviewed evidence is insufficient, it must say so and abstain.

---

## 19. Security, privacy, and trust

### Before public beta

- Real Neon migration and Google OAuth verification for the controlled alpha.
- A controlled invite/allowlist table or test-only multi-user mode so Gate 0 can test two accounts without opening unrestricted signup.
- Before public beta, approved identity methods beyond the current single-email allowlist; recommended minimum is Google plus passwordless verified email, with account linking/recovery, session/device binding, abuse protection, and a counsel-reviewed age/geographic policy.
- Multi-user authorization and RLS isolation tests.
- Account/workspace-namespaced IndexedDB.
- Authenticated HTML/RSC and Cache API purge on sign-out.
- Sign-out, device revocation, clear-local-data, export, and deletion.
- CSP, frame restrictions, `nosniff`, referrer policy, and permissions policy.
- Markdown sanitization and URL allowlists.
- Secret and dependency scanning.
- Rate limits and abuse controls.
- Backup, restore, deletion, and incident-response drills.
- Privacy policy, terms, theological disclosure, and correction policy.

Account deletion requires reauthentication, an explained grace period, tombstone propagation to every reconnecting device, object/export deletion where applicable, backup-retention disclosure, and a deletion receipt. Do not promise immediate erasure from immutable backups; state the retention window and restore safeguards.

### Sensitive-data principle

Journal bodies, prayers, questions, conviction notes, coach conversations, and exports never enter analytics, ordinary logs, error traces, or support screenshots.

MVP local storage should clearly state “trusted personal device.” Later, optional local-vault encryption may use a user-controlled secret or WebAuthn; never use a hardcoded application key.

---

## 20. Accessibility and inclusive design

Release gate: WCAG 2.2 AA.

- Minimum 4.5:1 contrast for normal text.
- Minimum 44 by 44 CSS-pixel interactive targets.
- Keyboard-complete flows and visible focus.
- Correct headings, landmarks, labels, error summaries, and live regions.
- No meaning conveyed only by color or graph geometry.
- Reduced-motion support.
- Semantic list/tree alternative for mountain and connection maps.
- Correct language attributes for Spanish.
- Pronunciation controls labeled and operable without hover.
- Phone, tablet landscape, desktop, zoom, and text-enlargement testing.
- No portrait lock.
- Avoid cognitively overwhelming multi-pane layouts on small screens.

---

## 21. Observability and analytics

### Operational telemetry

Capture request ID, release version, route, outcome, latency, and—only where necessary—a rotating keyed-HMAC user/workspace identifier with documented retention and access policy. Pseudonymous identifiers remain personal data. Never capture personal bodies, prayers, prompts, tokens, OAuth data, or export archives.

Monitor:

- authentication and authorization failures;
- application authorization failures and scheduled hostile-tenant probes; do not assume an RLS zero-row result is observable as a denial;
- pending sync age, rejections, and conflicts;
- IndexedDB migration mismatch;
- cache and checksum failure;
- offline open/save success;
- search latency and zero-result rate;
- content release adoption and rollback;
- correction requests and response time;
- AI citation-verifier rejection, if AI exists.

Add liveness and readiness endpoints that test environment, database/migration, and active content-manifest availability without leaking configuration.

### Learning measures

Learning research is opt-in for the founding cohort. Maintain an analytics data dictionary, consent record, retention period, opt-out, deletion propagation, and review approval. Default telemetry may collect only product reliability and consented structural aggregates; journal or teach-back bodies remain private unless a learner separately volunteers a research artifact.

- Claims supported by exact passage evidence.
- Connections with type, rationale, and both passages.
- Applications with original meaning, warrant, response, and caution.
- Seven- and thirty-day explanation recall.
- Performance on an unfamiliar passage.
- Teach-back rubric improvement.
- Ability to name a legitimate alternative view.
- Ability to state what a passage does not justify.
- Successful return after a long absence.

Never optimize streaks, daily notifications, minutes watched, note count, emotional intensity, completion speed, or leaderboards.

---

## 22. Teach-back rubric

Use the 0-to-3 rubric for private self-review or explicitly requested qualified human coaching. Automated checks report only missing structure, absent evidence, broken references, or unsupported formatting; they do not issue a theological score or learner judgment.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Textual fidelity | Contradicts/ignores text | General assertion | Supported by text | Precise and handles tension |
| Context | Missing | Names a fact | Explains relevance | Uses context without overclaiming |
| Interpretation | Opinion only | Claim without evidence | Claim plus evidence | Evidence, limits, alternatives |
| Canonical connection | None/forced | Similar topic | Typed and supported | Explains development across both texts |
| Theology | Unsupported | Vague doctrine | Whole-Bible support | Status and disagreement are clear |
| Application | Prooftext/unsafe | Generic | Meaning-to-practice chain | Concrete, qualified, pastorally wise |
| Explanation | Unclear | Repeats notes | Understandable | Clear to a new learner and handles objection |
| Humility | Absolute overclaim | Little qualification | Names limits | Names limits and what text does not justify |

In the solo MVP, states are **Draft complete**, **Rehearsed**, and **Self-reviewed**. Reserve **Human-reviewed teaching artifact** for a later qualified review with competent performance in every dimension and no safety red flag. It is not a certification or spiritual-maturity badge.

---

## 23. Test and evaluation strategy

### Unit tests

- Reference/range parsing and validation.
- Claim types and epistemic labels.
- Stage-specific guidance/attempt gates and mode-specific completion states.
- Connection types, evidence labels, and direction.
- Third-distinct-passage sighting rule.
- Application and promise classifications.
- Search ranking and scope separation.
- Sync merge rules and conflict creation.
- Citation verifier and Scripture quotation matching.
- Copy lint for prohibited guilt/divine-activity language.

### Database integration tests

- Every released migration from a clean and prior database.
- Composite tenancy and row-level security.
- Two hostile users across every query, mutation, export, search, share, and sync path.
- Idempotency, revisions, conflicts, tombstones, and restore.
- Editorial roles cannot read learner artifacts.
- Missing/malformed transaction-local RLS context fails closed.
- Author cannot provide the independent theological approval for the same release.

### Sync property/state-machine tests

- Two devices and account switching.
- Clock skew, duplicate, retry, out-of-order, and interrupted batches.
- Concurrent prose edits preserve both versions.
- Offline add/remove connection operations.
- Interrupted IndexedDB migration.
- Revoked device and sign-out purge.
- Atomic mutation groups and out-of-order dependency replay.
- Snapshot high-watermark, cursor expiration, compaction reset, and resnapshot.

### Content CI

- Every reference exists in the approved canon.
- Versification maps validate.
- Every graph edge has source, destination, type, rationale, and evidence.
- Required citations and licenses exist.
- No draft/unpublished block enters a release.
- Stable keys are unique.
- Bundle hashes and manifests are deterministic.
- Sensitive content received the required review.
- Signed correction/revocation manifests quarantine withdrawn content after reconnect while preserving lawful study reconstruction.

### Browser/end-to-end tests

- Complete Read → Observe → Context → Connect → Theology → Practice → Teach online and offline.
- Scripture failure cannot unlock writing.
- Save, resume, reload, sync, conflict, and rejection.
- Unvisited downloaded chapter works offline.
- Divergent Spanish mapping fails closed when map missing.
- Account switch and sign-out show no prior-user data.
- Content update, checksum failure, and rollback.
- Export/delete and restore window.
- Keyboard, screen reader, zoom, reduced motion, and touch targets.

### Golden curriculum review

Genesis 3 and Genesis 11:1–9 become human-reviewed fixtures scored for textual fidelity, context, canonical warrant, doctrinal transparency, application warrant, pastoral safety, source quality, and clarity.

Software enforces evidence shape and workflow. It cannot certify theological truth.

### AI evaluation — only if built

- Citation precision and coverage.
- Exact Scripture quotation.
- Viewpoint disclosure.
- Abstention on unsupported claims.
- Prompt injection through notes/content.
- False original-language claim resistance.
- No teacher persona imitation.
- Prooftexting, prosperity, political certainty, abuse, and mental-health red teams.

---

## 24. Delivery roadmap

Estimates are planning ranges for two experienced software builders working in parallel with a separate content/review track. They are not calendar commitments. Content review, licensing, and owner decisions can become the critical path.

### Gate 0 — Trustworthy current foundation

**Estimated engineering effort:** 2–4 weeks.

#### Work

- Configure real Neon and Google OAuth.
- Add a controlled invitation table or test-only multi-user auth mode and prove isolation on the existing model; the current single-email allowlist cannot exercise a two-user test.
- Remove private seed data from build-time runtime architecture and migrate it safely.
- Render explicit setup-incomplete state.
- Repair importer fidelity and one-rule exceptions.
- Implement exact verse selection through capture, sync, import, and export.
- Fix offline unvisited-route navigation, cache invalidation, false-positive readiness, and service-worker lifetime behavior.
- Prototype and verify the static offline fallback shell for App Router navigation.
- Make corpus builders non-destructive and fail closed on omissions.
- Fail closed on verse-map/alignment failure and fix ordering gaps.
- Integrate sign-out, clear-device, export, and automatic sync controls.
- Add security headers and close accessibility contrast/graph/orientation issues.
- Resolve current high dependency findings.
- Settle translation rights, including KJV worldwide distribution.
- Update `CODEX_AUDIT.md` against current code.

#### Exit gate

- Authenticated live app works for at least two test users with no tenant bleed.
- Private content is dynamic and user scoped.
- No private vault data enters source, build output, logs, or public cache.
- Exact references survive round-trip.
- Phone/tablet offline daily-loop soak passes.
- No open critical or high security, privacy, Scripture-correctness, or data-loss finding.

### Phase 1 — Platform v2 and evidence foundation

**Estimated engineering effort:** 4–7 weeks.

#### Work

- Write and independently review the complete Genesis 3 and Genesis 11 lesson specifications before freezing generalized schemas.
- Define the versification-aware canonical range contract.
- Add personal workspaces, transaction-local RLS, devices, and account-scoped IndexedDB; defer cohort/sharing authorization.
- Add v2 contracts, capability bootstrap, snapshot/revision/cursor sync, atomic mutation groups, conflicts, compaction reset, and recovery.
- Add passage ranges, literary units, session modes/states, and journey enrollment.
- Study sessions, claims, evidence, motif sightings, and personal connections.
- Source/citation primitives.
- Scripture and personal search.
- Build the authoritative content-as-code compiler, independent review rules, catalog release set, durable immutable publishing, download, checksum, correction/revocation, rollback, and old-study reconstruction path.
- Convert the two approved golden specifications into validation fixtures.

#### Exit gate

- v1 data migrates without body loss and remains exportable.
- Two devices can edit offline without silent prose overwrite.
- Text, inference, tradition, application, and provenance render distinctly.
- First/second sightings save without prematurely creating a thread.
- Two-user/RLS and interrupted-migration tests pass.
- A signed catalog release can publish, download, verify, roll back, and reconstruct an old study without relying on a historical Vercel deployment.

### Phase 2 — Learning-method MVP

**Estimated engineering effort:** 4–6 weeks.

#### Work

- Progressive Passage Workspace.
- Context cards and source drawer.
- Typed side-by-side connection builder.
- Theology claim builder.
- Private conviction/prayer surface.
- Application bridge and misuse warning.
- Five-minute teach-back.
- Revised thread explorer and anytime review.
- Five mirror pairs plus the unpaired Christ-summit orientation and its genre/connection primer.
- Two fully reviewed Genesis lessons.
- Complete the already-proven offline curriculum bundle path in the learner UI.

#### Exit gate

- A learner completes the entire method without AI online and offline.
- Curated claims cannot publish without evidence/citations.
- Finalized studies enforce the one rule without violating third sighting.
- A learner can export and later reconstruct every artifact and its provenance.
- Browser and accessibility tests pass on phone, tablet, and desktop.

### Phase 3 — Reviewed pilot curriculum

**Estimated software effort:** 3–5 weeks.  
**Estimated content/review effort:** 8–14 weeks in parallel.

#### Work

- Complete Genesis 1–12.
- Complete Matthew 1–7.
- Publish six full doctrine pages directly exercised by the pilot and six clearly labeled, independently reviewed introductory overviews; defer full canonical development of the latter six.
- Add retrieval and unfamiliar-passage transfer.
- Search reviewed content, doctrine, sources, and graph.
- Expand all eleven mountain stages to honest module outlines.
- Pilot analytics and correction workflow.
- Run owner/private alpha, then an advisory alpha with 10–20 pastors, theology-trained reviewers, and ordinary learners.
- Run a free eight-week founding cohort of 50–100 learners externally; this does not require in-app cohort, sharing, or moderation features.

#### Exit gate

- Every lesson has independent theological and pastoral/application review.
- Every substantive context/theology claim is sourced.
- Every connection shows both passages, rationale, evidence, and viewpoint.
- Disputed positions and historical misuse are labeled.
- Pilot learners can independently bound, explain, connect, apply, and teach an unfamiliar passage.
- One hundred percent of published claims pass reference, citation, license, reviewer-independence, and release validation.
- The defined offline/two-device/account-switch matrix completes with zero lost artifacts.

### Phase 4 — Public V1 hardening and launch

**Estimated engineering effort:** 3–5 weeks.  
**Content continues in parallel.**

#### Work

- Full teach-back formats and rubric.
- Delayed retrieval and misconception correction.
- Application review reminders without overdue behavior.
- Full personal/curated Connection Explorer.
- Content correction log and rollback.
- Apply founding-cohort corrections to method, copy, content, and accessibility.
- Complete public identity, account recovery, device trust, support, privacy, terms, theological disclosure, age/geographic policy, incident response, and licensing register.
- Complete reviewed introductory coverage for all twelve doctrine-library categories without pretending the whole-canon development is finished.
- Run backup restore and content rollback against stated RPO/RTO targets.
- Complete manual screen-reader, keyboard, zoom, tablet-landscape, and offline-device testing.

#### Exit gate

- Every application contains original meaning, warrant, concrete action, and caution.
- Learners produce a five-minute text-shaped teaching.
- Sensitive cases pass safeguarding review.
- Product copy contains no guilt mechanics or algorithmic claims of divine activity.
- Zero cross-tenant access across every private query, search, sync, export, and future share path.
- Zero unresolved critical/high privacy, security, Scripture-correctness, licensing, or data-loss finding.
- Public English PWA launch criteria, support ownership, and correction response target are met.

### Phase 5 — Post-launch curriculum and life expansion

**Effort:** evidence-driven and content-bound.

#### Work

- Complete Matthew in bounded literary modules after pilot evidence.
- Deepen the remaining six doctrine pages across representative Torah, Prophets, Wisdom, Acts/Epistles, and Revelation material.
- Publish the six standalone Modern Life Labs with canonical-balance and safeguarding review.
- Expand the eleven-stage mountain beyond outlines as reviewed courses become available.
- Localize the interface and curriculum separately; Spanish parallel Scripture remains reading support until human localization is reviewed.

#### Exit gate

- Expansion content meets the same citation, viewpoint, licensing, correction, accessibility, and learning-transfer standards as public V1.
- Growth does not weaken offline reliability, privacy, or the original five rules.

### Phase 6 — Optional coaching/community and cited assistant

Build only in response to validated demand and only after the preceding controls exist.

#### Invite-only coaching

- Artifact-level sharing and revocation.
- Coach comments attached to claims.
- Small-group discussion guides.
- Facilitator tools with no raw-journal access or attendance pressure.
- Moderation and privacy audit.

#### Cited study coach

- Socratic modes, reviewed retrieval, citations, abstention, attempt gate, and red-team evaluation.
- No persona imitation, sermon generation, or pastoral replacement.

---

## 25. Parallel ownership model

Maintain file ownership to prevent collisions, but replace the old feature-only split with explicit versioned seams.

### Read/experience track

- Scripture reader and passage selection.
- Climb, stage, journey, doctrine, thread, and review rendering.
- Progressive workspace components.
- Offline bundles, service worker, responsive behavior, accessibility.
- Content bundle loader and learner-facing source display.

### Data/trust track

- Auth, workspaces, memberships, RLS, devices.
- Drizzle schema and migrations.
- v2 API, sync, conflict recovery, export/delete.
- Search authorization and private indexing boundaries.
- Security headers, telemetry redaction, tenancy tests.

### Content/formation track

- Theological profile and interpretive charter.
- Lesson schemas and golden fixtures.
- Genesis, Matthew, doctrine, and life-lab authoring.
- Source/license register.
- Theological, pastoral, safeguarding, editorial, and accessibility review.

### Shared-change protocol

- `web/lib/contracts.ts` stays frozen.
- New contracts live in versioned modules and require both software tracks to review.
- Schema/API changes land before dependent UI.
- Content schema changes require migration of fixtures and release bundles.
- No agent edits another track's owned file without a recorded handoff.
- Merge and audit at each phase gate, not only at the end.

---

## 26. World offering

### Free forever

- Scripture reader and permitted translations.
- Personal observations, questions, threads, prayer, export, and deletion.
- Genesis Foundations.
- Core offline support.
- Basic review and teach-back.

### Supported membership — only after cohort evidence

- Additional reviewed book courses.
- Full doctrine library and Modern Life Labs.
- Advanced retrieval/teach-back tools.
- Live cohorts or invited coaching where available.

### Sponsored access

Churches and donors can fund learners who cannot pay. Sponsorship never grants access to private journals.

### Church cohorts — later

- Curriculum assignment and discussion guides.
- Consent-based, aggregate learning insights.
- No access to raw private writing, prayer, missed days, or a “spiritual score.”

Do not set permanent pricing until the founding cohort establishes willingness to pay and the real editorial cost. Keep ads and sale of learner data out of the business model.

The founding cohort is free. Billing, entitlements, cancellation, refunds, taxes, scholarships, support, and payment-failure recovery are not pre-launch scope. If the owner later decides to charge before public release, those become explicit release gates rather than invisible operational work.

---

## 27. Principal risks and controls

| Risk | Control |
|---|---|
| Theological overclaim | Claim labels, exact evidence, sources, named reviewers, corrections |
| Hidden denominational bias | Public theological profile and viewpoint policy |
| Forced canonical connections | Typed edges, both passages, evidence label, human review |
| Bad modern application | Original-audience bridge, covenant qualification, misuse warning, safeguarding review |
| Teacher/IP imitation | Pedagogical principles only; no copied voice or proprietary material |
| Scripture/alignment corruption | Atomic builders, manifests, hashes, fail-closed rendering |
| Private journal exposure | RLS, hostile tenant tests, namespaced IDB, cache purge, explicit sharing |
| Offline data loss | Atomic local transaction/outbox, revisions, conflict copies, recovery export |
| AI hallucination | AI delayed; curated retrieval, citation verifier, abstention tests |
| Curriculum scope explosion | Genesis 1–12 and Matthew 1–7 before full-canon work |
| Editorial bottleneck | Content-as-code, stable schemas, narrow releases, explicit review queue |
| Guilt-based engagement | Copy lint, no overdue/streak mechanics, cumulative outcomes |
| Community harm | No public feed; invite-only artifact sharing after privacy review |
| Paywall distrust | Free Scripture/core formation, export/delete, no ads/data resale |

---

## 28. Explicitly out of scope for initial public launch

- Drawing tools; ink remains in Apple Notes.
- Native mobile apps before the PWA proves demand.
- Public feeds, DMs, profiles, likes, comments, leaderboards, or follower counts.
- AI verse explanations before learner observation.
- Automatic sermon generation.
- Living-teacher voice/persona cloning.
- Unlicensed Bible translations, commentaries, courses, audio, or video.
- Automated theological truth scores or dispute resolution.
- Unreviewed Hebrew/Greek claims.
- Medical, mental-health, legal, financial, abuse, crisis, or political directives.
- Seminary accreditation.
- A full-canon authored curriculum at first launch.
- CRDTs or real-time collaborative document editing.
- Church management, attendance, giving, or member surveillance.

---

## 29. Owner decisions and recommended defaults

These decisions change content or product meaning and require explicit ratification before their dependent phase.

| Decision | Recommended default | Needed by |
|---|---|---|
| Theological profile | Historic creedal core plus clearly disclosed evangelical Protestant convictions and named alternatives | Before Phase 1 content schema freezes |
| Mountain orientation | Creation at bottom-left, movement toward Christ at summit, new creation at bottom-right, matching current frontmatter | Before Climb expansion |
| Initial audience | Individual everyday believer; teachers are a secondary use case | Now |
| Launch curriculum | Five mirror pairs plus Christ-summit orientation + Genesis 1–12 + Matthew 1–7 | Before content production |
| Community | None at initial launch; invite-only artifact sharing later | Before tenancy/sharing scope |
| Business model | Free founding cohort; later free core, supported curriculum membership, and sponsored access | After willingness-to-pay evidence |
| AI | No AI in MVP; cited Socratic coach only after reviewed corpus/evals | After Phase 5 evidence |

---

## 30. Reconciliation with Claude's concurrent `BUILD_PLAN.md`

Claude's 2026-08-12 draft is directionally strong on the formation loop, practical Gate 0 work, explicit application fields, a narrow Genesis/Matthew pilot, and delaying AI. Preserve those strengths. Do not adopt that draft as the sole executable specification until these material issues are reconciled:

1. It calls `lib/contracts.ts` frozen while instructing the team to add approximately ten types directly to it. Use versioned v2 contract modules.
2. Its same-chapter `RefRange` cannot represent normal literary units such as Genesis 1:1–2:3 and is not versification-aware for SBL. Freeze the canonical range contract first.
3. It keeps client-clock last-write-wins and `userId`-only tables. That is acceptable for the current private prototype, but unsafe for a public, multi-device product or later coaching.
4. It lacks a resumable `StudySession` identity and keys the workspace by book/chapter. Multiple studies of the same passage, pinned curriculum versions, mode-specific completion, and revision history need session IDs.
5. It does not resolve the database/API rule requiring every active Entry to have a thread against the third-sighting rule. Provisional sightings and the finalized-session transition must be modeled explicitly.
6. Its fixed unlock chain requires a connection before theology and theology before application. That can train users to invent a connection where none is warranted. Only the matching learner-attempt gates should be strict.
7. It requires all application fields to save. Partial drafts must save locally; completeness belongs to a deliberate finalize transition.
8. It describes curated content as both build-time files and database tables without one authority, immutable catalog releases, durable historical storage, checksum rollback, or withdrawal semantics.
9. Its two-account Gate 0 test cannot run under the current single-email allowlist without a controlled invitation/test-auth change.
10. It treats radar output as connection rows before the learner has compared two texts. Radar must create motif candidates, not theological edges.
11. It has no explicit account-scoped IndexedDB migration, trusted-device offline identity, RLS transaction context, cursor compaction/reset, or prose-conflict preservation.
12. Its two-to-three-week AI estimate does not include provider privacy controls, citation verification, evaluation, red teaming, or pastoral-safety review; AI remains outside the committed MVP.

This master plan is the recommended reconciliation layer. Claude's shorter plan can remain a sprint-oriented checklist after its schema, sync, content-release, and workflow assumptions are aligned here.

---

## 31. Definition of product done

The initial public product is genuinely ready when all of the following are true:

### Trust

- Real auth/database, tenancy, offline, export, deletion, and recovery have been independently verified.
- No critical/high privacy, security, Scripture-correctness, licensing, or data-loss gate remains.
- Personal writing never appears in public/static builds, shared caches, or telemetry.

### Method

- A learner can complete Text → Context → Connections → Theology → Conviction → Practice → Teach without AI.
- The five original guide rules are enforced without contradicting one another.
- Scripture, learner work, curated teaching, viewpoints, and assistant material are visibly distinct.

### Content

- Genesis 1–12, Matthew 1–7, five mirror pairs plus the Christ summit, six deep pilot doctrines, and six clearly limited doctrine overviews are versioned, cited, licensed, and independently reviewed.
- Difficult and disputed issues model uncertainty and faithful alternatives.
- A correction and withdrawal process has been exercised, not merely documented.

### Formation

- Pilot learners can interpret an unfamiliar passage, defend a connection from both texts, form a warranted application, and explain the passage without notes.
- Modern applications name the original audience, enduring principle, concrete response, and misuse caution.
- No metric or copy punishes absence.

### Delivery

- Phone, tablet, desktop, accessibility, install, offline, sync-conflict, account-switch, and content-rollback tests pass.
- Support, incident response, theological disclosure, privacy, terms, licenses, and content ownership are operational.

---

## 32. First implementation slice

After Gate 0 closes, the first vertical slice should be the **Genesis 3 module end to end**, beginning with Genesis 3:1–7 and continuing through the bounded Genesis 3:8–24 lesson:

1. Select the exact bounded passage range.
2. Load Scripture and enforce the real read gate.
3. Capture verse-anchored observations and a question.
4. Record provisional sightings or link an established thread.
5. Reveal sourced literary/historical context facts, not the curated conclusion.
6. Write and evidence an interpretation attempt; then reveal the reviewed interpretive material.
7. Attempt a comparison; then examine one reviewed canonical connection side by side.
8. Write a classified theological claim.
9. Attempt and complete the application bridge, faithful response, and misuse warning.
10. Draft, rehearse, and self-review a five-minute teach-back with a “not justified” statement.
11. Save offline, sync, conflict-test, export, reload, and retrieve it later.
12. Publish the lesson through the reviewed catalog-release pipeline and prove rollback/reconstruction.

This slice deliberately touches the entire product architecture. When it passes, the team can replicate a proven formation method instead of building dozens of disconnected screens.

---

## Bottom line

Build Scarlet Thread in this order:

1. Make Scripture, privacy, auth, offline behavior, and user data trustworthy.
2. Add a versioned evidence model without destroying the current journal.
3. Prove the whole formation loop with one excellent passage.
4. Publish a narrow, deeply reviewed Genesis and Matthew curriculum.
5. Measure whether learners can explain and apply Scripture, not whether they return every day.
6. Add modern-life, coaching, community, and AI only after the method and governance are strong enough to carry them.

The finished product should not merely tell people what a passage means. It should form people who know how to read carefully, think theologically, connect responsibly, live faithfully, and teach humbly.
