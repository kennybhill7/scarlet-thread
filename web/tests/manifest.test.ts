import assert from "node:assert/strict";
import test from "node:test";

import manifest from "../app/manifest";

// A-037: app/manifest.ts used to hardcode orientation: "portrait", which
// locks an installed PWA out of landscape entirely -- including on tablets,
// where the wide parallel-reader (MirrorSplitView) and the mountain layout
// are genuinely usable in landscape. manifest() is a plain function with no
// Next.js runtime dependency, so it is called directly here, the same way
// tests/security-headers.test.ts calls next.config.ts's exports directly.

// MUTATION-PROOF TARGET (A-037): reintroducing orientation: "portrait" (or
// any single locked orientation) must fail this test.
test("manifest() does not lock the installed app to a single orientation", () => {
  const result = manifest();
  assert.notEqual(
    result.orientation,
    "portrait",
    "an installed PWA must not be forced into portrait-only",
  );
  // "any" is the specific fix chosen -- letting the OS/window manager decide
  // -- rather than merely swapping one lock ("landscape") for another.
  assert.equal(result.orientation, "any");
});

test("manifest() still declares the rest of the installable-app contract", () => {
  const result = manifest();
  assert.equal(result.name, "Scarlet Thread");
  assert.equal(result.display, "standalone");
  assert.equal(result.start_url, "/");
  assert.ok(Array.isArray(result.icons) && result.icons.length > 0);
});
