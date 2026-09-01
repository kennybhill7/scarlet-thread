repo: kennybhill7/scarlet-thread
branch: master
path: design/, web/

## Last sync

date: 2026-09-01T19:31:18Z

### Updated in this project
- Built `Scarlet Thread App.dc.html` — the full UI/UX handoff package: 14 sections, every screen redlined, mobile + desktop, live prototype interactions (thread lens, loop knots, workspace rail).
- Rejected the navy-and-gold shell from `web/app/globals.css` for the language of Ken's films: neutral stone (#07080a → #23272d), warm light (#e8c88a) instead of gold-as-accent, and scarlet (#cf2027) promoted from thread accent to identity colour.
- Proposed component replacements: Button → type-only action row, Chip → square thread tag with a required count, DailyLoop's button row → a vertical rope with knots.
- Section 13 proposes six new features (Mirror Split, question queue, third-sighting prompt, teach pack, two-person mirror, the woven year) plus an explicit not-building list.

## Screen map

| Screen / design | Built from |
|---|---|
| Scarlet Thread App.dc.html | web/app/globals.css, web/components/shell/TabBar.tsx, web/app/(app)/page.tsx, web/components/climb/Mountain.tsx, web/components/notes/DailyLoop.tsx, web/components/workspace/*, web/components/ui/{Button,Chip,Field,Sheet}.module.css, Daily Study Guide.md, design/reference/mood stills |
| The Climb.dc.html | Ken's uploaded Climb render, design/reference/mood/stills/*, design/MOUNTAIN_JOURNEY_BRIEF.md, web/app/globals.css, Daily Study Guide.md |
| Mountain Journey Directions.dc.html | design/MOUNTAIN_JOURNEY_BRIEF.md, design/reference/*.dc.html, web/components/climb/Mountain.tsx, web/lib/theme.ts |

## Sync history

- 2026-09-01T13:27:57Z — commit 6fe47977b593. Pulled mood stills; built The Climb desktop frame with 11 live waypoints and per-stage scenes.
- 2026-09-01T12:36:47Z — first read of the repo; three Mountain directions built; proposed `--shell-crimson: #d9615f`.
