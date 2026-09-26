import { Fragment, type CSSProperties, type ReactNode } from "react";

import {
  parseLessonMarkdown,
  type LessonBlock,
  type LessonInline,
} from "@/lib/content/lessonMarkdown";

/**
 * LESSONRENDER-001 — renders published lesson Markdown (a SAFE SUBSET, parsed
 * by `lib/content/lessonMarkdown.ts` into a typed block tree) to real React
 * elements: paragraphs, sub-headings, lists, blockquotes, bold/italic/code
 * and https links.
 *
 * HOOKLESS, PURE VIEW: no state, no effects, no browser API — it renders
 * identically on the server and the client and under
 * `react-dom/server`'s `renderToStaticMarkup` (which is how it is tested).
 *
 * SAFETY: the only input is the parser's output. Text goes through React's
 * normal text-node escaping; there is NO `dangerouslySetInnerHTML` anywhere in
 * this file, and the only attribute that ever carries lesson-supplied data is
 * a link `href` the parser has already restricted to normalised `https:` URLs.
 *
 * STYLING: inline `CSSProperties` referencing only the CSS custom properties
 * declared in `app/globals.css` (no colour literals), and no `.module.css`
 * import — `WorkspaceShell.tsx`'s header explains that trade (the frozen
 * `tests/study-page.test.ts` stubs a fixed list of CSS Modules). The surface
 * is the app's "Notecards" PAGE layer (`--page-card` / `--page-ink`), not the
 * always-dark SHELL layer, so lesson prose is set the way the reading surface
 * is: serif (`--font-read`), 17px / 1.6, a measure of about 68 characters, and
 * it follows the parchment / midnight reading preference via the `--page-*`
 * tokens rather than being pinned to the shell's dark stone.
 *
 * SCRIPTS: Hebrew and Greek runs are wrapped in `lang`/`dir`-tagged spans so
 * they get the right shaping, direction and fallback fonts (plan section B.2).
 */

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cardStyle: CSSProperties = {
  background: "var(--page-card)",
  color: "var(--page-ink)",
  border: "1px solid var(--page-border)",
  borderRadius: "var(--r-md)",
  padding: "16px 18px",
  margin: "0 0 12px",
  fontFamily: "var(--font-read)",
  fontSize: 17,
  lineHeight: 1.6,
  overflowWrap: "break-word",
};

const columnStyle: CSSProperties = { maxWidth: "68ch" };

const headerRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  margin: "0 0 10px",
};

const headingLabelStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-narrow)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--brass)",
};

const paragraphStyle: CSSProperties = { margin: "0 0 1em" };

const subHeadingStyle: CSSProperties = {
  margin: "1.2em 0 0.4em",
  fontFamily: "var(--font-display)",
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.3,
  color: "var(--page-ink)",
};

const minorHeadingStyle: CSSProperties = { ...subHeadingStyle, fontSize: 16 };

const itemParagraphStyle: CSSProperties = { margin: "0 0 0.35em" };

const listStyle: CSSProperties = { margin: "0 0 1em", paddingLeft: "1.4em" };

const itemStyle: CSSProperties = { margin: "0 0 0.45em", paddingLeft: "0.2em" };

const quoteStyle: CSSProperties = {
  margin: "0 0 1em",
  padding: "2px 0 2px 14px",
  borderLeft: "3px solid var(--brass)",
  color: "var(--page-ink-2)",
};

const linkStyle: CSSProperties = {
  color: "var(--green)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: "0.88em",
  background: "var(--page-bg)",
  border: "1px solid var(--page-border-soft)",
  borderRadius: 4,
  padding: "0 0.3em",
};

const hebrewStyle: CSSProperties = {
  fontFamily: '"SBL Hebrew", "Ezra SIL", "Noto Serif Hebrew", var(--font-read)',
  fontSize: "1.08em",
  unicodeBidi: "isolate",
};

const greekStyle: CSSProperties = {
  fontFamily: '"SBL Greek", "Gentium Plus", "Noto Serif", var(--font-read)',
  unicodeBidi: "isolate",
};

// ---------------------------------------------------------------------------
// Script (Hebrew / Greek) spans
// ---------------------------------------------------------------------------

