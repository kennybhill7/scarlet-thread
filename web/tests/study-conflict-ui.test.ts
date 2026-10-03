import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConflictReview } from "@/components/sync/StudyConflictNotice";
import type { StudyConflictV2 } from "@/lib/sync/store";

test("conflict review renders both versions safely and offers explicit reconciliation", () => {
  const conflict: StudyConflictV2 = {
    key: "test", entity: "claim", entityId: "claim", opIds: ["op"],
    local: { body: "My <script>alert(1)</script> notes", status: "draft", deletedAt: null },
    remote: { body: "Other device's notes", status: "ready", deletedAt: "2026-01-01" },
  };
  const html = renderToStaticMarkup(createElement(ConflictReview, { conflict, onSaved: () => {} }));
  assert.ok(html.includes("My &lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Other device&#x27;s notes"));
  assert.ok(html.includes("Reconciled body"));
  assert.ok(html.includes("Save reconciled version"));
  assert.ok(html.includes("Deleted At"));
  assert.ok(html.includes("Both originals will be kept on this device"));
});
