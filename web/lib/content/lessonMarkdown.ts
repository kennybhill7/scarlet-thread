/**
 * LESSONRENDER-001 — a small, pure, SAFE Markdown subset parser for published
 * lesson prose.
 *
 * WHY THIS EXISTS: `lib/content/publishedLessons.ts` extracts each lesson
 * section (`## Context`, `## Positions`, ...) as a Markdown string, and the
 * workspace sections used to drop that string into one plain `<p>`, so
 * bold, lists, sub-headings, blockquotes and paragraph breaks all collapsed
 * into one wall of text. This module turns that string into a typed block
 * tree; `components/lesson/LessonProse.tsx` renders the tree to React
 * elements.
 *
 * SAFETY MODEL (the whole point of a hand-rolled subset instead of a general
 * Markdown library):
 *   - The output is DATA (`LessonBlock[]`), never an HTML string. There is no
 *     way to smuggle markup through: `<script>`, `<img onerror=…>`, entities
 *     and every other `<` are just characters in a text node, and React
 *     escapes text nodes when the tree is rendered. No HTML anywhere.
 *   - Links are the only construct that carries a URL, and only
 *     `[text](https://…)` survives, re-serialised through the WHATWG `URL`
 *     parser. `javascript:`, `data:`, `http:`, relative, protocol-relative and
 *     credential-bearing URLs all degrade to their plain text.
 *   - Unknown syntax degrades to text. Nothing here throws on any string.
 *   - Recursion is bounded (block nesting and inline nesting both have hard
 *     caps), so hostile input cannot blow the stack, and every scan is linear
 *     or close to it (see the 10,000-character-line tests).
 *
 * SUPPORTED: paragraphs (blank-line separated; single newlines are soft
 * breaks), `### ` / `#### ` sub-headings, bullet lists (`-`, `*`, `+`),
 * numbered lists (`1.` / `1)`, loose "blank line between items" lists stay ONE
 * list), nested lists by indentation, `> ` blockquotes, `**bold**`,
 * `*italic*` / `_italic_`, `` `code` ``, `[text](https://…)`, and backslash
 * escapes (`\*`).
 *
 * NOT SUPPORTED (renders as text): raw HTML, tables, images, footnotes,
 * fenced code blocks, setext headings, `#`/`##` headings, horizontal rules,
 * autolinks, reference links, `__bold__`.
 *
 * Author: Kenneth Hill
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LessonInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: LessonInline[] }
  | { type: "em"; children: LessonInline[] }
  | { type: "code"; text: string }
  /** `href` is always a normalised `https:` URL — see {@link sanitizeHttpsUrl}. */
  | { type: "link"; href: string; children: LessonInline[] };

export type LessonBlock =
  | { type: "paragraph"; children: LessonInline[] }
  /** `level` 3 for `### `, 4 for `#### `. The renderer maps them below the section label. */
  | { type: "heading"; level: 3 | 4; children: LessonInline[] }
  | { type: "blockquote"; children: LessonBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: LessonBlock[][] };

/** Hard caps. Deeper structure degrades to plain paragraphs / text. */
export const MAX_BLOCK_DEPTH = 5;
export const MAX_INLINE_DEPTH = 4;
/** A single paragraph/heading longer than this is kept as one plain text node (bounds worst-case scans). */
export const MAX_INLINE_LENGTH = 20000;
const MAX_LINK_TEXT_SCAN = 1500;

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

/**
 * Returns the normalised URL string when `raw` is an absolute `https:` URL
 * with a host and no embedded credentials; `null` for everything else
 * (`javascript:`, `data:`, `http:`, `//host`, `/relative`, `mailto:`, garbage).
 * The RETURNED string (not `raw`) is what a link should carry: the URL parser
 * has already stripped tabs/newlines and percent-encoded anything unsafe.
 */
