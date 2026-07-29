import assert from "node:assert/strict";
import test from "node:test";

import { privateEmpty, privateJson } from "@/lib/api/response";

test("journal API responses explicitly forbid storage in HTTP caches", async () => {
  const response = privateJson({ data: ["private"] }, { status: 201 });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { data: ["private"] });
});

test("empty mutation responses also forbid storage in HTTP caches", () => {
  const response = privateEmpty();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.body, null);
});
