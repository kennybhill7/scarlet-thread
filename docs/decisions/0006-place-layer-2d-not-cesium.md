# ADR 0006: Place layer is 2D (d3-geo + static relief), not CesiumJS

- Date: 2026-09-25
- Status: Proposed (Ken's decision #3 in `design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md`, section I; recommended, not yet accepted)

## Context

Ken wants a place/data layer for Scripture with the feel of a turnable earth you fly through (a "God's Eye View" style globe). CesiumJS-class 3D is the obvious way to build that. The app today has no map, chart or 3D dependency (`web/package.json`), a tested `connect-src 'self'` CSP (`next.config.ts`, `tests/security-headers.test.ts`), and an offline-first Bible reader.

## Decision (proposed)

Build the place layer as sourced, confidence-labelled 2D/2.5D geography:

- An orthographic SVG globe with real coastlines (d3-geo over public-domain Natural Earth) that spins using the drag/inertia code already in `components/opening/Globe.tsx`, zooming into a static public-domain relief basemap. No tile server, no keys.
- Places compile into the same release bundle and `catalog_releases` pipeline as lessons (ADR 0005), as curated tables (ADR 0004): `places`, `place_candidates`, `place_passages`, `lesson_places` (plan section C.1). Confidence is geometry and rules (unlocated means no coordinates; disputed means candidates shown), enforced at build time.
- Guided tours are JSON camera paths over the same 2D map, every step a button.
- Budget: lens chunk at most 80 KB gzipped; optional offline map download about 1.5 MB (plan estimates, unmeasured).

CesiumJS or any 3D terrain globe is out of V1. If a desktop fly-through is still wanted afterwards, it is a lazy-loaded module of the separate immersive edition only.

## Reasons (from the plan, sections A.4 and C.5; estimates, not measurements)

- Weight: Cesium would add roughly 3 MB of JavaScript plus WebAssembly workers to an app whose whole bundle is currently smaller than one scene PNG.
- Network and CSP: Cesium terrain and imagery need an account, a token and live network, which breaks offline-first and `connect-src 'self'`.
- Devices: it is the only surface that would need a GPU on a phone.
- Honesty: photoreal terrain pins at disputed sites (Mount Sinai) manufacture false precision, the risk the plan's theology audit warns about.
- Licences: OpenBible.info geocoding data is CC BY 4.0 and needs visible attribution; Natural Earth and NASA relief are public domain.

## Consequences

- Loses photoreal terrain; keeps offline use, the CSP, phone performance and the honest-uncertainty story.
- Adds a build-time data-quality bar (ranges bounds-checked against the corpus, tier rules) that hand-placed 3D markers would not get.
- Nothing here is built. The globe prototype under `design/globe-exploration/` is data only, uses OSIS references that do not match the app's `CanonicalRangeV1`, and has no renderer.
- WebGL scenes were paused by Ken on 2026-09-03 and stay paused. If this record is accepted, that pause remains in force for V1.
- The numbers above come from the plan, not from a bundle measurement (no bundle analyzer output exists in the repo). Verify before relying on them.