export function sanitizeHttpsUrl(raw: string): string | null {
  const candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > 2048) return null;
  // Reject any control character or whitespace up front: the URL parser would
  // silently strip some of them, which is exactly how `java\tscript:`-style
  // tricks and hidden characters get past naive filters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f]/.test(candidate)) return null;
  if (!/^https:\/\//i.test(candidate)) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname.length === 0) return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  return parsed.href;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const ESCAPABLE = "\\`*_[]()#>-+.!{}|~<";

function isWhitespace(ch: string | undefined): boolean {
  return ch === undefined || ch === "" || /\s/.test(ch);
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && /[\p{L}\p{N}]/u.test(ch);
}

/** Push text, merging with a trailing text node so the tree stays compact. */
function pushText(out: LessonInline[], text: string): void {
  if (text.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") {
    last.text += text;
  } else {
    out.push({ type: "text", text });
  }
}

/** Index of the closing `**` for an opener whose content starts at `from`, or -1. */
function findStrongClose(src: string, from: number): number {
  let i = src.indexOf("**", from);
  while (i !== -1) {
    // Closer must follow non-whitespace, must not be an escaped star, and must
    // have content (i > from).
    if (i > from && !isWhitespace(src[i - 1]) && src[i - 1] !== "\\") return i;
    i = src.indexOf("**", i + 1);
  }
  return -1;
}

/** Index of the closing single delimiter (`*` or `_`), or -1. */
function findEmClose(src: string, from: number, delimiter: "*" | "_"): number {
  let i = src.indexOf(delimiter, from);
  while (i !== -1) {
    const prev = src[i - 1];
    const next = src[i + 1];
    const adjacentSame = next === delimiter || prev === delimiter;
    const valid =
      i > from &&
      !isWhitespace(prev) &&
      prev !== "\\" &&
      !adjacentSame &&
      (delimiter === "*" || !isWordChar(next));
    if (valid) return i;
    i = src.indexOf(delimiter, i + 1);
  }
  return -1;
}

/** Parses `(url)` starting at the `(` at `open`. Returns [url, indexAfterClose] or null. */
function readLinkTarget(src: string, open: number): [string, number] | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return [src.slice(open + 1, i), i + 1];
    } else if (ch === " " || ch === "\n" || ch === "\t") {
      // No titles / no spaces: `[a](https://x "t")` degrades to text.
      return null;
    }
    // Bound the scan: nothing legitimate is this long.
    if (i - open > 2100) return null;
  }
  return null;
}

