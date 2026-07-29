# Bible Brain — Master Build Plan

**Owner:** Kenneth Hill · **Started:** 2026-07-28 · **Target host:** Vercel (Hobby, $0) + Neon Postgres (free)
**Two builders in parallel:** Claude Code (Track A — read path) and Codex (Track B — write path)

---

## 1. What already exists, and what it's worth

| Artifact | State | Verdict |
|---|---|---|
| `Bible-Brain/` vault | 39 notes, 11 stages, 10 threads, 96 links | **Keep as canon.** Verified: 0 broken links, all 11 mirror pairs bidirectional |
| `Daily Study Guide.md` | The 25-minute loop, the one rule | **Keep as product spec.** This is the app's behaviour model, not just docs |
| `dashboard-concepts.html` | Three phone UIs | **Keep as design source.** Port "The Climb" shell + "Notecards" reader |
| `Bible-Brain-Map.html` + `build_map.py` | Generated analytics | **Port into the app** as the Review screen; retire the standalone file |
| `web/public/bible/` | BSB, KJV, ASV, YLT, SBL | **Done.** 5 versions, 4 × 1,189/31,102 (English, exact canon match) + 1 × 1,189/31,103 (Spanish — see below) |

### What the guide gets right — do not "improve" these

- **The one rule.** Every passage note links a thread; every thread links back. Everything else is optional.
- **Read before you write.** Ten minutes with the phone face down, then the note. The app must not invert this.
- **Observations, not summaries.** "The serpent misquotes God and she corrects him by adding to it" beats "Genesis 3 is about the fall."
- **Threads on the third sighting.** Not the first. Prevents 400 stubs.
- **Falling behind is not a reset.** No streak-shaming, no "you missed 11 days" modal. Ever.

### What the guide works around, and the app should fix

| Guide says | Because Obsidian can't | App does instead |
|---|---|---|
| "Go add the line back in the thread note too. Both directions, every time." | No enforced backlinks | **Linking is one action.** The reverse entry is written automatically — the rule becomes impossible to skip |
| "Don't pre-create empty chapter notes — clutter makes you feel behind" | Empty files look like debt | Notes are rows, not files. 1,189 chapters exist as *addresses*; only written ones render |
| "Open Graph view, look for a thread with a lot of lines" | Graph view is unreadable | Review screen computes it — sorted bars, already built in `build_map.py` |
| "Look for orphans — connect them or delete them" | Manual scan | Computed weekly, already built |
| "Sketch in Notes, paste the link under `## Ink`" | Obsidian can't draw | Keep exactly as-is. **Do not build a drawing tool.** iPad Notes with a pencil beats anything we'd ship |

### Defects to fix on port

1. `dashboard-concepts.html` loads Google Fonts from a CDN — **breaks offline.** Self-host via `next/font/google`.
2. Two CSS typos in the mockup: `color:#b9b6 af` and `color:#3a4karp`. Both dead declarations.
3. Fixed `390px` phone frame — must become responsive (phone → iPad → laptop).
4. All numbers in the mockup are sample data with no model behind them.
5. `03 People/` notes (Abraham, David, Noah) are **orphans** — no links in or out. Fix during import.
6. **Open decision:** `Gen 01-02 — Creation.md` prose says "top of the left side… mirror at the bottom right," but frontmatter says `stage: 1, side: ascent`, which puts Creation at the *bottom* left climbing to Jesus at the peak. Map was built from frontmatter. Ken to confirm orientation before the Climb screen is finalised. **Still open** — the live Climb screen was shipped from the frontmatter reading; the elevation math is isolated in `elevationOf()` in `components/climb/Mountain.tsx` specifically so this stays a one-line change.

### Spanish — added after the initial plan, same evening

Ken asked for a Spanish parallel edition for fluency practice, wants to be able to hear pronunciation, and does not want to sound like he learned Spanish from a 1611-era text. Sourced and shipped:

