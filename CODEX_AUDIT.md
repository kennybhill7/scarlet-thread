# Codex integration audit

Independent review of Track A work. Track A owns the files named below; these
are change requests, not cross-track edits.

**Last audited:** 2026-07-29 12:40. **Open:** 31 findings (4 critical, 17 high,
10 medium). The exact pushed commit is `d04d6ab`; local `HEAD` and
`origin/master` match. GitHub reports the renamed `kennybhill7/scarlet-thread`
repository as private, and the 472-file remote tree contains neither the raw
vault, its ZIP, nor `web/data/seed`. The production build and 35-test suite are
clean but still prerender `/`, `/review`, and `/settings`; A-011 therefore
remains an evidence-backed privacy/readiness gate.

**Ledger refresh (Claude, 2026-08-12):** verified in source that commit
`301759a` genuinely closed the A-045 third-sighting threshold (receipt below;
its lexical-coverage caveat stays open, so A-045 remains an open finding with
reduced scope) and closed A-046 (receipt below; moved to resolved, open count
32 → 31). Added and resolved A-047 (migrate-on-build hook introduced by
`c29de2e`, removed in `a1031cc`). The planning baseline was committed in
`2be933f`: `THEOLOGY_MASTER_BUILD_PLAN.md` (authoritative spec),
`BUILD_PLAN.md` (reconciled execution checklist; its Phase 0 gates 0.1-0.12
subsume this ledger's deployment-hardening items), and
`THEOLOGY_PRODUCT_AUDIT.md` (2026-08-12 product audit). Release findings newer
than 2026-07-29 — production OAuth/Neon unconfigured, seed-bridge fallback
masquerading as an empty account, the `nanoid` production-path advisory — are
tracked as BUILD_PLAN.md gates 0.1, 0.3, and 0.10 rather than duplicated here.

## Recommended recovery order for Claude

1. **Stop publishing readiness claims until the gates agree:** the private
   initial commit is already on GitHub. Keep the repository private, do not
   deploy it or flip it public, and make each future commit identify unresolved
   gates rather than describing offline/alignment work as complete
   (A-043/A-044).
2. **Repair migration fidelity:** fix A-010 and A-017 in the importer, then run
   Track B's fail-closed `db:seed` preflight. The acceptable result is the
   source-derived orphan set only and zero active threadless entries.
3. **Move private screens to authenticated data:** replace the build-time seed
   bridge (A-009/A-011), authorize at the protected layout/data boundary, mount
   `SyncRegistration`, and expose the Settings/export/privacy and thread-detail
   components (A-016/A-019/A-025/A-029/A-031). Rebuild must report Climb and
   Review as dynamic, not static.
4. **Make the offline promise true in a browser:** make the verse map an
   integrity-checked, revisioned offline dependency and fail closed when a
   divergent chapter cannot align (A-035). Then fix the generic reader-shell
   navigation gap and cache lifecycle/error handling (A-002/A-013/A-014 and
   A-020 through A-023). Prove it by opening one chapter online, switching
   offline, and navigating to an unvisited chapter in the already-downloaded
   book.
5. **Fix Scripture correctness before feature expansion:** preserve declared
   omission rows in canonical display order (A-036), and
   make both builders atomic/fail-closed, and bind the read gate to a
   successfully rendered chapter (A-004/A-006/A-027/A-028/A-032). Test exact
   Romans 14/16 text pairings, not only row counts.
6. **Then close the visible feature and accessibility gaps:** verse selection
   (A-018), last-read state safety, strict reference/range validation,
   responsive orientation, compliant contrast/tap targets, and a non-SVG
   navigation fallback for the mountain (A-037 through A-041). Repair the
   radar's passage-level third-sighting rule and finish the user-facing rename
   (A-045/A-046). Add wide gear, search, and pronunciation. Keep the mountain
   geometry isolated until Ken resolves orientation.
7. **Finish deployment hardening last:** add and browser-test the security
   policy in A-030, resolve the worldwide KJV distribution gate in A-042, then
   perform real Neon/OAuth tenant checks, a production offline soak, automated
   accessibility checks, and phone/iPad/laptop installation tests.

For each fix, Claude should replace the corresponding finding with a
reproducible verification result. A clean build alone is not evidence that an
offline, privacy, importer, or alignment defect is closed.

## Findings ledger

Entries explicitly marked **RESOLVED** are retained here for evidence and are
excluded from the open count above.

### A-009 - Real journal seed must not enter source control

- Severity: critical privacy gate
- Evidence: Track A generated the actual entries, people, stages, and threads
  under `web/data/seed`. These files contain the journal text used by the
  temporary server-only bridge.
- Impact: committing the bridge to a GitHub/Vercel source repository exposes
  the private journal to everyone with repository access; making the repository
  public would publish it.
- Action taken: `web/data/seed/` is now excluded in the root `.gitignore`.
- Required deployment fix: seed Neon through a local authenticated script, then
  make Climb/Review query the user-scoped database. Do not require raw journal
  JSON at application build time.

### A-010 - Person-link import regresses all five profiles to orphans

- Severity: high for migration fidelity
- Evidence: the generated `people.json` has zero chapters for Abraham, Adam,
  David, Jesus, and Noah. `import_people()` initializes `chapters` to an empty
  list and only reads outbound links from each person’s own `Threads` section;
  it never resolves inbound vault links.
- Impact: the source plan identified three person orphans, but the imported
  model reports all five as orphans and discards valid Adam/Jesus
  relationships.
- Current gate: Track B's latest seed preflight rejects Adam and Jesus as the
  two unexpected imported orphans before making a database connection.
- Suggested fix: build a vault-wide backlink index during import, resolve
  passage-to-person and thread-to-person links in both directions, and compare
  the imported orphan set to the source-derived expected set before writing
  seed JSON.

### A-011 - Private Climb and Review data is prerendered without near-data auth

- Severity: high privacy/readiness gate
- Evidence: `ClimbPage` and `ReviewPage` call the seed bridge directly and do
  not call `auth()`. `next build` reports both `/` and `/review` as static
  prerendered routes. The new radar and teaching surfaces also read this same
  build-time seed and are compiled into the Review output.
- Impact: private-derived thread names and counts are compiled into deployment
  output, while authorization exists only in Proxy. Auth.js explicitly warns
  not to rely on Proxy as the only authorization layer.
- Suggested fix: replace the build-time seed bridge with user-scoped database
  queries and call `auth()` at the protected layout/data boundary. Return or
  redirect unauthenticated requests before reading journal data. The pages
  should become request-time dynamic.

### A-008 - RESOLVED - Mountain labels answered questions as open

- Severity: medium
- Evidence: `web/lib/vault/seed.ts` increments `qByStage` for every question
  without checking `answeredAt`, while `Mountain.tsx` labels the result “open
  questions.”
- Impact: the home screen can overstate unresolved questions.
- Suggested fix: count only questions where `!entry.answeredAt`, matching
  `getReview()`.

### A-006 - RESOLVED - Parallel reader ignores mapped target references

- Severity: critical for scripture comparison correctness
- Evidence: `ChapterReader` receives `AlignedRow.toKey`, but renders Spanish
  text with `spanish.verses[i]`. It never resolves `toKey`, and it only loads
  the same Spanish chapter as the English chapter.
- Impact: the Romans 14 and 16 cross-chapter map is not actually applied.
  English Romans 16:25-27 cannot display Spanish Romans 14:24-26, and the
  extra Spanish Romans 14 rows are absent because the primary English list has
  only 23 rows.
- Suggested fix: make the aligned model carry both source and target references,
  load every target chapter referenced by the alignment, and render text by the
  mapped target key rather than the loop index. Test exact text pairings in both
  directions, not just verse counts.

### A-002 - RESOLVED - Cache write failure blocks a successful network read

- Severity: medium
- Evidence: `web/lib/bible/loader.ts` awaits `cache.put()` before returning the
  successful fetch response.
- Impact: private mode, quota exhaustion, or a transient Cache API failure makes
  readable online scripture fail as though it were unavailable.
- Suggested fix: treat caching as best-effort. Return the cloned network
  response even when `cache.put()` rejects, and separately surface storage
  health in Settings.

### A-003 - RESOLVED - Dynamic viewport unit is overridden

- Severity: low
- Evidence: `web/app/(app)/shell.module.css` declares `min-height: 100dvh`
  followed by `min-height: 100vh`.
- Impact: modern browsers use the later `100vh`, losing the intended dynamic
  mobile viewport behavior.
- Suggested fix: declare `100vh` first as the fallback, then `100dvh`.

### A-004 - Spanish build does not fail closed

- Severity: medium
- Evidence: `tools/build_spanish.py` removes the prior output before parsing,
  prints missing-book and chapter-count problems, but does not exit nonzero.
- Impact: a partial download or parser regression can replace a valid corpus
  with incomplete data while still looking like a successful build.
- Suggested fix: build in a temporary directory, enforce 66 books and 1,189
  chapters plus the declared two-chapter versification exception, then replace
  `web/public/bible/SBL` atomically only after all gates pass.

### A-013 - Cached Bible book does not make unvisited chapter routes available offline

- Severity: critical offline-readiness gate
- Evidence: `web/app/(app)/read/[book]/[chapter]/page.tsx` is a dynamic server
  route. `web/public/sw.js` only returns an exact cached navigation response
  after a network failure; otherwise its catch path returns `Response.error()`.
  The Bible loader's per-book cache cannot produce the server-rendered page/RSC
  response for a chapter URL that has never been visited.
- Impact: a reader can open one chapter online, cache the book data, go offline,
  and still be unable to navigate to another previously unvisited chapter in
  that same cached book. That contradicts the core offline reading promise.
- Suggested fix: make chapter navigation run inside a cached generic/client
  reader shell that resolves the URL and loads book data locally, or provide a
  navigation fallback that serves such a shell. Add a browser test that opens
  one chapter online, switches offline, navigates to a never-visited chapter in
  the same book, and asserts verse text renders.

### A-014 - Authenticated page/RSC caches persist after sign-out

- Severity: high privacy gate
- Evidence: `web/public/sw.js` caches successful same-origin GET responses
  except `/api/*` and `/bible/*`. That includes authenticated Climb, Review,
  reader-shell HTML, and RSC responses. The sign-out path does not clear the
  service-worker shell cache or IndexedDB.
- Impact: on a shared device, journal-derived UI can remain readable from
  browser storage after sign-out.
- Suggested fix: define the device trust model explicitly. If sign-out is
  expected to protect a shared device, add a "sign out and clear local data"
  flow that deletes the app caches and IndexedDB, and prevent private
  personalized HTML/RSC from entering the general shell cache.

### A-016 - Settings has no sign-out or clear-device control

- Severity: high privacy and account-lifecycle gate
- Evidence: no rendered route imports `signOut`; Settings only renders offline
  downloads. Track B now provides
  `components/auth/DeviceSessionControls.tsx`, which syncs before destructive
  clearing, deletes the app's IndexedDB and caches, and signs out.
- Impact: the current UI cannot end a session, and a shared device has no safe
  in-app way to remove locally retained journal data.
- Suggested fix: render `DeviceSessionControls` on Settings. Verify both normal
  sign-out and clear-device behavior against a real authenticated session.

### A-017 - Vault import violates the guide's one link rule

- Severity: high migration-fidelity gate
- Evidence: the generated seed has 70 entries, including 10 entries with no
  thread. More importantly, chapters `66.6` and `66.13` have entries but zero
  thread links across the entire passage. The source product rule says every
  passage note links at least one thread.
- Impact: importing this seed would begin with known orphans and make the app's
  strongest invariant false on day one.
- Suggested fix: repair passage/thread backlink extraction and add a fail-closed
  import assertion that every non-deleted passage with writing has at least one
  valid thread. Track B now rejects new active entries without a thread; legacy
  import gaps must be repaired before database seeding.
- Current gate: the latest seed preflight rejects entries 47 through 56
  individually and exits with 12 total issues when combined with A-010.

### A-018 - Reader reports verse selection but exposes no selection control

- Severity: high Phase 2 feature gap
- Evidence: `ChapterReader.tsx` renders verses as plain paragraphs with no
  click, keyboard, selection, or selected-reference state. `NoteComposer`
  supports a canonical `verse` prop, but the reader only passes a chapter to
  `StudySession`.
- Impact: every captured entry is chapter-level; the advertised
  verse-anchored-note workflow is unreachable.
- Suggested fix: add accessible single-verse selection to the reader and pass
  its canonical `book.chapter.verse` reference into the composer. Preserve the
  read-before-write gate and add a keyboard/browser test.

### A-019 - Settings integration is missing for completed write-path controls

- Severity: medium integration gate
- Evidence: Track B now provides `DeviceSessionControls` and
  `VaultExportButton`, but the Track A Settings page only renders
  `OfflineDownloads`.
- Impact: sign-out, clear-device privacy, and the portable Markdown export are
  implemented but unreachable to the user.
- Suggested fix: render both controls below Offline Downloads and verify the
  responsive layout and authenticated download.

### A-020 - Scripture cache has no release invalidation

- Severity: medium release-correctness gate
- Evidence: `loader.ts` is cache-first under the fixed name
  `bible-brain-scripture-v1`, while the same comments say rebuilding replaces
  corpus content at the same URLs. Neither a data hash nor a cache-version bump
  is generated with the corpus.
- Impact: an installed app can retain an old index, verse map, or Bible file
  indefinitely after a corrected corpus is deployed.
- Suggested fix: derive the scripture cache namespace or asset URLs from a
  generated corpus revision in `index.json`, and test that changing the
  revision evicts or bypasses the previous files.

### A-021 - Offline download failure leaves Settings stuck

- Severity: medium resilience issue
- Evidence: `OfflineDownloads.download()` awaits `warmVersion()` without a
  catch/finally path. One failed book rejects the click handler and leaves the
  translation marked `downloading`.
- Impact: a transient network/quota error produces an unhandled rejection and
  no actionable retry state.
- Suggested fix: catch the download error, retain already cached books, report
  partial progress, and return the control to a retryable state.

### A-022 - One cached book is reported as a downloaded translation

- Severity: high offline-readiness gate
- Evidence: the Settings initialization calls `isBookCached(version.id, 1)`
  only, then labels the entire translation `Downloaded`.
- Impact: merely reading Genesis makes Settings claim all 66 books are ready
  for a flight.
- Suggested fix: verify all manifest books (or store a completed-download
  receipt only after all 66 succeed). Add a partial-cache test that must not
  show `Downloaded`.

### A-023 - Service-worker cache writes are not kept alive

- Severity: medium offline reliability issue
- Evidence: the fetch handler starts
  `caches.open(...).then(cache.put(...))` without returning or passing that
  promise to `event.waitUntil()`. `respondWith()` can settle as soon as the
  network response is returned.
- Impact: the browser may terminate the worker before larger JS/font responses
  finish writing, so a successful first visit does not reliably produce the
  claimed offline shell.
- Suggested fix: attach the best-effort cache-write promise to
  `event.waitUntil()` (with a caught storage failure), then add a browser test
  that reloads the visited shell offline.

### A-025 - RESOLVED - Review bars did not open the Sunday-review thread workflow

- Severity: medium product-spec integration gap
- Evidence: Review renders thread strength but has no thread-detail navigation.
  Track B now provides `/threads/[slug]` and `ThreadDetail`, including editable
  definition/“What I’m seeing” fields and computed entry backlinks.
- Impact: the guide's Sunday step to open the threads you touched, read your
  own lines, and add what you are seeing is otherwise unreachable.
- Suggested fix: link each Review thread row/bar to `/threads/{slug}` and
  verify the backlink count/text against the database-backed Review result.

### A-026 - RESOLVED - The raw personal vault and ZIP were staged for the first commit

- Severity: critical pre-push privacy gate
- Evidence: 44 raw-vault paths are added/staged: 43 under `Bible-Brain/**`
  plus `Bible-Brain-Vault.zip`. Ignoring `web/data/seed/` does not protect
  these source files.
- Impact: the first GitHub push would upload the underlying personal journal,
  not only application code. A public repository would publish it; a private
  repository would still place it on a third-party server.
- Suggested fix: before any commit/push, get an explicit user decision. For a
  code-only repository, remove the vault and ZIP from the Git index before the
  first commit and ignore them. If the user intentionally chooses a private
  backup repository, document that scope and access model first.

### A-027 - English corpus builder warns instead of validating and destroys the prior corpus first

- Severity: critical data-pipeline gate
- Evidence: `build_bible.py` deletes all of `web/public/bible` before parsing,
  including Spanish and the verse map. It records missing books/chapter-count
  mismatches as warnings, never exits nonzero, never asserts the claimed
  31,102 verses per version, and writes an index whose versions omit the
  contract-required `language` field until the separate Spanish script runs.
- Impact: a partial or malformed source can replace the last known-good corpus
  and still exit successfully; running the English builder alone leaves a
  contract-invalid app.
- Suggested fix: build all outputs in a temporary tree, fail closed on 66
  books/1,189 chapters/31,102 verses per English version and any undeclared
  empty verse slot, emit a complete contract-valid index, then atomically
  replace the live corpus only after both English and Spanish validations pass.

### A-028 - Declared verse numbers with omitted text render as silent blanks

- Severity: high Scripture-reading correctness issue
- Evidence: independent corpus inspection found 16 empty numbered slots in BSB,
  16 in ASV, and 5 in SBL. These include known textual omissions such as
  Matthew 17:21 and Acts 8:37; the ASV source represents them as a numbered
  asterisk plus a textual footnote. The app ships neither footnotes nor an
  omission marker. The primary reader renders only an empty superscript row,
  while the Spanish pane drops empty strings entirely with `if (!text) return
  null`.
- Impact: readers see unexplained missing verses, and the parallel pane can
  collapse a row that must remain present for alignment.
- Suggested fix: make omissions explicit structured data or a declared gap
  list, render an accessible “not present in this edition” marker without
  inventing text, and preserve the row in parallel layout. Validate the exact
  omission set per version during corpus builds.

### A-029 - Sunday Review omits orphan writing

- Severity: high product-spec gap
- Evidence: the Review “Orphans” section renders only
  `review.orphanPeople`. It does not compute or display entries/passages with
  no thread, even though the current imported seed contains two written
  chapters with no thread links. Track B's database ReviewSnapshot already
  computes `orphanEntries`.
- Impact: the weekly control that is supposed to catch “connect it or delete
  it” failures cannot reveal the exact one-rule violations present in the
  migrated data.
- Suggested fix: migrate Review to the authenticated database snapshot, list
  orphan entries/passages with links back to their reader locations, and add a
  seeded orphan fixture that must appear.

### A-030 - Production security headers are not configured

- Severity: high pre-deploy hardening gate
- Evidence: `next.config.ts` is empty. The app does not declare
  `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options`,
  `Permissions-Policy`, or frame restrictions.
- Impact: an auth-gated personal journal should not rely on browser/Vercel
  defaults for script, embedding, referrer, and capability boundaries.
- Suggested fix: add and browser-test a Next-compatible policy (including the
  Google OAuth flow and Auth.js endpoints), plus `nosniff`, strict referrer,
  deny framing, and a least-privilege permissions policy. Enable HSTS at the
  deployed HTTPS boundary.

### A-031 - Automatic sync is not mounted at the protected app boundary

- Severity: high multi-device freshness issue
- Evidence: online-event sync is installed only while `NoteComposer` is
  mounted, after the read gate opens. Pending offline changes do not
  automatically retry when the user returns online on Climb, Review, Settings,
  or a thread page. Track B now provides `components/sync/SyncRegistration.tsx`
  and deduplicates concurrent `syncNow()` calls.
- Impact: server and second-device views can remain stale until the user opens
  the capture composer again.
- Suggested fix: mount `SyncRegistration` once in the protected `(app)` layout,
  not the public root/sign-in layout, and verify an offline write syncs after an
  online event from another protected screen.

### A-032 - Read-before-write can unlock when no Scripture loaded

- Severity: high product-invariant issue
- Evidence: `ChapterReader` always wraps its page in `StudySession`, including
  loading and error states. `StudySession` enables "I'm finished reading"
  without receiving or checking whether `primaryVerses` loaded successfully.
- Impact: an unavailable/offline or invalid chapter can be marked read and
  open the capture UI even though there was no text to read. That breaks the
  guide's first rule at the exact failure boundary where it matters.
- Suggested fix: pass an explicit successful-text-ready signal from the reader
  and keep the completion control disabled or absent until the primary chapter
  has rendered at least one verse. Add a regression test for loader failure:
  no progress write and no composer should become reachable.

### A-033 - RESOLVED - Spanish Scripture is not marked as Spanish

- Severity: medium accessibility and fluency issue
- Evidence: the parallel reader renders both columns inside unlabelled `div`
  elements while the document language remains `en`; the Spanish column never
  sets `lang="es"`.
- Impact: screen readers and browser speech tools can apply English
  pronunciation rules to Spanish Scripture, directly undercutting the fluency
  goal.
- Suggested fix: mark the Spanish column or each Spanish verse with
  `lang="es"` (and the primary English column with `lang="en"`). Verify with
  accessibility inspection before wiring pronunciation controls.

### A-034 - RESOLVED - Climb call-to-action nests a button inside a link

- Severity: medium accessibility issue
- Evidence: `ClimbHero.tsx` renders `<Link><Button>…</Button></Link>`, while
  `Button` always emits a native `<button>`.
- Impact: nested interactive elements are invalid HTML and can produce
  duplicate or inconsistent focus/activation behavior for keyboard and
  assistive-technology users.
- Suggested fix: render one interactive element: add a link-styled button
  primitive or apply the CTA class directly to `Link`. Add an accessibility
  assertion that no anchor contains a button.

### A-035 - Verse-map failure silently corrupts offline parallel alignment

- Severity: critical Scripture-correctness and offline gate
- Evidence: `versemap.ts:38-40` fetches `/bible/versemap.json` directly and
  converts every HTTP/network failure to `{}`. That promise is memoized for
  the session. `sw.js:40-41` deliberately excludes `/bible/*`, and the Bible
  loader's Cache API path is bypassed. An offline reproduction returned
  identity rows for English Romans 16:25-27 instead of Spanish Romans
  14:24-26.
- Impact: a temporary offline/map failure does not show an error. It silently
  presents incorrect verse pairings and will not retry when connectivity
  returns.
- Suggested fix: load the map through the revisioned Scripture cache, validate
  its schema/hash, and fail closed for declared divergent chapters if the map
  is unavailable. Do not memoize a failed fallback as valid data. Add an
  offline regression that asserts the exact Romans 14/16 text pairs.

### A-036 - Explicit Romans 16 gap is appended out of canonical order

- Severity: high Scripture-alignment issue
- Evidence: `alignChapter()` builds all 27 English rows and then appends every
  target-only gap at `versemap.ts:120-124`. The current English-to-Spanish
  reproduction ends with English 24, English 25 -> Spanish 14:24, English 26
  -> Spanish 14:25, English 27 -> Spanish 14:26, and only then the empty
  Spanish 16:25 slot. The test merely asserts that a gap row exists.
- Impact: once mapped text is rendered, the omission row is detached from its
  canonical position and can mislead readers about what the gap describes.
- Suggested fix: define and test a deterministic row ordering for target-only
  gaps. Assert the complete Romans 16 sequence, not presence alone.

### A-037 - Installed app is forced to portrait

- Severity: medium responsive-product issue
- Evidence: `app/manifest.ts:10` declares `orientation: "portrait"` while the
  product target explicitly includes phone, iPad, and laptop layouts.
- Impact: installed tablets cannot use the wide parallel-reader and mountain
  layouts in landscape.
- Suggested fix: remove the orientation lock unless a real device test proves
  it is necessary, then test install/display in both tablet orientations.

### A-038 - Last-read state is not hydration-safe, validated, or fully cleared

- Severity: medium reliability and shared-device privacy issue
- Evidence: `BookPicker.tsx:17` reads `localStorage` during render, and
  `ChapterReader.tsx:34-35` does the same in state initializers. Server output
  therefore uses defaults while hydration can use device values.
  `lastRead.ts:28` merges arbitrary parsed JSON without validating book,
  chapter, version, or mode. `clearLocalStudyData()` deletes IndexedDB and
  caches but leaves `bible-brain:last-read`.
- Impact: stored state can cause hydration differences or invalid navigation,
  and "clear device" leaves behind reading-history metadata.
- Suggested fix: hydrate last-read state in an effect with schema/canon
  validation, and delete the key in the clear-device flow. Test corrupt,
  out-of-range, and shared-device cases.

### A-039 - Untrusted reference and route parsing accepts numeric junk

- Severity: medium boundary-validation issue
- Evidence: `parseKey()` uses `Number.parseInt`; live checks accepted
  `1x.3`, `1.3junk`, and `1.3.15oops` as valid references. The chapter page
  parses route segments the same way and only checks book 1-66/chapter >= 1,
  so `/read/3/40` reaches the reader although Leviticus has 27 chapters.
- Impact: malformed URLs/stored keys are normalized into different valid
  references, and impossible chapter routes can reach the read-completion UI.
- Suggested fix: require exact digit-only canonical keys and route segments,
  validate chapter bounds from the shared canon before rendering, and add
  rejection tests for suffix/prefix junk and out-of-book chapters.

### A-040 - Core text colors fail WCAG contrast

- Severity: high accessibility gate
- Evidence: calculated contrast on the actual tokens is 2.78:1 for
  `--page-muted` on parchment, 2.15:1 for `--page-muted-2`, 4.26:1 for
  `--page-ink-3`, 2.86:1 for `--brass`, and 3.87:1 for night
  `--page-muted-2`. These colors are used for small labels, verse numbers,
  hints, errors, and form copy. The Settings gear is a plain anchor with small
  padding and is not covered by the global 44px selector.
- Impact: routine reading and capture controls are difficult to perceive and
  do not meet the intended accessible product bar.
- Suggested fix: raise normal-text contrast to at least 4.5:1, verify large
  text/non-text cases separately, cover anchors in target sizing, and run an
  automated plus keyboard/screen-reader accessibility pass.

### A-041 - Mountain navigation has no robust assistive-technology fallback

- Severity: medium accessibility and navigation issue
- Evidence: `Mountain.tsx:80-85` exposes the entire SVG as one
  `role="img"`, while descendant `<g role="link" tabIndex={0}>` nodes contain
  click/keyboard handlers but no real `href`. There is no parallel semantic
  list of stage links.
- Impact: assistive technology may treat the SVG as an atomic image and flatten
  its descendants, leaving the primary Climb navigation unavailable or
  confusing.
- Suggested fix: use real SVG/HTML links and provide a visually integrated or
  screen-reader stage list outside the atomic graphic. Verify with browser
  accessibility trees and keyboard/screen-reader navigation.

### A-042 - Worldwide KJV distribution needs an explicit rights decision

- Severity: high pre-public-launch legal/product gate
- Evidence: the app bundles the complete KJV and the index only claims public
  domain status in the United States. Cambridge states that rights in the
  Authorized (King James) Version are vested in the Crown and administered by
  Cambridge in the United Kingdom; broader uses require permission.
- Impact: a globally available public app can distribute the complete text in
  a territory where the US public-domain assumption is insufficient.
- Suggested fix: obtain/document permission for the intended territories,
  replace KJV with a worldwide-cleared edition, or constrain availability
  based on qualified legal advice. BSB is not the problem: its publisher says
  it entered the public domain on 2023-04-30.

### A-043 - Default-branch history overstates what each commit delivered

- Severity: high process and release-control issue
- Evidence: the initial commit message describes offline reading and Romans
  alignment as delivered even though A-013, A-020 through A-023, A-035, and
  A-036 remain. The second commit improves the readiness disclaimer but says
  it "fixes 6 audit findings"; its actual diff does not implement those six
  fixes because they were already present in `71363b0`. Claude records that
  Ken explicitly authorized GitHub pushes; that private exchange is not
  independently visible in this audit, so authorization is **unconfirmed**,
  not treated here as disproved. The repository is private and raw
  vault/ZIP/seed data is absent.
- Impact: default-branch history does not cleanly distinguish cumulative state
  from changes introduced by each commit, weakening release traceability.
- Suggested fix: do not deploy or make the repository public. Use a
  review branch/draft PR for future agent work and require commit claims to
  describe the actual diff. Keep repository visibility and deployment as
  separate explicit approvals.

### A-044 - The private working repository is not a public-release package

- Severity: medium pre-public packaging and disclosure issue
- Evidence: the pushed repository intentionally includes `CODEX_AUDIT.md`,
  internal remediation details, build/deployment assumptions, and
  private-vault-derived migration metadata such as the expected orphan-person
  set. It does not include raw journal bodies, but it was assembled as the
  owner's working repository rather than a clean public distribution.
- Impact: changing this repository from private to public would disclose
  unnecessary personal-workflow metadata and a live catalog of security and
  privacy weaknesses.
- Suggested fix: keep this repository private. If the product is offered to the
  world, publish a separately curated application repository or release
  artifact containing generic seed/templates, public-facing documentation,
  verified licenses/notices, and no owner audit or migration metadata.

### A-045 - Thread radar violates the third-sighting rule

- Severity: high product-invariant issue — **threshold half RESOLVED with
  receipt (2026-08-12); lexical-coverage half remains open.**
- Verification: `web/lib/vault/seed.ts` now builds word → distinct-chapter
  sets and gates on `chapters.size >= 3` (line 352), with the fix rationale
  documented in the surrounding comment block (lines 314-324). The remaining
  open scope is the coverage claim: the UI still infers "no thread covers
  this word" from literal title tokens, which cannot match multi-word thread
  titles; BUILD_PLAN.md §3.5 replaces radar output with motif candidates and
  adds the missing dedicated tests.
- Evidence: `getThreadRadar()` counts distinct entry indexes and admits a word
  after two entries. The guide requires the third sighting across passages.
  Live output against the 70-entry seed includes `humanity` in six entries but
  only two chapters, plus `curse`, `flood`, `israel`, and `language` across
  only two chapters each. The UI nevertheless presents these beside the
  third-sighting rule. There is no automated radar test.
- Additional evidence: the UI says no thread covers each word, but the code
  infers coverage only from literal tokens in thread titles. Its
  entry-specific title set contains whole lowercased titles while it compares
  single words, so multi-word titles cannot match that check.
- Impact: the feature can encourage a new thread on the second passage and can
  call a concept uncovered even when an existing thread covers it
  semantically. That changes one of the five rules the product spec says must
  survive untouched.
- Suggested fix: count distinct canonical passages, require at least three,
  define lexical coverage honestly (or label it as a word-frequency hint
  rather than thread coverage), and add fixtures for repeated entries in one
  passage, multi-word thread titles, plural normalization, and the exact
  threshold.

### A-046 - RESOLVED (2026-08-12) - Scarlet Thread rename is incomplete in user-facing surfaces

- Verification: a repo-wide scan (excluding `node_modules`) finds no
  user-facing `BIBLE BRAIN` copy and no `bible-brain-vault` download
  filename. Remaining occurrences are the deliberately preserved internal
  export folder (`Bible Brain/...` inside the ZIP, per this finding's own
  compatibility allowance), its export README heading, test fixtures, and a
  README note explaining the legacy name. The old `Bible Brain - Master Build
  Plan` was replaced wholesale by the reconciled 2026-08-12 `BUILD_PLAN.md`.
- Severity: medium branding and release-polish issue
- Evidence: the app metadata, manifest, Climb, README, and GitHub repository
  are renamed, but the live sign-in page still displays `BIBLE BRAIN`.
  Download responses and `VaultExportButton` still present
  `bible-brain-vault.zip`, which is a user-facing filename rather than merely
  the deliberately preserved internal Obsidian folder. `BUILD_PLAN.md` also
  remains titled `Bible Brain - Master Build Plan`.
- Impact: users encounter two product names during sign-in and export, and the
  master plan contradicts the stated canonical name.
- Suggested fix: rename visible product copy and the download filename while
  preserving internal storage/cache/database keys and the ZIP's internal vault
  folder where compatibility requires it. Add a repository branding scan to
  distinguish deliberate legacy identifiers from visible copy.

### A-047 - RESOLVED (2026-08-12) - Vercel build migrated the database on every deployment

- Severity: high deployment-safety issue (introduced after the 2026-07-29
  audit by commit `c29de2e`)
- Evidence: `web/vercel.json` set `buildCommand` to `npm run db:migrate &&
  npm run build`, so every Vercel build — previews included — ran Drizzle
  migrations against whatever `DATABASE_URL` its environment carried, before
  the new application build was proven, with no locking across concurrent
  deployments. A failed build would leave the old production app running
  against the newer schema.
- Action taken: `web/vercel.json` deleted in commit `a1031cc`, restoring the
  default `npm run build` used by the first successful deployment. No
  history rewrite; no applied migrations rolled back.
- Replacement plan: BUILD_PLAN.md gate 0.12 — a serialized release migration
  job with database-identity checks, locking, backup/readiness checks,
  expand-contract migrations, and post-migration verification.

## Resolved by Claude, 2026-07-29 morning session

### A-026 - Raw vault and ZIP staged for the first commit

Unstaged `Bible-Brain/` and `Bible-Brain-Vault.zip` before any commit existed
(repo had zero commits — nothing had actually been pushed yet, only staged).
Added both to `.gitignore` with an explanation, so a future `git add -A`
cannot silently restage them. This is the actual personal content; a private
repo doesn't fully neutralize putting it on a third-party server, so it needs
Ken's explicit, separate decision (a scoped backup repo, if he wants one) —
not a default. First commit is code, docs, and empty vault templates only.

### A-006 - Parallel reader ignores mapped target references

Rewrote the Spanish-loading path in `ChapterReader.tsx`: `spanishChapters` is
now a map keyed by Spanish chapter RefKey (not a single fetched chapter), and
a new effect loads every chapter any `alignedRows[].toKey` points into —
almost always just the natural same-numbered chapter, plus the divergence
target on Romans 14/16. Rendering resolves each row's actual text via
`resolveSpanish(row.toKey)` (parse the key, load the right chapter, index the
right verse) instead of `spanishVerses[loopIndex]`. Verified: the mapped target
keys for Spanish 14:24-26 are now consumed by the renderer and the underlying
text was independently confirmed present earlier the same session
(`check_romans.py`). A full browser-level regression test per Codex's
suggestion ("test exact text pairings in both directions") is still worth
adding — not done tonight, tracked in `PROGRESS.md`.

The separate gap-ordering and offline fail-open defects remain under
A-035/A-036.

### A-008 - Mountain labels answered questions as open

`lib/vault/seed.ts::getMountain()` now only counts `entry.kind === "question"
&& !entry.answeredAt`, matching `getReview()`'s own definition.

### A-002 - Cache write failure blocks a successful network read

`lib/bible/loader.ts::fetchWithCache()` — `cache.put()` is now fire-and-forget
with its own `.catch()`, outside the `try` that guards the network fetch. A
successful read returns even if storage is full or unavailable.

### A-003 - Dynamic viewport unit is overridden

Swapped the declaration order in `shell.module.css` — `100vh` first as
fallback, `100dvh` after, so the later (correct) one wins.

### A-033 - Spanish Scripture is not marked as Spanish

Both reader columns and the single-version view now carry a `lang` attribute
derived from the actual selected version's declared language (`lib/contracts
.ts::VersionMeta.language`), not a hardcoded assumption — the Spanish column
is always `lang="es"`.

### A-034 - Climb call-to-action nests a button inside a link

`ClimbHero`'s CTA was `<Link><Button>…</Button></Link>` — two nested
interactive elements. Removed the `Button` wrapper; the `Link` itself now
carries the primary-button visual styling directly, so there's exactly one
interactive element.

### A-025 - Review bars did not open the Sunday-review thread workflow

Each Review thread row is now a real link to `/threads/{slug}`, exposing the
existing thread-detail workflow. Source inspection, typecheck, lint, and the
production build pass. A browser interaction test remains desirable but the
previous unreachable-navigation defect itself is closed.

## Resolved while auditing

### A-015 - Master status claims were stale and overstated verification

Codex updated `BUILD_PLAN.md`, `PROGRESS.md`, and `web/README.md` to distinguish
implemented work from open verification/deployment gates, record the current
Track B surfaces and database seeder, and replace the stale audit status with
the current zero-vulnerability result.

### A-024 - Settings route had no navigation entry point

Claude's current `ClimbHero` includes a focusable link to `/settings`. The route
is reachable from the Climb home screen.

### A-012 - Reader integration point for the write path

Claude wrapped the reader content in Track B's `StudySession` with the
canonical chapter key. The read-before-write transition, local progress mark,
capture, entry list, and daily loop are now reachable from the reader.

### A-001 - English to Spanish gap row was unreachable

Claude corrected the direction condition and scoped the inserted gap keys to
the requested chapter. The Romans 16 regression now passes; the current full
suite is 35/35.

### A-007 - Reader lint failures

Claude refactored the synchronous effect resets. `npm run lint` is clean.

### A-005 - Reader used an undeclared index field

Claude added `spanishNames?: Record<string, string>` to `BibleIndex`.
`npm run typecheck` is clean.

### A-000 - SBL missing from shared contract

Claude added `SBL` to `VersionId` and added the language metadata field after
registering the version in `index.json`. The shared data and TypeScript contract
now agree.