/** Index of the `]` matching the `[` at `open` (bracket depth aware), or -1. */
function findLinkTextClose(src: string, open: number): number {
  let depth = 0;
  const limit = Math.min(src.length, open + MAX_LINK_TEXT_SCAN);
  for (let i = open; i < limit; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseInlineInternal(src: string, depth: number, inLink: boolean): LessonInline[] {
  const out: LessonInline[] = [];
  // Closer validity depends only on the closer's own position (never on where
  // the opener was), so once a search from position p finds nothing, every
  // later opener would find nothing too — remember that instead of rescanning
  // (keeps unterminated-emphasis input linear rather than quadratic).
  let strongMissFrom = Number.POSITIVE_INFINITY;
  const emMissFrom = { "*": Number.POSITIVE_INFINITY, _: Number.POSITIVE_INFINITY };
  let buffer = "";
  const flush = (): void => {
    pushText(out, buffer);
    buffer = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        out.push({ type: "code", text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    if (ch === "*" && src[i + 1] === "*" && depth < MAX_INLINE_DEPTH && !isWhitespace(src[i + 2])) {
      const close = i + 2 >= strongMissFrom ? -1 : findStrongClose(src, i + 2);
      if (close === -1) strongMissFrom = Math.min(strongMissFrom, i + 2);
      if (close !== -1) {
        flush();
        out.push({ type: "strong", children: parseInlineInternal(src.slice(i + 2, close), depth + 1, inLink) });
        i = close + 2;
        continue;
      }
    }

    if (
      (ch === "*" || ch === "_") &&
      src[i + 1] !== ch &&
      depth < MAX_INLINE_DEPTH &&
      !isWhitespace(src[i + 1]) &&
      (ch === "*" || !isWordChar(src[i - 1]))
    ) {
      const close = i + 1 >= emMissFrom[ch] ? -1 : findEmClose(src, i + 1, ch);
      if (close === -1) emMissFrom[ch] = Math.min(emMissFrom[ch], i + 1);
      if (close !== -1) {
        flush();
        out.push({ type: "em", children: parseInlineInternal(src.slice(i + 1, close), depth + 1, inLink) });
        i = close + 1;
        continue;
      }
    }

    if (ch === "[" && !inLink && depth < MAX_INLINE_DEPTH) {
      const textClose = findLinkTextClose(src, i);
      if (textClose !== -1 && src[textClose + 1] === "(") {
        const target = readLinkTarget(src, textClose + 1);
        if (target) {
          const href = sanitizeHttpsUrl(target[0]);
          if (href !== null && textClose > i + 1) {
            flush();
            out.push({
              type: "link",
              href,
              children: parseInlineInternal(src.slice(i + 1, textClose), depth + 1, true),
            });
            i = target[1];
            continue;
          }
        }
      }
      // Anything else (`javascript:` targets, http:, relative, unterminated):
      // the whole thing stays literal text, visibly and harmlessly.
    }

    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/** Parses one run of inline Markdown (no newlines needed) into a typed tree. */
export function parseInline(src: string): LessonInline[] {
  if (src.length === 0) return [];
  if (src.length > MAX_INLINE_LENGTH) return [{ type: "text", text: src }];
  return parseInlineInternal(src, 0, false);
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const HEADING_RE = /^ {0,3}(#{3,4})[ \t]+(\S.*)$/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_RE = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;

interface ListMarker {
  indent: number;
  ordered: boolean;
  number: number;
  /** Column where the item's content starts (its continuation indent). */
  contentIndent: number;
  content: string;
}

function matchListMarker(line: string): ListMarker | null {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  const marker = m[2];
  const ordered = /\d/.test(marker);
  const spaces = m[3].length;
  // `-    x` with 5+ spaces is an indented code block in CommonMark; treat the
  // content as starting one space after the marker instead.
  const gap = spaces > 4 || spaces === 0 ? 1 : spaces;
  return {
    indent: m[1].length,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : 0,
    contentIndent: m[1].length + marker.length + gap,
    content: m[4] === undefined ? "" : (spaces > 4 ? " ".repeat(spaces - 1) : "") + m[4],
  };
}

/** `### Title ###` -> `Title` (linear; a closing run counts only after a space). */
function stripClosingHashes(text: string): string {
  let t = text.trimEnd();
  let end = t.length;
  while (end > 0 && t[end - 1] === "#") end--;
  if (end > 0 && end < t.length && t[end - 1] === " ") t = t.slice(0, end).trimEnd();
  return t;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

/** A line that begins a non-paragraph block and so ends a paragraph. */
function startsBlock(line: string): boolean {
  if (HEADING_RE.test(line) || QUOTE_RE.test(line)) return true;
  const marker = matchListMarker(line);
  if (!marker) return false;
  if (marker.content.trim().length === 0) return false;
  // CommonMark: only `1.`/`1)` may interrupt a paragraph, so a wrapped line
  // beginning "1998. " does not accidentally become a list.
  return !marker.ordered || marker.number === 1;
}

function parseBlocks(lines: string[], depth: number): LessonBlock[] {
  const blocks: LessonBlock[] = [];
  const structural = depth < MAX_BLOCK_DEPTH;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    if (structural) {
      const heading = HEADING_RE.exec(line);
      if (heading) {
        blocks.push({
          type: "heading",
          level: heading[1].length === 3 ? 3 : 4,
          children: parseInline(stripClosingHashes(heading[2])),
        });
        i++;
        continue;
      }

      if (QUOTE_RE.test(line)) {
        const inner: string[] = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) {
          inner.push(lines[i].replace(/^ {0,3}> ?/, ""));
          i++;
        }
        blocks.push({ type: "blockquote", children: parseBlocks(inner, depth + 1) });
        continue;
      }

      const first = matchListMarker(line);
      if (first && first.content.trim().length > 0) {
        const items: LessonBlock[][] = [];
        let itemLines: string[] = [];
        let contentIndent = first.contentIndent;
        let started = false;

        const closeItem = (): void => {
          if (started) items.push(parseBlocks(itemLines, depth + 1));
          itemLines = [];
        };

        // First item.
        itemLines.push(first.content);
        started = true;
        i++;

        while (i < lines.length) {
          const current = lines[i];
          if (isBlank(current)) {
            // Look past blank lines: the list continues only if the next
            // non-blank line is a sibling item or belongs to this item.
            let j = i;
            while (j < lines.length && isBlank(lines[j])) j++;
            if (j >= lines.length) {
              i = j;
              break;
            }
            const next = lines[j];
            const nextMarker = matchListMarker(next);
            const continues =
              indentOf(next) >= contentIndent ||
              (nextMarker !== null && nextMarker.ordered === first.ordered && nextMarker.indent < contentIndent);
            if (!continues) {
              i = j;
              break;
            }
            for (let k = i; k < j; k++) itemLines.push("");
            i = j;
            continue;
          }

          const marker = matchListMarker(current);
          if (marker && marker.indent < contentIndent && indentOf(current) < contentIndent) {
            if (marker.ordered !== first.ordered) break; // a different kind of list starts
            closeItem();
            itemLines = [marker.content];
            contentIndent = marker.contentIndent;
            started = true;
            i++;
            continue;
          }

          if (indentOf(current) >= contentIndent) {
            itemLines.push(current.slice(contentIndent));
            i++;
            continue;
          }

          // Lazy continuation of the item's last paragraph.
          const prev = itemLines[itemLines.length - 1];
          if (prev !== undefined && !isBlank(prev) && !startsBlock(current)) {
            itemLines.push(current.trim());
            i++;
            continue;
          }
          break;
        }
        closeItem();
        blocks.push({ type: "list", ordered: first.ordered, start: first.ordered ? first.number : 1, items });
        continue;
      }
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !(structural && startsBlock(lines[i]))) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
  }

  return blocks;
}

/**
 * Parses lesson Markdown into a typed block tree. Total: never throws, and any
 * non-string / empty input yields `[]`.
 */
export function parseLessonMarkdown(source: string): LessonBlock[] {
  if (typeof source !== "string" || source.length === 0) return [];
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines, 0);
}

// ---------------------------------------------------------------------------
// Plain-text projection (used by tests, and handy for search/aria labels)
// ---------------------------------------------------------------------------

export function inlineToPlainText(nodes: readonly LessonInline[]): string {
  return nodes
    .map((node) => (node.type === "text" || node.type === "code" ? node.text : inlineToPlainText(node.children)))
    .join("");
}

export function blocksToPlainText(blocks: readonly LessonBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
        case "heading":
          return inlineToPlainText(block.children);
        case "blockquote":
          return blocksToPlainText(block.children);
        case "list":
          return block.items.map((item) => blocksToPlainText(item)).join("\n");
      }
    })
    .join("\n");
}