- **SBL — Santa Biblia libre Latinoamericano.** Public domain, Latin American dialect, modern
  vocabulary, redistributable per eBible.org's catalogue. Rejected: Reina-Valera 1909 (archaic,
  `vosotros` forms — demoted to a documented fallback, never the default); RVR1960, NVI, LBLA
  (all actively copyrighted, same wall as the NIV).
- eBible ships **USFM**, not JSON — `tools/build_spanish.py` is its own parser, independent of
  `build_bible.py`.
- **Versification checked, not assumed.** 1,187 of 1,189 chapters align 1:1 against BSB. Romans 14
  and 16 diverge — this edition places Paul's closing doxology at 14:24-26, where English editions
  place it at 16:25-27 (textual tradition, not a translation error). Encoded in
  `web/public/bible/versemap.json`, consumed by `lib/bible/versemap.ts::alignChapter()`, and
  **unit-tested** (`web/tests/versemap.test.ts` — written by Codex, catching a real bug in the
  Track A code it was testing; see `PROGRESS.md` "Cross-track collaboration notes").
- Pronunciation: Web Speech API (`speechSynthesis`, `es-MX`), not bundled audio — works offline,
  zero bytes. Not yet wired into the reader UI.
- Concordance-over-dictionary: planned as a from-the-corpus-itself word index rather than an
  external dictionary dependency. Not yet built.

---

## 2. Architecture

**Local-first PWA.** The app works fully offline; the network is an optimisation, never a requirement.

```
Bible text    static JSON on CDN ──► Cache API ──► instant, offline, immutable
Your writing  IndexedDB (source of truth on device) ──► sync queue ──► Postgres ──► other devices
Vault         markdown ──► one-time import ──► and a permanent export path back out
```

**Why local-first:** you study at 6am on a phone with bad signal. A round-trip to read Genesis 3 is a broken product. Also makes the Vercel→anywhere migration cheap.

**Decisions made:**

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16.2 / React 19.2 | Already scaffolded; Vercel-native |
| Styling | Plain CSS + custom properties | Mockup is hand-written CSS; Tailwind would lose fidelity for no gain |
| Local store | IndexedDB via `idb` | Notes, sync queue, reading progress |
| Bible cache | Cache API via service worker | Immutable per-book files; cache-first forever |
| DB | Neon Postgres (Vercel integration) | Free tier, serverless, scale-to-zero |
| DB access | Drizzle ORM | Typed, migration-friendly, small |
| Auth | Auth.js v5, Google provider | Ken has a Google account; no password to manage |
| Sync | Last-write-wins per note, `updatedAt` | Single user across devices — conflict risk is near zero. Do not build CRDTs |

**Non-negotiable:** the app is auth-gated from the first deploy. A study journal on a guessable public URL is not acceptable at any stage, including "just testing."

### Next.js 16 breaking changes — read before writing app code

`web/AGENTS.md` is right: this is not the Next.js in your training data. Verified against
`web/node_modules/next/dist/docs/`:

| Change | Detail |
|---|---|
| **`middleware.ts` → `proxy.ts`** | Renamed in 16. Project root, `proxy` named or default export. Both tracks must use the new convention |
| **Async request APIs are mandatory** | `cookies()`, `headers()`, `draftMode()`, and `params` / `searchParams` must be awaited. The v15 sync compatibility shim is gone |
| **Turbopack is the default** | For both `next dev` and `next build`. A stray webpack config now *fails* the build |
| **`turbopack` config is top-level** | No longer `experimental.turbopack` |
| Type helpers | `PageProps<'/route'>`, `LayoutProps<'/route'>`, `RouteContext` — generate with `npx next typegen` |
| Floors | Node 20.9+, TypeScript 5.1+ |
| `next lint` removed | Use the ESLint CLI |

---

## 3. Parallel split — file ownership is the contract

