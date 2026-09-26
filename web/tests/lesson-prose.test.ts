/**
 * LESSONRENDER-001 — `components/lesson/LessonProse.tsx`, rendered through
 * `react-dom/server`'s `renderToStaticMarkup` (plain Node, no jsdom). The
 * component imports no CSS Module, so no require-cache stubbing is needed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LessonProse } from "@/components/lesson/LessonProse";

function render(markdown: string, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(LessonProse, { markdown, ...extra }));
}

test("empty or whitespace-only markdown renders nothing at all (no empty card)", () => {
  assert.equal(render(""), "");
  assert.equal(render("  \n\n "), "");
});

test("headings, paragraphs, bold, italic, code, lists and blockquotes become real elements, not literal markup characters", () => {
  const html = render(
    ["Intro with **bold**, *italic* and `code`.", "", "### A sub-heading", "", "- alpha", "- beta", "", "1. one", "2. two", "", "> quoted words"].join("\n"),
  );
  assert.match(html, /<p [^>]*>Intro with <strong>bold<\/strong>, <em>italic<\/em> and <code [^>]*>code<\/code>\.<\/p>/);
  assert.match(html, /<h5 [^>]*>A sub-heading<\/h5>/);
  assert.match(html, /<ul [^>]*><li [^>]*>alpha<\/li><li [^>]*>beta<\/li><\/ul>/);
  assert.match(html, /<ol [^>]*><li [^>]*>one<\/li><li [^>]*>two<\/li><\/ol>/);
  assert.match(html, /<blockquote [^>]*><p [^>]*>quoted words<\/p><\/blockquote>/);
  assert.ok(!html.includes("**"), "literal ** must not survive");
  assert.ok(!html.includes("### "), "literal ### must not survive");
});

test("the collapse bug: separate paragraphs render as separate <p> elements", () => {
  const html = render("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  assert.equal((html.match(/<p /g) ?? []).length, 3);
});

test("a numbered list starting above 1 keeps its start attribute", () => {
  assert.match(render("3. three\n4. four"), /<ol [^>]*start="3"/);
});

test("nested lists render nested <ul> inside <li>", () => {
  const html = render("- outer\n  - inner");
  assert.match(html, /<ul [^>]*><li [^>]*>[^]*<ul [^>]*><li [^>]*>inner<\/li><\/ul><\/li><\/ul>/);
});

test("HOSTILE: script tags, event handlers and javascript: URLs produce no live markup", () => {
  const html = render(
    [
      "<script>alert(1)</script>",
      "",
      "[click](javascript:alert(1)) and [also](JAVASCRIPT:alert(2))",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      "[data](data:text/html;base64,PHNjcmlwdD4=) [http](http://example.com)",
      "",
      "- <b onmouseover=alert(1)>x</b>",
    ].join("\n"),
  );
  assert.ok(!html.includes("<script"), "no <script element");
  assert.ok(!html.includes("<img"), "no <img element");
  assert.ok(!html.includes("<b "), "no <b element from the input");
  assert.ok(!/href="(?!https:\/\/)/.test(html), "any href present must be https");
  assert.ok(!html.includes("<a "), "none of the hostile links may become an anchor");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "the script text is visible, escaped");
  assert.ok(html.includes("javascript:alert(1)"), "the hostile link text stays visible as plain text");
});

test("an https link renders as a hardened anchor", () => {
  const html = render("Read [the source](https://example.com/page?a=1&b=2).");
  assert.match(html, /<a href="https:\/\/example\.com\/page\?a=1&amp;b=2" rel="noopener noreferrer" [^>]*target="_blank">the source<\/a>/);
});

test("a link's quoted breakout attempt cannot inject attributes", () => {
  const html = render('[x](https://example.com/"onmouseover="alert(1))');
  // The URL parser percent-encodes the quotes, so no attribute boundary appears.
  assert.ok(!html.includes('onmouseover="'), html);
});

test("Hebrew and Greek runs get lang/dir spans; Latin text does not", () => {
  const html = render("The word נָחָשׁ and the phrase λόγος τοῦ θεοῦ appear here.");
  assert.match(html, /<span dir="rtl" lang="he"[^>]*>נָחָשׁ<\/span>/);
  assert.match(html, /<span lang="grc"[^>]*>λόγος τοῦ θεοῦ<\/span>/);
  assert.ok(!html.includes('lang="he"><'), "sanity");
  const plain = render("Only Latin text here.");
  assert.ok(!plain.includes("lang="));
});

test("optional heading and provenance slot render; absent props render no header row", () => {
  const withBoth = render("Body.", { heading: "What this lesson practices", provenance: createElement("span", { "data-testid": "chip" }, "Curated") });
  assert.match(withBoth, /<h4 [^>]*>What this lesson practices<\/h4>/);
  assert.ok(withBoth.includes('data-testid="chip"'));
  const bare = render("Body.");
  assert.ok(!bare.includes("<h4"));
});

test("testId lands on the wrapper", () => {
  assert.ok(render("Body.", { testId: "my-prose" }).includes('data-testid="my-prose"'));
});

test("theming: the card is built from --page-* tokens so it follows parchment/midnight; serif 17px/1.6; ~68ch measure", () => {
  const html = render("Body.");
  assert.ok(html.includes("var(--page-card)"));
  assert.ok(html.includes("var(--page-ink)"));
  assert.ok(html.includes("var(--font-read)"));
  assert.ok(html.includes("font-size:17px"));
  assert.ok(html.includes("line-height:1.6"));
  assert.ok(html.includes("max-width:68ch"));
});

test("source hygiene: no dangerouslySetInnerHTML and no colour literals in LessonProse.tsx or lessonMarkdown.ts", () => {
  const root = join(__dirname, "..");
  for (const rel of ["components/lesson/LessonProse.tsx", "lib/content/lessonMarkdown.ts"]) {
    const code = readFileSync(join(root, rel), "utf8")
      // Strip comments so prose in headers can mention the words being banned.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/dangerouslySetInnerHTML/.test(code), `${rel} must not use dangerouslySetInnerHTML`);
    assert.ok(!/innerHTML/.test(code), `${rel} must not touch innerHTML`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${rel} must not contain hex colours`);
    assert.ok(!/\brgba?\(|\bhsla?\(/.test(code), `${rel} must not contain rgb()/hsl() literals`);
  }
});

test("the real Genesis 3 lesson body renders with structure intact (bold lead-ins, Hebrew list, numbered lists)", () => {
  const body = readFileSync(join(__dirname, "..", "..", "content", "curriculum", "genesis", "03-the-fall.md"), "utf8");
  const [, , rest] = body.split(/^---\s*$/m);
  const literary = rest.split(/^## /m).find((s) => s.startsWith("Literary Design")) ?? "";
  const html = render(literary.replace(/^Literary Design\s*/, ""));
  assert.ok(html.includes("<strong>"));
  assert.ok(html.includes("<ul "));
  assert.ok(html.includes("<ol "));
  assert.ok(!html.includes("**"), "no literal bold markers in rendered Literary Design");
  const context = rest.split(/^## /m).find((s) => s.startsWith("Context")) ?? "";
  const contextHtml = render(context.replace(/^Context\s*/, ""));
  assert.ok(contextHtml.includes('lang="he"'), "Hebrew words get a lang span");
  assert.ok(!contextHtml.includes("**"));
  assert.ok((contextHtml.match(/<li /g) ?? []).length >= 5, "the key-word bullets render as list items");
});