const HEBREW = "\\u0590-\\u05FF\\uFB1D-\\uFB4F";
const GREEK = "\\u0370-\\u03FF\\u1F00-\\u1FFF";
const SCRIPT_RUN = new RegExp(
  `[${HEBREW}]+(?:[ \\u00A0][${HEBREW}]+)*|[${GREEK}]+(?:[ \\u00A0][${GREEK}]+)*`,
  "g",
);
const HEBREW_START = new RegExp(`^[${HEBREW}]`);

/** Splits `text` into plain strings and lang-tagged Hebrew/Greek spans. */
function renderScriptRuns(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(SCRIPT_RUN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const run = match[0];
    if (HEBREW_START.test(run)) {
      nodes.push(
        <span dir="rtl" key={`${keyPrefix}-s${n}`} lang="he" style={hebrewStyle}>
          {run}
        </span>,
      );
    } else {
      nodes.push(
        <span key={`${keyPrefix}-s${n}`} lang="grc" style={greekStyle}>
          {run}
        </span>,
      );
    }
    n++;
    last = index + run.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ---------------------------------------------------------------------------
// Tree -> elements
// ---------------------------------------------------------------------------

function renderInline(nodes: readonly LessonInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{renderScriptRuns(node.text, key)}</Fragment>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "code":
        return (
          <code key={key} style={codeStyle}>
            {node.text}
          </code>
        );
      case "link":
        return (
          <a href={node.href} key={key} rel="noopener noreferrer" style={linkStyle} target="_blank">
            {renderInline(node.children, key)}
          </a>
        );
    }
  });
}

function renderBlocks(
  blocks: readonly LessonBlock[],
  keyPrefix: string,
  trimLast: boolean,
  inItem = false,
): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    const isLast = trimLast && index === blocks.length - 1;
    const bottom: CSSProperties = isLast ? { marginBottom: 0 } : {};
    switch (block.type) {
      case "paragraph":
        return (
          <p key={key} style={{ ...paragraphStyle, ...(inItem ? itemParagraphStyle : {}), ...bottom }}>
            {renderInline(block.children, key)}
          </p>
        );
      case "heading": {
        // The section's own label is an <h4>; lesson sub-headings sit beneath it.
        const Tag = block.level === 3 ? "h5" : "h6";
        return (
          <Tag key={key} style={block.level === 3 ? subHeadingStyle : minorHeadingStyle}>
            {renderInline(block.children, key)}
          </Tag>
        );
      }
      case "blockquote":
        return (
          <blockquote key={key} style={{ ...quoteStyle, ...bottom }}>
            {renderBlocks(block.children, key, true)}
          </blockquote>
        );
      case "list": {
        const items = block.items.map((item, itemIndex) => {
          const itemKey = `${key}-i${itemIndex}`;
          // A tight item (one paragraph) renders its text directly in the <li>.
          const only = item.length === 1 ? item[0] : null;
          return (
            <li key={itemKey} style={itemStyle}>
              {only && only.type === "paragraph"
                ? renderInline(only.children, itemKey)
                : renderBlocks(item, itemKey, true, true)}
            </li>
          );
        });
        return block.ordered ? (
          <ol key={key} start={block.start !== 1 ? block.start : undefined} style={{ ...listStyle, ...bottom }}>
            {items}
          </ol>
        ) : (
          <ul key={key} style={{ ...listStyle, ...bottom }}>
            {items}
          </ul>
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LessonProseProps {
  /** The lesson section's Markdown (safe subset — see `lib/content/lessonMarkdown.ts`). */
  markdown: string;
  /** Optional label shown above the prose (rendered as an `<h4>` in the label voice). */
  heading?: string;
  /** Optional slot beside the label, e.g. a provenance chip. Nothing renders here by default. */
  provenance?: ReactNode;
  /** `data-testid` for the wrapper. */
  testId?: string;
}

/**
 * Renders one lesson section's Markdown. An empty / whitespace-only
 * `markdown` renders nothing at all (never an empty card).
 */
export function LessonProse({ markdown, heading, provenance, testId }: LessonProseProps) {
  const blocks = parseLessonMarkdown(markdown);
  if (blocks.length === 0) return null;
  return (
    <div data-lesson-prose="" data-testid={testId} style={cardStyle}>
      {heading || provenance ? (
        <div style={headerRowStyle}>
          {heading ? <h4 style={headingLabelStyle}>{heading}</h4> : <span />}
          {provenance ?? null}
        </div>
      ) : null}
      <div style={columnStyle}>{renderBlocks(blocks, "b", true)}</div>
    </div>
  );
}