> **Prerequisite: `git init` before either track starts.** Two agents editing one folder without version control will destroy each other's work. Branch per track, merge at phase boundaries.

Ownership is exclusive. If you need a file you don't own, request the change — do not edit it.

### Track A — Claude Code · the read path

```
tools/**                          build_bible.py, build_spanish.py, import_vault.py
web/scripts/**                    build-time Node tooling (icon generation — needs sharp,
                                   which only resolves from web/node_modules)
web/lib/bible/**                  book loading, reference parsing, versemap alignment
web/lib/vault/**                  server-only seed reader (the Track A/B bridge — see PROGRESS.md)
web/lib/offline/**                service worker registration, cache strategy
web/app/(app)/page.tsx            home screen — the mountain (root "/", NOT "/climb" —
                                   avoids a redirect hop; TabBar still labels it "Climb")
web/app/(app)/read/**             reader routes
web/app/(app)/review/**           Sunday review — port of build_map.py (reads seed data;
                                   migrate to GET /api/review once Postgres is connected)
web/app/(app)/settings/**         offline-download management
web/app/manifest.ts, app/icon.png, app/apple-icon.png
web/components/reader/**
web/components/climb/**
web/components/settings/**
web/components/shell/**           TabBar, ServiceWorkerRegistration
web/public/**                     bible data, manifest, icons, sw.js
web/next.config.ts
```

### Track B — Codex · the write path

```
web/db/**                         Drizzle schema + migrations
web/lib/db/**                     queries (includes review.ts — the live-DB ReviewSnapshot)
web/lib/sync/**                   sync engine, conflict resolution, queue drain
web/lib/auth/**                   Auth.js config
web/lib/export/**                 markdown/zip vault export
web/proxy.ts                      route protection — NOT middleware.ts, see below
web/app/api/**                    every route handler
web/app/(auth)/**                 sign-in
web/components/notes/**           observation/question capture, editor, daily loop
web/components/threads/**         thread picker/creator, backlink writer, thread detail
web/tests/**                      test suite (node --test) — crosses both tracks' files on
                                   purpose; this is deliberately not exclusive territory
```

### Shared — Claude Code writes first, then frozen

```
web/lib/contracts.ts              all shared types. THE interface between tracks
web/styles/tokens.css             colour, type, spacing
web/app/globals.css
web/components/ui/**              Button, Sheet, Field, Chip
```

Changes to shared files after Phase 0 require both tracks to agree. Treat `contracts.ts` as an API.

---

## 4. Phases

### Phase 0 — Foundation · Claude Code alone · BLOCKS EVERYTHING — ✅ COMPLETE

