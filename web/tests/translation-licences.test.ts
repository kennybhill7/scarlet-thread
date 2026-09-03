/**
 * BUILD_PLAN.md 0.11 — "KJV UK Crown-copyright question answered (geo-note
 * or drop); licence text rendered in Settings." This proves the data side:
 * every shipped translation carries a real, non-empty `licence` string (not
 * just a `note`), and KJV's specifically discloses the UK Crown-copyright
 * status rather than the old "public domain in the United States" claim,
 * which was true but silently omitted the one territory where it doesn't
 * hold. See CODEX_AUDIT.md A-042 for the finding this closes (partially —
 * a disclosure, not a legal clearance, per that entry's own resolution
 * note) and OfflineDownloads.tsx for where this field actually renders.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface VersionMeta {
  id: string;
  licence: string;
  note: string;
}
interface BibleIndex {
  versions: VersionMeta[];
}

async function loadRealIndex(): Promise<BibleIndex> {
  return JSON.parse(await readFile(new URL("../public/bible/index.json", import.meta.url), "utf8"));
}

test("every shipped translation has a real, non-empty licence string distinct from its note", async () => {
  const index = await loadRealIndex();
  assert.ok(index.versions.length > 0, "sanity: the real corpus ships at least one translation");
  for (const version of index.versions) {
    assert.ok(
      typeof version.licence === "string" && version.licence.trim().length > 0,
      `${version.id} must carry a real licence string`,
    );
    assert.notEqual(version.licence, version.note, `${version.id}'s licence must not just duplicate its note`);
  }
});

test("KJV's licence discloses the UK Crown-copyright status, not just US public-domain status", async () => {
  const index = await loadRealIndex();
  const kjv = index.versions.find((v) => v.id === "KJV");
  assert.ok(kjv, "KJV must be present in the real shipped corpus");
  assert.ok(
    /United Kingdom/i.test(kjv!.licence) && /Crown/i.test(kjv!.licence),
    `KJV's licence text must name the UK Crown-copyright status explicitly, got: ${kjv!.licence}`,
  );
});

test("KJV's licence honestly states no access restriction is applied, matching real app behavior", async () => {
  const index = await loadRealIndex();
  const kjv = index.versions.find((v) => v.id === "KJV");
  assert.ok(kjv, "KJV must be present in the real shipped corpus");
  // MUTATION-GUARD: the disclosure must never silently start claiming a
  // restriction (e.g. "not distributed to UK readers") that the app does
  // not actually implement -- no geo-blocking exists anywhere in this repo,
  // so the text must not assert one either.
  assert.ok(
    /no access restriction/i.test(kjv!.licence),
    `KJV's licence must state plainly that no access restriction is applied, got: ${kjv!.licence}`,
  );
});
