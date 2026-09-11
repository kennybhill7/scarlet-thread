/**
 * Curated cross-reference graph contract — GRAPHEDGES-001.
 *
 * BUILD_PLAN.md §3.3, "Curated (no userId; `/content` is the single
 * authoring source)": `graph_edges` is "the reviewed canonical graph...
 * Personal overlays stay in `user_connections`; they are never written
 * here." This module types that curated side plus the minimal `sources`
 * table §3.3 also lists (id, author, title, publisher, url, licence,
 * accessedAt) — kept intentionally small: it is NOT the full
 * sources+citations+content_reviews pipeline §5.1 describes, which is
 * separate, larger, not-yet-started infrastructure.
 *
 * Reuses `CanonicalRangeV1` (`lib/contracts/range-v1.ts`) and the existing
 * `ConnectionType`/`EvidenceLabel` vocabulary (`lib/contracts/study-v2.ts`)
 * exactly as `userConnections` does — no new enum, no new range shape.
 *
 * Plain TS types only, like every other module in `lib/contracts/` — no
 * Drizzle, no DB, no fetch. `db/schema.ts` builds the real tables from
 * these shapes; `lib/db/graphEdges.ts` is the repository layer.
 */

import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { ConnectionType, EvidenceLabel } from "@/lib/contracts/study-v2";

/**
 * A real bibliographic source, seeded once per curated dataset imported
 * (CC BY 4.0 requires attribution — this is a legal/ethical requirement,
 * not decoration). `accessedAt` is an ISO-8601 timestamp string, matching
 * this schema's other timestamp columns (`mode: "string"` throughout
 * `db/schema.ts`).
 */
export interface GraphEdgeSourceV1 {
  id: string;
  author: string;
  title: string;
  publisher: string;
  url: string;
  licence: string;
  accessedAt: string;
}

/**
 * One curated, reviewed connection between two passages. Unlike
 * `userConnections`, this carries no `workspaceId`/`userId` — curated
 * content is architecturally different (BUILD_PLAN §3.3: "read-only release
 * indexes, never independently edited") — and no soft-delete: a correction
 * ships as a new release, not a mutation of this row.
 *
 * `communityVotes` preserves the source dataset's real vote count so the
 * app can filter/rank by confidence at query time, rather than one
 * import-time cutoff baking in a single arbitrary threshold.
 */
export interface GraphEdgeRecordV1 {
  id: string;
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
  type: ConnectionType;
  evidenceLabel: EvidenceLabel;
  sourceId: string;
  communityVotes: number;
  createdAt: string;
}