- [x] Bible data pipeline — 5 versions (4 English + Spanish), canon-validated
- [x] `contracts.ts` — extended twice since, additively, without breaking Track B's code
- [x] Design tokens ported from `dashboard-concepts.html` (dark Climb shell + light Notecards page,
      plus a night-reading mode the mockup didn't have)
- [x] Fonts self-hosted via `next/font` (Fraunces, Archivo, Archivo Narrow, Spectral, Inter)
- [x] App shell, routing skeleton, `ui/` primitives
- [x] `git init`, `.gitignore` (excludes `tools/.cache/` and `web/data/seed/` — the latter added
      once seed data existed and turned out to contain real personal content)

**Exit met:** shell renders, both tracks unblocked and did in fact work in parallel.

### Phase 1 — Core loop · parallel — implemented, verification gates open

| Track A | Track B |
|---|---|
| Reader: book/chapter nav and 5-version switcher implemented; mapped Spanish rendering and verse selection open | ✅ Drizzle schema + Neon connection |
| Bible loader + Cache API implemented; unvisited-route offline navigation remains open | ✅ Auth.js Google sign-in, proxy.ts gate |
| Service worker, PWA manifest, and icons implemented; install/offline soak not yet verified | ✅ Notes CRUD API |
| ✅ Climb home screen with real progress (seed-derived; DB migration pending) | ✅ IndexedDB ↔ Postgres sync engine, tested |
| Vault importer (38 notes → seed JSON); fidelity findings remain in `CODEX_AUDIT.md` | ✅ Observation / question capture UI with read-first gate and required thread link |

**Exit not met:** auth/sync are implemented but not verified against real Neon/OAuth. An unvisited
dynamic chapter route still fails offline even when its book JSON is cached, and divergent
parallel text is not yet rendered by mapped target key. See A-006 and A-013 in `CODEX_AUDIT.md`.

### Phase 2 — The brain · parallel — mostly done

| Track A | Track B |
|---|---|
| ✅ Mountain screen with mirror ties (port from `build_map.py`) | ✅ Thread picker/creator + automatic bidirectional linking + thread detail/backlinks |
| Review screen: thread bars and mirror integrity; database/orphan/thread-detail integration open | Verse-anchored note contract exists; reader verse-selection integration is still open |
| Reading plan: wide gear tracker, 1,189-chapter grid — **not built** | ✅ Markdown export back to the vault (`GET /api/export`, zip, tested) |
| Full-text search across 31,102 verses — **not built** | ✅ Daily log + five-step loop UI, local queue, and sync |

**Exit not yet met:** the daily loop is wired end to end, but verse selection, database-backed
Review/Climb, wide gear, search, and the audit integration items remain.

### Phase 3 — Ship · together — not started, blocked on Ken

- Deploy to Vercel, connect Neon, set env vars — **needs Ken's accounts, see §6**
- `npm audit` — currently zero vulnerabilities with targeted transitive overrides; keep build,
  lint, test, and Drizzle checks as the compatibility gate.
- Lighthouse PWA pass; install on phone and iPad — manifest/icons/SW are built, not yet tested on
  a real device (needs a live HTTPS deploy; localhost PWA install is unreliable to test from)
- Offline soak test: airplane mode, full daily loop
- Seed the real vault: `py tools/import_vault.py` produces `web/data/seed/*.json`; Track B's
  `db/seed.ts` loads it after first sign-in, but must not run until importer fidelity and orphan
  findings are repaired.

---

## 5. What we are deliberately NOT building

Each of these is a place this project could die.

- **A drawing tool.** Ink stays in Apple Notes, linked. Stated in the guide; it's right.
- **Commentary, or any AI "explain this verse" feature.** The vault's value is that the observations are *his*. Generated insight is exactly the book-to-read-instead-of-a-brain-to-build failure the guide warns about.
- **Copyrighted translations.** NIV, ESV, NASB, NKJV, CSB cannot be redistributed. ESV is possible later only via Ken's own API key. The Maxwell Leadership Bible's notes are Maxwell's work and are never reproduced — we build the same *structure* with Ken's own content.
- **Social features.** No sharing, no accounts beyond his own.
- **Streaks that punish.** Show the number; never guilt.
- **CRDTs or offline conflict UI.** Single user, last-write-wins.

---

## 6. Open items for Ken

1. **Mountain orientation** — confirm the Gen 1–2 prose vs frontmatter discrepancy (§1.6). Still
   open; the live screen ships with the frontmatter reading.
2. **Vercel account** — create it, then connect the Neon Postgres integration.
3. **Google OAuth** — create credentials in Google Cloud Console; needed for sign-in.
4. **GitHub push** — repo is initialized; 502 files are staged and 25 newer Track B files remain
   untracked locally. Nothing has been pushed. The staged set still includes the raw personal
   vault and ZIP, so it is not safe to push until Ken chooses the repository/privacy model.
   A push is required before Vercel can deploy and before a scheduled cloud agent can work from
   the repository.
5. **Deep gear book 5** — 1 Samuel or Acts. Not needed until the reading plan screen (not built).

See `PROGRESS.md` for the live status, what's been verified, and exactly what the next session
(any of: Claude Code, Codex, or a cold resume) should pick up first.
