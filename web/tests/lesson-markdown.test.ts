/**
 * LESSONRENDER-001 — `lib/content/lessonMarkdown.ts`, the pure safe-subset
 * Markdown parser. Plain function calls, no React, no stubbing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_BLOCK_DEPTH,
  blocksToPlainText,
  inlineToPlainText,
  parseInline,
  parseLessonMarkdown,
  sanitizeHttpsUrl,
  type LessonBlock,
  type LessonInline,
} from "@/lib/content/lessonMarkdown";

function onlyBlock(src: string): LessonBlock {
  const blocks = parseLessonMarkdown(src);
  assert.equal(blocks.length, 1, `expected exactly one block for ${JSON.stringify(src)}, got ${JSON.stringify(blocks)}`);
  return blocks[0];
}

function walkInline(nodes: readonly LessonInline[], visit: (node: LessonInline) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === "strong" || node.type === "em" || node.type === "link") walkInline(node.children, visit);
  }
}

function allInline(blocks: readonly LessonBlock[]): LessonInline[] {
  const found: LessonInline[] = [];
  const walk = (list: readonly LessonBlock[]): void => {
    for (const block of list) {
      if (block.type === "paragraph" || block.type === "heading") walkInline(block.children, (n) => found.push(n));
      else if (block.type === "blockquote") walk(block.children);
      else for (const item of block.items) walk(item);
    }
  };
  walk(blocks);
  return found;
}

// --- structure -------------------------------------------------------------

test("empty / non-string input yields no blocks and never throws", () => {
  assert.deepEqual(parseLessonMarkdown(""), []);
  assert.deepEqual(parseLessonMarkdown("   \n\n  \n"), []);
  assert.deepEqual(parseLessonMarkdown(undefined as unknown as string), []);
  assert.deepEqual(parseLessonMarkdown(null as unknown as string), []);
  assert.deepEqual(parseLessonMarkdown(42 as unknown as string), []);
});

test("blank lines separate paragraphs; single newlines are soft breaks; CRLF is normalised", () => {
  const blocks = parseLessonMarkdown("First line\ncontinues here.\r\n\r\nSecond paragraph.\n\n\n\nThird.");
  assert.equal(blocks.length, 3);
  assert.equal(blocksToPlainText([blocks[0]]), "First line continues here.");
  assert.equal(blocksToPlainText([blocks[1]]), "Second paragraph.");
  assert.equal(blocksToPlainText([blocks[2]]), "Third.");
});

test("### and #### are sub-headings; # and ## and #hashtag are plain text", () => {
  const blocks = parseLessonMarkdown("### Sub heading\n\n#### Smaller\n\n## Not here\n\n#hashtag");
  assert.deepEqual(
    blocks.map((b) => (b.type === "heading" ? `h${b.level}` : b.type)),
    ["h3", "h4", "paragraph", "paragraph"],
  );
  assert.equal(blocksToPlainText([blocks[2]]), "## Not here");
  assert.equal(blocksToPlainText([blocks[3]]), "#hashtag");
  const closed = onlyBlock("### Title ###");
  assert.equal(closed.type, "heading");
  assert.equal(blocksToPlainText([closed]), "Title");
});

test("bold, italic (both delimiters), and code produce typed inline nodes", () => {
  const block = onlyBlock("A **bold** and *italic* and _also italic_ and `code()` word.");
  assert.equal(block.type, "paragraph");
  const kinds = allInline([block]).map((n) => n.type);
  assert.ok(kinds.includes("strong"));
  assert.equal(kinds.filter((k) => k === "em").length, 2);
  assert.ok(kinds.includes("code"));
  assert.equal(blocksToPlainText([block]), "A bold and italic and also italic and code() word.");
});

test("bold containing italic nests; italic containing bold nests", () => {
  const a = onlyBlock("**bold with *italic* inside**");
  assert.equal(a.type, "paragraph");
  const strong = (a as Extract<LessonBlock, { type: "paragraph" }>).children[0];
  assert.equal(strong.type, "strong");
  assert.ok(allInline([a]).some((n) => n.type === "em"));
  const b = onlyBlock("*italic with **bold** inside*");
  assert.ok(allInline([b]).some((n) => n.type === "strong"));
  assert.equal(blocksToPlainText([b]), "italic with bold inside");
});

test("intraword underscores and stars-with-spaces stay literal", () => {
  assert.equal(blocksToPlainText(parseLessonMarkdown("snake_case_name and 2 * 3 * 4")), "snake_case_name and 2 * 3 * 4");
  assert.ok(!allInline(parseLessonMarkdown("snake_case_name")).some((n) => n.type === "em"));
  assert.ok(!allInline(parseLessonMarkdown("2 * 3 * 4")).some((n) => n.type === "em"));
});

test("backslash escapes yield literal characters", () => {
  const block = onlyBlock("\\*not italic\\* and \\[not a link\\](https://example.com)");
  assert.deepEqual(allInline([block]).map((n) => n.type), ["text"]);
  assert.equal(blocksToPlainText([block]), "*not italic* and [not a link](https://example.com)");
});

test("bullet lists: -, *, + markers; sibling items; ends at a blank + paragraph", () => {
  const blocks = parseLessonMarkdown("- one\n- two\n* three\n+ four\n\nAfter the list.");
  assert.equal(blocks.length, 2);
  const list = blocks[0];
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 4);
  assert.equal(blocks[1].type, "paragraph");
});

test("a line starting with ** is bold, not a list", () => {
  const block = onlyBlock("**Where Genesis 3 sits.** Modern commentary...");
  assert.equal(block.type, "paragraph");
  assert.equal((block as Extract<LessonBlock, { type: "paragraph" }>).children[0].type, "strong");
});

test("numbered lists keep their start and stay ONE list across blank lines between items", () => {
  const blocks = parseLessonMarkdown("1. first\n\n2. second\n\n3. third");
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.ordered, true);
  assert.equal(list.start, 1);
  assert.equal(list.items.length, 3);
  const offset = onlyBlock("3) three\n4) four");
  assert.equal(offset.type, "list");
  if (offset.type === "list") assert.equal(offset.start, 3);
});

test("nested lists by indentation, and lazy continuation lines join the item", () => {
  const blocks = parseLessonMarkdown("- outer one\n  - inner a\n  - inner b\n- outer two\ncontinues lazily");
  assert.equal(blocks.length, 1);
  const outer = blocks[0];
  assert.equal(outer.type, "list");
  if (outer.type !== "list") return;
  assert.equal(outer.items.length, 2);
  const firstItem = outer.items[0];
  assert.equal(firstItem[0].type, "paragraph");
  assert.equal(firstItem[1].type, "list");
  if (firstItem[1].type === "list") assert.equal(firstItem[1].items.length, 2);
  assert.equal(blocksToPlainText(outer.items[1]), "outer two continues lazily");
});

test("ordered item with a nested bullet and a multi-paragraph body", () => {
  const blocks = parseLessonMarkdown("1. Item one\n\n   Second paragraph of item one.\n   - nested bullet\n2. Item two");
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].map((b) => b.type), ["paragraph", "paragraph", "list"]);
});

test("a wrapped line that begins '1998. ' does not become a list mid-paragraph", () => {
  const block = onlyBlock("The commentary was revised in\n1998. That edition changed it.");
  assert.equal(block.type, "paragraph");
});

test("blockquotes: multi-line, containing paragraphs and lists; nested quotes", () => {
  const blocks = parseLessonMarkdown("> quoted line one\n> line two\n>\n> - a\n> - b\n\nafter");
  assert.equal(blocks.length, 2);
  const quote = blocks[0];
  assert.equal(quote.type, "blockquote");
  if (quote.type !== "blockquote") return;
  assert.deepEqual(quote.children.map((b) => b.type), ["paragraph", "list"]);
  const nested = onlyBlock("> outer\n>> inner");
  assert.equal(nested.type, "blockquote");
});

test("a list item can hold a blockquote and a paragraph can follow a heading with no blank line", () => {
  const blocks = parseLessonMarkdown("### Head\nBody right after.\n- item\n  > quote in item");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "list"]);
});

// --- links & URL policy ------------------------------------------------------

test("https links become link nodes with a normalised href and inline children", () => {
  const block = onlyBlock("See [the **lexicon**](https://example.com/a?b=1#c) now.");
  const links = allInline([block]).filter((n) => n.type === "link");
  assert.equal(links.length, 1);
  const link = links[0];
  assert.equal(link.type === "link" && link.href, "https://example.com/a?b=1#c");
  assert.equal(blocksToPlainText([block]), "See the lexicon now.");
});

test("HOSTILE: javascript:, data:, vbscript:, http:, relative, protocol-relative, credentialed and obfuscated URLs never become links", () => {
  const hostile = [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](java\tscript:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](data:text/html;base64,PHNjcmlwdD4=)",
    "[x](vbscript:msgbox(1))",
    "[x](http://example.com)",
    "[x](//evil.example/path)",
    "[x](/relative/path)",
    "[x](mailto:a@b.c)",
    "[x](https://user:pass@example.com/)",
    "[x](https://exa mple.com)",
    "[x]( https://example.com )",
    "[x](https://example.com \"title\")",
    "[](https://example.com)",
    "[x](https://example.com",
  ];
  for (const src of hostile) {
    const blocks = parseLessonMarkdown(src);
    assert.ok(
      !allInline(blocks).some((n) => n.type === "link" && !/^https:\/\//.test(n.href)),
      `non-https link produced for ${src}`,
    );
    // Every one of these must come out with NO link at all.
    assert.ok(!allInline(blocks).some((n) => n.type === "link"), `link should not survive for ${JSON.stringify(src)}`);
    // …and the text stays visible rather than being swallowed.
    assert.ok(blocksToPlainText(blocks).includes("x") || src.startsWith("[]"), src);
  }
});

test("sanitizeHttpsUrl: accepts https only, returns the parser-normalised form", () => {
  assert.equal(sanitizeHttpsUrl("https://example.com"), "https://example.com/");
  assert.equal(sanitizeHttpsUrl("HTTPS://Example.com/Path"), "https://example.com/Path");
  for (const bad of ["", " ", "javascript:alert(1)", "http://a.b", "ftp://a.b", "https:", "https://", "//a.b", "https://a.b\u0000", "https://a.b/\npath", "https://a.b/\tx", "https://u@a.b"]) {
    assert.equal(sanitizeHttpsUrl(bad), null, JSON.stringify(bad));
  }
  assert.equal(sanitizeHttpsUrl(`https://a.b/${"x".repeat(3000)}`), null);
});

test("HOSTILE: raw HTML is never interpreted — tags survive only as literal text characters", () => {
  const src = '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a> &lt;b&gt;';
  const blocks = parseLessonMarkdown(src);
  assert.equal(blocks.length, 1);
  assert.deepEqual(allInline(blocks).map((n) => n.type), ["text"]);
  assert.equal(blocksToPlainText(blocks), src);
});

test("the parser output contains only known node types, for a hostile soup of every construct", () => {
  const soup = [
    "### <b>h</b>",
    "> <script>x</script>",
    "- [a](javascript:1) **<i>b</i>** `<c>`",
    "1. ![img](https://example.com/x.png)",
    "| a | b |\n|---|---|\n| 1 | 2 |",
    "```js\nalert(1)\n```",
    "---",
  ].join("\n\n");
  const allowedInline = new Set(["text", "strong", "em", "code", "link"]);
  for (const node of allInline(parseLessonMarkdown(soup))) assert.ok(allowedInline.has(node.type));
});

// --- robustness ------------------------------------------------------------

test("unterminated emphasis, code, links and brackets degrade to literal text", () => {
  for (const src of ["**never closed", "*never closed", "_never closed", "`never closed", "[never closed", "[a](https://x.y", "***", "**", "* ", "__x__", "a ** b ** c"]) {
    const blocks = parseLessonMarkdown(src);
    assert.ok(blocks.length >= 1, src);
    assert.ok(!allInline(blocks).some((n) => n.type === "link"), src);
    assert.ok(!allInline(blocks).some((n) => n.type === "strong" || n.type === "em") || src === "***", src);
  }
  assert.equal(blocksToPlainText(parseLessonMarkdown("**never closed")), "**never closed");
  assert.equal(blocksToPlainText(parseLessonMarkdown("[never closed")), "[never closed");
});

test("deeply nested lists and quotes are bounded, lose no text, and do not overflow the stack", () => {
  const deepList = Array.from({ length: 200 }, (_, i) => `${"  ".repeat(i)}- level ${i}`).join("\n");
  const blocks = parseLessonMarkdown(deepList);
  const depthOf = (list: readonly LessonBlock[]): number =>
    Math.max(0, ...list.map((b) => (b.type === "list" ? 1 + Math.max(0, ...b.items.map((i) => depthOf(i))) : b.type === "blockquote" ? 1 + depthOf(b.children) : 0)));
  assert.ok(depthOf(blocks) <= MAX_BLOCK_DEPTH, `list depth ${depthOf(blocks)}`);
  const text = blocksToPlainText(blocks);
  for (let i = 0; i < 200; i++) assert.ok(text.includes(`level ${i}`), `lost level ${i}`);

  const deepQuote = `${">".repeat(500)} very deep`;
  const quoteBlocks = parseLessonMarkdown(deepQuote);
  assert.ok(depthOf(quoteBlocks) <= MAX_BLOCK_DEPTH);
  assert.ok(blocksToPlainText(quoteBlocks).includes("very deep"));
});

test("deeply nested inline emphasis is bounded", () => {
  const src = `${"*a ".repeat(50)}x${" a*".repeat(50)}`;
  const inline = parseInline(src);
  const depth = (nodes: readonly LessonInline[]): number =>
    Math.max(0, ...nodes.map((n) => (n.type === "strong" || n.type === "em" || n.type === "link" ? 1 + depth(n.children) : 0)));
  assert.ok(depth(inline) <= 4);
});

test("10,000-character single lines parse quickly and keep every character", () => {
  const shapes: Record<string, string> = {
    words: "word ".repeat(2000),
    solid: "a".repeat(10000),
    stars: "*".repeat(10000),
    openStrong: "**a ".repeat(2500),
    openEm: "*a ".repeat(3333),
    openBrackets: "[".repeat(10000),
    openLinks: "[a](https://example.com/".repeat(400),
    backticks: "`".repeat(10000),
    escapes: "\\".repeat(10000),
    pairs: "**x** ".repeat(1600),
    spaces: `### a${" ".repeat(10000)}b`,
    hashes: `### a ${"#".repeat(10000)}`,
    marker: `- ${"x ".repeat(5000)}`,
  };
  for (const [name, src] of Object.entries(shapes)) {
    const started = performance.now();
    const blocks = parseLessonMarkdown(src);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 750, `${name}: ${elapsed.toFixed(0)}ms`);
    assert.ok(blocks.length >= 1, name);
  }
  // Content preservation for the plain shapes.
  assert.equal(blocksToPlainText(parseLessonMarkdown("a".repeat(10000))).length, 10000);
  assert.equal(blocksToPlainText(parseLessonMarkdown("[".repeat(10000))).length, 10000);
});

test("a 200,000-character paragraph is kept as one plain text node (scan bound)", () => {
  const src = "**a **a ".repeat(25000);
  const started = performance.now();
  const block = onlyBlock(src);
  assert.ok(performance.now() - started < 1000);
  assert.equal(block.type, "paragraph");
  assert.equal((block as Extract<LessonBlock, { type: "paragraph" }>).children.length, 1);
});

test("the real Genesis-3-shaped prose (bold lead-ins, Hebrew bullets, loose numbered lists) parses into the expected shapes", () => {
  const src = [
    "**Where Genesis 3 sits.** Modern commentary...",
    "",
    "**Key words, read as observations.** A handful of Hebrew words:",
    "",
    "- **נָחָשׁ** (*naḥash*, \"serpent,\" 3:1,2,4,13,14) occurs about 31 times.",
    "- **עָרוּם** (*ʿarum*, \"crafty,\" 3:1) has a dual range.",
    "",
    "**The judgment scene.**",
    "",
    "1. *The interrogation questions the man.* God asks...",
    "2. *The sentences come in order.* That is...",
  ].join("\n");
  const blocks = parseLessonMarkdown(src);
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "paragraph", "list", "paragraph", "list"]);
  const text = blocksToPlainText(blocks);
  assert.ok(text.includes("נָחָשׁ"));
  assert.ok(!text.includes("**"));
  assert.ok(!text.includes("*naḥash*"));
  assert.ok(inlineToPlainText(parseInline("*ʿarum*")) === "ʿarum");
});
