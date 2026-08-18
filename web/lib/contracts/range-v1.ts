/**
 * Canonical passage-range contract — Phase 1, frozen before any v2 table.
 *
 * BUILD_PLAN.md §3.1: "every v2 table stores ranges and changing it later
 * would be a destructive migration." This module is the versioned contract
 * only — types and the versification identifier. Parsing, validation,
 * formatting, containment/overlap, and the display-reference mapping live in
 * `lib/bible/range.ts` (pure functions, tested separately).
 *
 * Per tenet 4 in BUILD_PLAN.md ("Additive contracts only"): `lib/contracts.ts`
 * stays byte-stable; new types live in versioned modules like this one. Never
 * add fields here without a new `V2` type — this file is frozen once other
 * code depends on it.
 *
 * A CanonicalRangeV1 is translation-independent: `start` and `end` are RefKeys
 * (`lib/contracts.ts`) in the canonical English-protestant versification —
 * the numbering every bundled version shares except SBL (see
 * `tools/versification-report.md` and `lib/bible/versemap.ts`). It expresses
 * a literary unit, not just a verse: Genesis 1:1-2:3 is one CanonicalRangeV1
 * with start "1.1.1" and end "1.2.3". Cross-chapter is allowed as long as
 * both ends stay inside the same book (`lib/bible/range.ts` enforces this and
 * is the only place that should ever construct or validate one of these).
 *
 * A DisplayReferenceV1 is what you show a reader: the same canonical range,
 * translated into one specific translation's own verse numbering via the
 * versioned verse map, plus the identifiers needed so a later text or
 * verse-map update can never silently change what the learner saw:
 * `translationId` records which version's numbering `mappedStart`/`mappedEnd`
 * are expressed in, and `corpusReleaseId` records which immutable content
 * release supplied the mapping. For the 1,187 non-divergent chapters,
 * `mappedStart`/`mappedEnd` equal `canonicalRange.start`/`.end`. For the two
 * Romans chapters where SBL's Spanish text diverges from the canonical
 * English numbering, they do not — see `lib/bible/range.ts`'s
 * `toDisplayReference()` for the mapping itself.
 */

import type { RefKey, VersionId } from "@/lib/contracts";

/**
 * The one versification this contract speaks today: 66 canonical-order
 * books, 31,102 verses — the English count from
 * tools/versification-report.md, shared by every bundled version except
 * SBL's Spanish text. A future second versification (e.g. a Catholic or
 * Orthodox canon) is a new literal added to a union here, never a mutation
 * of this one — existing stored ranges must stay valid forever.
 */
export const CANONICAL_VERSIFICATION_ID = "eng-protestant-66-31102-v1" as const;

export type VersificationId = typeof CANONICAL_VERSIFICATION_ID;

/**
 * Canonical, translation-independent range. Cross-chapter allowed within one
 * book (Gen 1:1-2:3); cross-book is never valid (see `lib/bible/range.ts`
 * `validateCanonicalRange`). `start` and `end` are both inclusive verse-level
 * RefKeys ("book.chapter.verse", e.g. "1.1.1") — a range never uses a
 * chapter-only RefKey as a boundary, so "the whole of Genesis 1" is
 * represented as start "1.1.1", end "1.1.<last verse>", never as "1.1". A
 * single verse is start === end.
 *
 * This type is structural (a plain object shape), not a class — it is stored
 * as JSON in every v2 table that needs a range, so it must round-trip through
 * `JSON.stringify`/`JSON.parse` with no loss.
 */
export interface CanonicalRangeV1 {
  versificationId: VersificationId;
  /** Inclusive start, e.g. "1.1.1". */
  start: RefKey;
  /** Inclusive end, e.g. "1.2.3". Same book as start; may equal start. */
  end: RefKey;
}

/**
 * A canonical range resolved into one translation's own verse numbering, for
 * showing to a reader or quoting as evidence. Every quoted evidence record
 * stores this whole shape (BUILD_PLAN §3.1) — never just the mapped keys —
 * so a later text or verse-map update can never silently change what the
 * learner saw: the original canonical range and the translation/release it
 * was resolved against are both preserved.
 */
export interface DisplayReferenceV1 {
  /** The translation-independent range this was resolved from. */
  canonicalRange: CanonicalRangeV1;
  /** Which translation's own numbering mappedStart/mappedEnd are expressed in. */
  translationId: VersionId;
  /** Which immutable content/corpus release supplied the verse map used. */
  corpusReleaseId: string;
  /** canonicalRange.start, translated into translationId's own numbering. */
  mappedStart: RefKey;
  /** canonicalRange.end, translated into translationId's own numbering. */
  mappedEnd: RefKey;
}
