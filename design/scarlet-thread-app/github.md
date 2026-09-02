repo: kennybhill7/scarlet-thread
branch: master
path: design/, web/

## Last sync

date: 2026-09-02T17:13:08Z
commit: 6069af5c613e

### Updated in this project
- Answered `design/MOUNTAIN_IMPLEMENTATION_GAP.md` with section 14 "The Switchback" in `Scarlet Thread App.dc.html` — picks Direction 1 (real image assets) and specifies what the code lays interactive elements onto.
- Found the blocking issue the gap doc missed: `climb-vista.png` has the rope AND all eleven numbered pins painted into it, so it cannot serve as an interactive plate at any fidelity. Art must be re-rendered terrain-only.
- Specified five elevation-band plates stacked vertically (band = the reflow unit), waypoints addressed as (band, x%, y%) never absolute pixels, and the rope as one three-stroke SVG path (shadow + gradient face + highlight) spanning all bands.
- Cut working band crops into `assets/bands/` so the structural work is unblocked now and the finished plates drop in behind it without a code change.

## Screen map

| Screen / design | Built from |
|---|---|
| Scarlet Thread App.dc.html | web/app/globals.css, web/components/shell/TabBar.tsx, web/app/(app)/page.tsx, web/components/climb/Mountain.tsx, web/components/notes/DailyLoop.tsx, web/components/workspace/*, web/components/ui/{Button,Chip,Field,Sheet}.module.css, Daily Study Guide.md, design/reference/mood stills |
| The Climb.dc.html | Ken's uploaded Climb render, design/reference/mood/stills/*, design/MOUNTAIN_JOURNEY_BRIEF.md, web/app/globals.css, Daily Study Guide.md |
| Mountain Journey Directions.dc.html | design/MOUNTAIN_JOURNEY_BRIEF.md, design/reference/*.dc.html, web/components/climb/Mountain.tsx, web/lib/theme.ts |

## Sync history

- 2026-09-01T19:31:18Z — built the full UI/UX handoff package (14 sections, mobile + desktop, redlines); replaced the navy/gold shell with stone + scarlet sampled from the films.

- 2026-09-01T13:27:57Z — commit 6fe47977b593. Pulled mood stills; built The Climb desktop frame with 11 live waypoints and per-stage scenes.
- 2026-09-01T12:36:47Z — first read of the repo; three Mountain directions built; proposed `--shell-crimson: #d9615f`.
