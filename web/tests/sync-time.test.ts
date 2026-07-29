import assert from "node:assert/strict";
import test from "node:test";

import { nextTimestamp } from "@/lib/sync/time";

test("deliberate edits always advance the last-write-wins timestamp", () => {
  const future = "2099-01-01T00:00:00.000Z";
  assert.equal(nextTimestamp(future), "2099-01-01T00:00:00.001Z");
  assert.ok(Date.parse(nextTimestamp()) <= Date.now());
});
