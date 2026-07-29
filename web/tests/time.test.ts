import assert from "node:assert/strict";
import test from "node:test";

import {
  toIsoTimestamp,
  toOptionalIsoTimestamp,
} from "@/lib/db/time";

test("database timestamps are normalized to the browser sync contract", () => {
  assert.equal(
    toIsoTimestamp("2026-07-29 05:00:00.123+00"),
    "2026-07-29T05:00:00.123Z",
  );
  assert.equal(toOptionalIsoTimestamp(null), null);
});

test("malformed database timestamps fail closed", () => {
  assert.throws(
    () => toIsoTimestamp("not-a-timestamp"),
    /invalid timestamp/,
  );
});
