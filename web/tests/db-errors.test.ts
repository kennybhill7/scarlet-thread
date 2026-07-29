import assert from "node:assert/strict";
import test from "node:test";

import { hasDatabaseErrorCode } from "@/lib/db/errors";

test("database error codes are found through wrapped driver errors", () => {
  const driverError = Object.assign(new Error("constraint"), {
    code: "23514",
  });
  const wrapped = new Error("query failed", { cause: driverError });

  assert.equal(hasDatabaseErrorCode(wrapped, "23514"), true);
  assert.equal(hasDatabaseErrorCode(wrapped, "23503"), false);
});
