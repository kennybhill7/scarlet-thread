/**
 * CONNREGISTERS-001 — Ken's four connection "registers" (`design/
 * CONNECTIVE_LAYER.md`, "'Thread' is doing too many jobs"), mapped onto the
 * eleven existing `ConnectionType` values (`lib/contracts/study-v2.ts:
 * 125-137`) as a pure, presentation-facing taxonomy — no schema change, no
 * new `ConnectionType` value, nothing new written anywhere.
 * `components/threads/ThreadDetail.tsx`'s `ConnectionsPanel` (the browse/
 * filter list — where this task's actual visual differentiation lives) and
 * `components/workspace/ConnectSection.tsx`'s type-picker chips (a light
 * styling touch only, never its options/logic — see that file's own header)
 * both import this ONE mapping, so the two surfaces can never disagree about
 * which type belongs to which register. Deliberately dependency-free of any
 * CSS Module / component file (plain `.ts`, no React) so importing it from
 * either component never pulls the OTHER component's CSS Module along for
 * the ride — `tests/connect-pane.test.ts` and `tests/thread-detail.test.ts`
 * each seed only their own file's CSS Module stubs, and this file must never
 * force either test to seed the other's.
 *
 * The four registers, and the mapping decision for the seven types Ken's own
 * critique didn't already name (`design/CONNECTIVE_LAYER.md`'s Wave 2
 * "reasonable default", adopted here verbatim, not re-derived):
 *
 *   - motif      -- quotation, explicit_reference, allusion, motif. The
 *                   fine-grained textual-echo noticing layer -- already
 *                   renders as today's plain Chip/tag (Wave 1's square-tag
 *                   redesign already applies). This task changes NOTHING
 *                   for this register; it exists here only so the grouping
 *                   is a real, checkable constant instead of an implicit
 *                   assumption.
 *   - structural -- covenant_development, parallel, contrast_reversal. The
 *                   canon's macro-shape, same family as the app's existing
 *                   curated mirror-ties, which render gold, not scarlet
 *                   (`components/climb/Mountain.module.css` -- read-only
 *                   reference, not touched by this task). ALWAYS ON.
 *   - typology   -- type_antitype only. Directional (shadow -> fulfillment),
 *                   unlike the symmetric registers above. OPT-IN, off by
 *                   default (Ken's 2026-09-01 risk read: theologically
 *                   correct but adds vocabulary a casual daily-loop user
 *                   doesn't need forced on them).
 *   - promise    -- promise_fulfillment only. "The line, not a thread -- it
 *                   earns its own colour" (CONNECTIVE_LAYER.md). OPT-IN,
 *                   same toggle as typology, own gold-toned treatment
 *                   distinct from the structural register's.
 *   - none       -- doctrinal_synthesis, personal_resonance. Deliberately
 *                   left unregistered -- closer to the Theology/Conviction
 *                   claim kinds already in the workspace than to any of the
 *                   four registers; CONNREGISTERS-001 does not invent a
 *                   fifth visual treatment for these.
 */

import { compareRefs } from "@/lib/bible/reference";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { ConnectionType } from "@/lib/contracts/study-v2";

export type ConnectionRegister = "motif" | "structural" | "typology" | "promise" | "none";

export const MOTIF_REGISTER_TYPES: readonly ConnectionType[] = [
  "motif",
  "quotation",
  "explicit_reference",
  "allusion",
];

export const STRUCTURAL_REGISTER_TYPES: readonly ConnectionType[] = [
  "covenant_development",
  "parallel",
  "contrast_reversal",
];

export const TYPOLOGY_REGISTER_TYPES: readonly ConnectionType[] = ["type_antitype"];

export const PROMISE_LINE_REGISTER_TYPES: readonly ConnectionType[] = ["promise_fulfillment"];

/**
 * The one function that decides a type's register — every renderer calls
 * this, never a hand-rolled switch/if-chain of its own, so the mapping can
 * only ever live in one place.
 */
export function registerForType(type: ConnectionType): ConnectionRegister {
  if ((MOTIF_REGISTER_TYPES as readonly string[]).includes(type)) return "motif";
  if ((STRUCTURAL_REGISTER_TYPES as readonly string[]).includes(type)) return "structural";
  if ((TYPOLOGY_REGISTER_TYPES as readonly string[]).includes(type)) return "typology";
  if ((PROMISE_LINE_REGISTER_TYPES as readonly string[]).includes(type)) return "promise";
  return "none";
}

// ---------------------------------------------------------------------------
// Typology direction (register 3, opt-in). `ThreadDetail.tsx`'s own comment
// at its render site documents WHEN this is shown (only behind "Show deeper
// connections"); this is the pure directional rule alone.
// ---------------------------------------------------------------------------

export type TypologyDirection = "from-is-shadow" | "to-is-shadow";

/**
 * DIRECTION RULE: compares `fromRange.start` and `toRange.start` with
 * `compareRefs` (`lib/bible/reference.ts`) — the ONE canonical-order
 * comparator this codebase already trusts for range comparisons ("RefKeys
 * sort correctly as tuples but NOT as strings ... always compare via
 * compareRefs, never with < or >" — that file's own header). No new
 * ordering invented for this task.
 *
 * JUDGMENT CALL, documented rather than hidden: `UserConnection` has no
 * chronological/historical field anywhere in this data model — canonical
 * BOOK order (1-66, Protestant order, the same order `range-v1.ts`'s whole
 * range system is built on) is the only ordering signal that exists. For
 * every `type_antitype` example this app's own design doc names (Passover
 * lamb -> Christ, bronze serpent -> the cross), the type sits in the Old
 * Testament (books 1-39) and the antitype in the New (books 40-66), so
 * canonical order and redemptive-historical order agree. This rule is NOT a
 * certainty for every conceivable type/antitype pair a learner might record
 * (a same-testament or unusually-ordered pair would be mislabeled) — but it
 * is a real, defensible default rather than a coin flip or an invented
 * heuristic, and getting it wrong only swaps which side reads "shadow" vs.
 * "fulfills": the connection and BOTH of its real ranges stay fully visible
 * either way, never hidden — the same "never hide a learner's own data"
 * discipline `ConnectionsPanel` already applies everywhere else. A tie
 * (identical `start`) resolves to `"from-is-shadow"`, arbitrarily but
 * deterministically.
 */
export function typologyDirection(connection: {
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
}): TypologyDirection {
  return compareRefs(connection.fromRange.start, connection.toRange.start) <= 0
    ? "from-is-shadow"
    : "to-is-shadow";
}
