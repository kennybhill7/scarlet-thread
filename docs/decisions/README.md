# Architecture decision records

Short, dated records of decisions that shape the code. Each one names the code it is grounded in, so it can be checked and can go stale visibly.

| # | Record | Status |
|---|---|---|
| 0001 | [Scarlet Thread is a teaching app, not a theology app](2026-08-18-teaching-not-theology.md) (predates the numbering; file not renamed because other documents link to it) | Adopted |
| 0002 | [The assertion line](0002-assertion-line.md) | Accepted |
| 0003 | [One write path: IndexedDB outbox, then sync push](0003-one-write-path-and-outbox.md) | Accepted |
| 0004 | [Curated tables and personal tables are different kinds of table](0004-curated-vs-personal-tables.md) | Accepted |
| 0005 | [Content release pipeline](0005-content-release-pipeline.md) | Accepted |
| 0006 | [Place layer is 2D (d3-geo + static relief), not CesiumJS](0006-place-layer-2d-not-cesium.md) | Proposed |

Format: context, decision, consequences. Add a new number; never rewrite an accepted record, supersede it with a new one.
