# Progress — resume point

**Purpose:** any builder (Claude Code after a session reset, a scheduled agent, or Codex) reads
this file plus `BUILD_PLAN.md` and continues without re-deriving anything. Update it as work
lands, not at the end.

**Last updated:** 2026-07-29 morning · by Claude Code (Track A), responding to the audit below

---

## Morning session addendum — Claude's response to CODEX_AUDIT.md

Fixed six of the audit's findings, all verified (35/35 tests, clean build — see
`CODEX_AUDIT.md`'s "Resolved by Claude" section for what changed in each): **A-026** (critical —
the raw vault and `Bible-Brain-Vault.zip` were staged for the first commit; no commit existed yet
so nothing had actually leaked, but it was one `git commit` away — both are now hard-excluded in
`.gitignore`, and that exclusion should not be relaxed without Ken making a separate, explicit
decision about it), **A-006** (critical — the parallel Spanish reader computed the correct
Romans 14/16 cross-chapter mapping via `alignChapter()` and then silently ignored it, rendering by
loop position instead of the resolved `toKey` — rewritten to load every chapter an aligned row
actually points into and resolve text by reference), A-002, A-003, A-008, A-033, A-034.

Ken has authorized pushing to GitHub now that Vercel access is confirmed, and shared that he was
removed from his CPA/CMA program — this app is now his daily-hour priority, not a side project
competing with Accountrix for evenings. Treat it as the primary active build going forward.

**Remaining open findings, not fixed this session:** A-009/A-011 (the seed bridge should become
live-DB-backed instead of build-time JSON — the largest architectural item open), A-010, A-013,
A-014, A-017, A-020 through A-023, A-027/A-028, A-029, A-030, A-031, A-032. None of these block a
private-repo push of code; several block opening this to real production use once Neon is
connected. `CODEX_AUDIT.md`'s own "Recommended recovery order" is the triage sequence to follow.

---

## Where things stand — the app runs

`npm run build` produces a clean production build. `npm test` — 35/35 pass. `npx tsc --noEmit`
and `npx eslint .` both clean across the full tree (both tracks). Verified live tonight with a
real production server and placeholder non-secret auth configuration: protected pages redirect
to `/sign-in`, and protected APIs return 401 without a session.

Track B's migrations were also applied in order to an isolated PostgreSQL 18 cluster.
`tests/db-invariants.sql` passed, including atomic restore-and-relink. Two-session race tests
proved both outcomes for backlink/retirement and restore/retirement: whichever valid operation
commits first is preserved and the conflicting operation fails closed. A fresh six-migration run
also proved that a backlink insert waits on a concurrent entry deletion and then fails closed
rather than linking a deleted entry. The temporary clusters were stopped and removed after
verification.

**This is not deploy-ready yet.** Vercel, Neon, and Google OAuth are user-only blockers, but
`CODEX_AUDIT.md` also records unresolved code/data gates: private seed-backed static pages,
offline navigation, parallel-text rendering, importer fidelity, and staged raw journal files.

## Decisions locked

| Decision | Value |
|---|---|
| Host | Vercel Hobby ($0) + Neon Postgres free tier |
| Framework | Next.js 16.2.12 / React 19.2.4, App Router, TypeScript, no Tailwind |
| Styling | Plain CSS + custom properties (mockup fidelity) |
| Look | "The Climb" dark shell (home, mountain, review, settings) + "Notecards" light reading pane (reader only) |
| Routing | Root `/` IS the Climb screen (not `/climb` — avoids a redirect hop). `/read`, `/review`, `/settings` are the other three surfaces |
| English versions | BSB (default), KJV, ASV, YLT — all built and validated |
| Spanish version | **SBL — Santa Biblia libre Latinoamericano** (public domain, Latin American dialect, modern). 66/66 books, 1,189 chapters, 31,103 verses |
| Spanish alignment | 1,187/1,189 chapters align 1:1. Romans 14 & 16 diverge (doxology placement) — encoded in `versemap.json`, consumed by `lib/bible/versemap.ts`, **unit-tested** (`tests/versemap.test.ts`) |
| Pronunciation | Web Speech API (`speechSynthesis`, es-MX) — not yet wired into UI, planned |
| Auth | Auth.js v5 + Google, fail-closed to one verified email via `AUTH_ALLOWED_EMAIL`. Route protection via `proxy.ts` (Next 16 renamed `middleware.ts`) |
| Sync | IndexedDB (`idb`) local-first → Postgres, last-write-wins on `updatedAt`. Built and tested |
| Notes | All text lives in the app. Apple Notes is ONLY for ink/sketches, linked by URL |
| Seed bridge | `web/data/seed/*.json` (gitignored — contains real personal content) is the vault import. NOT in `web/public` — see "Seed bridge" below |

