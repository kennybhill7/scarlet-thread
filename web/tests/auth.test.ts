import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedEmail } from "@/lib/auth/allowlist";

test("the owner allowlist is exact, case-insensitive, and fail-closed", () => {
  assert.equal(isAllowedEmail("Owner@Example.com", " owner@example.com "), true);
  assert.equal(isAllowedEmail("other@example.com", "owner@example.com"), false);
  assert.equal(isAllowedEmail("owner@example.com", ""), false);
  assert.equal(isAllowedEmail("owner@example.com", undefined), false);
  assert.equal(isAllowedEmail(null, "owner@example.com"), false);
});