## Open — needs Ken

1. **Mountain orientation.** Still unresolved. `Gen 01-02 — Creation.md` prose says Creation is
   "top of the left side," frontmatter says `stage: 1, side: ascent` (bottom-left, climbing to
   Jesus at the peak). The live Climb screen was built from the frontmatter reading — geometry is
   isolated in one function, `elevationOf()` in `components/climb/Mountain.tsx`, exactly so this
   stays a one-line change if Ken means it the other way.
2. **GitHub push.** `gh` is authenticated as `kennybhill7` (repo + workflow scope). Not pushed —
   personal journal to a third-party server is Ken's call. The index currently stages 502 files,
   including the raw vault and ZIP, and 25 newer Track B files are untracked. Do not push this
   state. A reviewed code-only index or an explicitly approved private-backup model is required.
3. **Vercel account + Neon integration + Google OAuth credentials.** Blocks going live. Everything
   that doesn't need them is done and verified locally.
4. **Deep gear book 5** — 1 Samuel or Acts. Not needed until the reading-plan screen (not built yet).

## Seed bridge — read before touching `web/data/seed/` or `web/lib/vault/seed.ts`

`tools/import_vault.py` converts the Obsidian vault into `web/data/seed/{stages,threads,people,
entries}.json`. This is real personal content (Ken's actual observations and questions) — it is
gitignored and lives outside `web/public` on purpose: a Next.js **client** bundle importing it
would ship the raw text into an unauthenticated `/_next/static/` JS chunk, regardless of proxy.ts
page gating, because static assets aren't page navigations. `lib/vault/seed.ts` enforces this at
the type level with `import "server-only"` — a client component importing it is now a build error,
not just a code-review catch.

The Climb and Review screens read this seed data directly (via `getMountain()` / `getReview()` in
`lib/vault/seed.ts`) rather than the database, because Postgres isn't connected yet. **This is a
bridge, not the destination.** Track B's `stages`/`threads`/`entries`/`people` tables already
exist and are the intended home. Codex has *already built the live-DB successor* to my `/review`
page: `GET /api/review` → `getReviewSnapshot()` in `lib/db/review.ts`, correctly typed against
`contracts.ts`'s `ReviewSnapshot`. Once Neon is connected and the local seed script loads
`web/data/seed/*.json` into Postgres for Ken's user row, `/review` should call `/api/review`
instead of `getReview()`, and `/` (Climb) should do the equivalent. Track B's
`web/db/seed.ts` implements the JSON-to-Postgres load after the first allowed Auth.js user exists.
Do not run it until the importer fidelity findings in `CODEX_AUDIT.md` are repaired.

Vault re-import: `py tools/import_vault.py` (11 stages, 10 threads, 5 people, 70 entries — 52
observations, 18 questions — zero warnings, every stage resolved a chapter anchor).

## Known facts (verified, don't re-check)

- All 4 English translations: exactly 1,189 chapters / 31,102 verses. Canon match confirmed.
- Spanish (SBL): 66/66 books, 1,189 chapters, 31,103 verses. Divergence located and resolved
  (Romans 14/16 doxology placement — textual tradition, not translation). Encoded in
  `versemap.json`, unit-tested, **a real bug in the gap-row logic was caught by Codex's test and
  fixed tonight** (the push was gated on an inverted condition — `fromVersion === "SBL"` instead
  of the already-correctly-scoped `gapKeys`). All 35 tests pass as of this update.
- Vault: 38 notes, 11 stages, 10 threads, 96 links, 0 broken links, all 11 mirror pairs valid.
- Vault orphans: Abraham, David, Noah (`03 People/`) — still no links in or out (unchanged since
  the importer just carries this through; fixing it is a vault-writing task, not a code task).
- eBible ships **USFM**, scrollmapper ships **JSON**. Two different parsers — both done.
- `npm audit` currently reports zero vulnerabilities. The lockfile uses targeted overrides for
  the previously flagged transitive PostCSS, Sharp, minimatch, brace-expansion, and esbuild trees;
  build, lint, tests, and Drizzle checks pass with those resolutions.
- Codex CLI is NOT installed locally. Claude Code cannot launch or message it — Ken is the router
  who pastes context between the two. Codex has continued working autonomously in parallel
  throughout this session without further prompting from this side.
- Scheduled Claude agents run in the cloud and cannot reach `C:\Users\kenny\...` — they need the
  GitHub repo to exist first (not pushed yet, see Open #2).
- Next.js 16 breaking changes are documented in `BUILD_PLAN.md` — most load-bearing:
  `middleware.ts` → `proxy.ts` (both tracks independently arrived at this correctly), all request
  APIs (`cookies()`, `params`, etc.) are async-only now.
- `react-hooks/set-state-in-effect` (new React-Compiler-era ESLint rule) fires on any synchronous
  `setState` at the top of an effect body. Fixed in `ChapterReader.tsx` by deriving loading state
  from comparing a request key against the resolved key, rather than setting a literal `{status:
  "loading"}` — the React-recommended pattern, not a suppression. If this rule fires again
  elsewhere, use the same pattern, don't disable the rule.

## Status

### Implemented — Track A (Claude Code; open audit gates above)
- [x] Bible data pipeline — `tools/build_bible.py`, 265 files, 4 English versions, canon-validated
- [x] Spanish pipeline — `tools/build_spanish.py`, USFM parser, versification diff, verse map
- [x] `BUILD_PLAN.md` — architecture, phases, file-ownership split, Next 16 breaking changes
- [x] `web/lib/contracts.ts` — shared types (extended twice tonight: `SBL` added to `VersionId`,
      `language` field, `spanishNames` on `BibleIndex` — all additive, Track B's code kept compiling)
- [x] Design tokens (`app/globals.css`) — dark shell + light "Notecards" page + night-reading mode
- [x] Self-hosted fonts (`app/layout.tsx`) — Fraunces, Spectral, Inter, Archivo, Archivo Narrow
- [x] UI primitives — `components/ui/{Button,Chip,Field,Sheet}`
- [x] App shell — `app/(app)/layout.tsx`, `components/shell/TabBar.tsx` (3 tabs: Climb/Read/Review
      — deliberately not 4; Settings is a header link, not a tab)
- [x] `tools/import_vault.py` — vault → seed JSON, 0 warnings
- [x] Bible loader — `lib/bible/loader.ts`, Cache-API-backed, offline-first, typed errors
- [x] Reference parsing — `lib/bible/reference.ts` (RefKey format, human-input parsing, navigation)
- [x] Verse alignment — `lib/bible/versemap.ts` (bug found + fixed tonight, now tested)
- [x] Reader — `components/reader/{ChapterReader,BookPicker}`, version switcher, night mode,
      Spanish parallel toggle, prev/next navigation
- [x] Climb screen — `app/(app)/page.tsx`, `components/climb/{Mountain,ClimbHero}`, real SVG
      mountain with mirror ties, computed from seed data
- [x] Review screen — `app/(app)/review/page.tsx`, port of `build_map.py`'s thread-strength/
      orphan/mirror-integrity logic, server-rendered from seed
- [x] Settings/offline screen — `app/(app)/settings/page.tsx`,
      `components/settings/OfflineDownloads.tsx` — force-download a translation before a trip
- [x] PWA — `app/manifest.ts`, generated icons (`web/scripts/generate-icons.mjs`, mountain glyph,
      maskable safe-zone), `app/icon.png`/`apple-icon.png` (replaced default Next favicon)
- [x] Service worker — `public/sw.js`, app-shell offline caching (separate from Bible-text caching,
      which loader.ts already handles independently)
- [x] `web/lib/vault/seed.ts` — server-only seed reader, the Track A/B seed bridge

### Done — Track B (Codex), locally verified; real Neon/OAuth verification still open
- [x] Drizzle/Neon schema, 12 tables + six migrations (`web/db/schema.ts`), including
      database-enforced active-entry, active-thread, backlink, and tenant invariants verified on
      PostgreSQL 18
- [x] Auth.js Google sign-in, fail-closed to one verified email (`web/lib/auth/config.ts`)
- [x] Route protection via `web/proxy.ts` (correctly used the new Next 16 convention, independently)
- [x] Entry API: `GET/POST /api/entries`, `GET/PATCH/DELETE /api/entries/:id`
- [x] Thread API: `GET /api/threads`, `GET/PATCH/DELETE /api/threads/[slug]`
- [x] Sync engine: `lib/sync/{store,client}.ts` (IndexedDB), `POST /api/sync/push`,
      `GET /api/sync/pull` — full user snapshot avoids client-clock cursor gaps,
      last-write-wins with server-authoritative timestamp ties, tested
- [x] Capture/edit UI with enforced thread links, third-sighting thread creation, automatic
      reverse edges, question lifecycle, Apple Notes links, and the five-step daily loop
- [x] Thread detail route (`/threads/[slug]`) with editable definition/“What I'm seeing” and
      computed entry backlinks
- [x] Safe sign-out/clear-device, global sync-registration, and browser Markdown-export controls
      are implemented as components and await mounting in Track A's Settings/app layout
- [x] Local authenticated database seed loader (`db/seed.ts`) — blocked from use until importer
      fidelity findings are repaired and the first allowed Auth.js user exists
- [x] `GET /api/review` — live-DB `ReviewSnapshot`, correctly typed against `contracts.ts`. This is
      the destination `/review` (my page) should migrate to once Postgres is connected
- [x] `GET /api/export` — builds a real vault-shaped `.zip` from live DB data (entries, threads,
      people, daily logs) so the app can never lock Ken's writing in — the "not locked in"
      principle from `BUILD_PLAN.md` §5, delivered
- [x] Test suite — `web/tests/*.test.ts` (`node --test`, 35 tests): auth allowlist, entry validation, corpus
      completeness/declared omissions, vault export
      correctness (both directions of the bidirectional link, soft-delete handling, filename
      collision safety), local-store atomicity, sync merge/queue semantics, **and Codex's own test
      against my `versemap.ts` that caught a real bug tonight**
- [x] `.env.example` template

**To activate:** populate `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`AUTH_ALLOWED_EMAIL`, then `npm run db:migrate`. Google callback URL:
`/api/auth/callback/google`.

### Done — the seam, wired tonight
- [x] **The daily loop now runs end to end.** Codex built `components/notes/StudySession.tsx` +
      `DailyLoop`/`EntryList`/`NoteComposer` — a real UI implementation of the guide's "read first,
      phone face down" rule: chapter text renders, then a gate ("I'm finished reading") that only
      then reveals the write UI. No streak-shaming language, matches `BUILD_PLAN.md` §1's "what the
      guide gets right" list exactly. Track A wired it into `ChapterReader.tsx` (wraps the whole
      page as `<StudySession chapter={key}>`) — this is the exact seam the file-ownership split was
      designed to make cheap: Track A imported Track B's component rather than either side editing
      the other's files. Verified: `tsc`, `eslint`, `npm run build`, `npm test` all clean after.

### Not started
- [ ] Mount Track B's Settings controls (`DeviceSessionControls`, `VaultExportButton`) and protected
      app-level `SyncRegistration` in Track A's owned screens/layout.
- [ ] Link Review thread rows to Track B's `/threads/[slug]` detail/edit/backlink route.
- [ ] Repair the open Track A and importer findings in `CODEX_AUDIT.md`.
- [ ] Wide-gear reading-plan screen (1,189-chapter grid, the tracker from the vault)
- [ ] `speechSynthesis` pronunciation wiring in the reader
- [ ] Spanish concordance ("tap a word, see every verse it appears in")
- [ ] Polish: `NoteComposer` shows the raw RefKey ("1.3") as its reference label when no verse is
      selected, rather than a formatted "Genesis 3". `lib/bible/reference.ts::formatRef()` already
      exists for this — Track B's component, Track A's helper; flagging rather than editing across
      the boundary uninvited.

## Cross-track collaboration notes (for whoever reads this next)

Both tracks worked genuinely in parallel tonight with no direct communication channel — Ken is
the router, pasting context between two separate agent sessions. Two things worth knowing about
how that went:

1. **Both tracks independently discovered `proxy.ts` (not `middleware.ts`)** from reading Next
   16's actual docs rather than training-data habit. Neither copied the other.
2. **Codex wrote a real unit test against Track A's code** (`tests/versemap.test.ts`, testing
   `lib/bible/versemap.ts`) without being asked to, and it caught a genuine bug — the gap-row push
   was gated on an inverted condition and silently discarded already-correct data. This is the
   single best argument for the file-ownership-split-plus-shared-contract approach: neither track
   needed to review 100% of the other's code, because the type contract plus cross-cutting tests
   caught the seam. Take this as encouragement to keep writing tests that cross the boundary, not
   just tests scoped to one track's own files.

## For whoever picks this up next

1. Read `BUILD_PLAN.md` §3 for file ownership. Do not edit files another track owns.
2. `web/lib/contracts.ts` is the interface between tracks. Additive changes only — it's been
   extended twice tonight without breaking Track B's code, which is the model to keep following.
3. Run `py tools/build_bible.py` and `py tools/build_spanish.py` if `web/public/bible/` is missing
   (needs network, ~3 min total). Run `py tools/import_vault.py` if `web/data/seed/` is missing.
4. Before changing anything in `lib/bible/versemap.ts`, run `npm test` first — there's now a real
   regression test for the exact bug that existed there tonight.
5. Do not add commentary, AI verse explanations, a drawing tool, or copyrighted translations.
   See `BUILD_PLAN.md` §5 for why each is a way this project dies.
6. `npm run build && npm test` should both be clean before considering any change done. Both were
   clean at the end of this session.
