/**
 * RANGEPICKER-002 — real WCAG contrast of `components/ui/PassagePicker.module.css`
 * against the real tokens in `app/globals.css`.
 *
 * Nothing is hand-transcribed: this file parses the two CSS files' own text.
 * `PassagePicker.module.css` binds six `--pp-*` roles per surface (page /
 * shell) to `var(--token)` references; `globals.css` supplies the hex behind
 * each token, once for parchment (`:root`) and once for midnight
 * (`:root[data-reading="midnight"]`, which overrides only --page-* / --brass /
 * --crimson / ... — the --shell-* family is identical in both). A change to
 * either file therefore changes what is asserted here.
 *
 * Thresholds (WCAG 2.1): text 4.5:1 (1.4.3); a form control's edge, a focus
 * ring and an invalid-state border 3:1 (1.4.11) against every colour they
 * touch. A disabled control is exempt (1.4.3 / 1.4.11), so none is asserted.
 *
 * Set CONTRAST_TABLE=1 to print every measured pair.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { contrastRatio as themeContrastRatio } from "@/lib/theme";

// --- tiny pure WCAG helper (deliberately independent of lib/theme.ts) -------

function channel(value8: number): number {
  const c = value8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- parse the two real CSS files -------------------------------------------

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const clean = stripComments(css);
  const start = clean.indexOf(`${selector} {`);
  assert.ok(start >= 0, `rule not found: ${selector}`);
  const open = clean.indexOf("{", start);
  return clean.slice(open + 1, clean.indexOf("}", open));
}
function customProps(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

const globals = read("app/globals.css");
const pickerCss = read("components/ui/PassagePicker.module.css");

const PARCHMENT = customProps(ruleBody(globals, ":root"));
const MIDNIGHT = { ...PARCHMENT, ...customProps(ruleBody(globals, ':root[data-reading="midnight"]')) };
const THEMES = { parchment: PARCHMENT, midnight: MIDNIGHT } as const;

const PAGE_BINDINGS = customProps(ruleBody(pickerCss, ".picker"));
const SHELL_BINDINGS = { ...PAGE_BINDINGS, ...customProps(ruleBody(pickerCss, '.picker[data-surface="shell"]')) };

const ROLES = ["--pp-label", "--pp-ink", "--pp-fill", "--pp-border", "--pp-error", "--pp-focus"] as const;

function tokenName(binding: string): string {
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(binding);
  assert.ok(m, `binding must be a bare var(--token): ${binding}`);
  return m[1];
}
function hexOf(theme: Record<string, string>, token: string): string {
  const value = theme[token];
  assert.ok(value && /^#[0-9a-f]{6}$/i.test(value), `${token} is not a 6-digit hex in globals.css: ${value}`);
  return value;
}
function resolveRole(bindings: Record<string, string>, theme: Record<string, string>, role: string): string {
  return hexOf(theme, tokenName(bindings[role]));
}

interface Pair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

/** Every foreground/background pair a picker on `surface` actually produces. */
function pairsFor(surface: "page" | "shell", theme: Record<string, string>): Pair[] {
  const bindings = surface === "shell" ? SHELL_BINDINGS : PAGE_BINDINGS;
  const role = (r: string) => resolveRole(bindings, theme, r);
  // What the picker's own fill / labels sit on top of, per surface.
  const beneath =
    surface === "shell"
      ? { "--shell-bg (section background)": hexOf(theme, "--shell-bg") }
      : { "--page-bg": hexOf(theme, "--page-bg"), "--page-card": hexOf(theme, "--page-card") };
  const fill = role("--pp-fill");
  const pairs: Pair[] = [];
  for (const [bgName, bg] of Object.entries(beneath)) {
    pairs.push({ name: `label / legend / status text on ${bgName}`, fg: role("--pp-label"), bg, min: 4.5 });
    pairs.push({ name: `error message text on ${bgName}`, fg: role("--pp-error"), bg, min: 4.5 });
    pairs.push({ name: `select border vs ${bgName}`, fg: role("--pp-border"), bg, min: 3 });
    pairs.push({ name: `focus ring vs ${bgName}`, fg: role("--pp-focus"), bg, min: 3 });
    pairs.push({ name: `invalid border vs ${bgName}`, fg: role("--pp-error"), bg, min: 3 });
  }
  pairs.push({ name: "select text on select fill", fg: role("--pp-ink"), bg: fill, min: 4.5 });
  pairs.push({ name: "select border vs select fill", fg: role("--pp-border"), bg: fill, min: 3 });
  pairs.push({ name: "focus ring vs select fill", fg: role("--pp-focus"), bg: fill, min: 3 });
  pairs.push({ name: "invalid border vs select fill", fg: role("--pp-error"), bg: fill, min: 3 });
  return pairs;
}

const printTable = process.env.CONTRAST_TABLE === "1";

for (const surface of ["shell", "page"] as const) {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    test(`CONTRAST: PassagePicker surface="${surface}" in ${themeName} reading theme clears WCAG for every text / border / error / focus pair`, () => {
      const failures: string[] = [];
      for (const pair of pairsFor(surface, theme)) {
        const ratio = contrast(pair.fg, pair.bg);
        if (printTable) {
          console.log(
            `${surface.padEnd(5)} ${themeName.padEnd(9)} ${ratio.toFixed(2).padStart(6)}:1 (>= ${pair.min})  ${pair.fg} on ${pair.bg}  ${pair.name}`,
          );
        }
        if (ratio < pair.min) {
          failures.push(`${pair.name}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(3)}:1, needs ${pair.min}:1`);
        }
      }
      assert.deepEqual(failures, []);
    });
  }
}

test("CONTRAST: the shell surface is reading-theme independent -- it binds only --shell-* / --gold, and resolves identically in both themes", () => {
  for (const role of ROLES) {
    const token = tokenName(SHELL_BINDINGS[role]);
    assert.ok(/^--(shell-|gold$)/.test(token), `${role} -> ${token}: a shell-surface role must not use a --page-* token`);
    assert.equal(hexOf(PARCHMENT, token), hexOf(MIDNIGHT, token), `${token} differs between reading themes`);
  }
});

test("CONTRAST: every --pp-* role is bound for BOTH surfaces (a missing binding would silently inherit nothing)", () => {
  for (const role of ROLES) {
    assert.ok(PAGE_BINDINGS[role], `page surface lacks ${role}`);
    assert.ok(SHELL_BINDINGS[role], `shell surface lacks ${role}`);
  }
});

test("CONTRAST: the module reads colour only through --pp-* roles (no stray hard-coded or --page-*/--shell-* colour that bypasses the checked bindings)", () => {
  const css = stripComments(pickerCss);
  const roleBlocks = [ruleBody(pickerCss, ".picker"), ruleBody(pickerCss, '.picker[data-surface="shell"]')];
  let rest = css;
  for (const body of roleBlocks) rest = rest.replace(body, "");
  const colourDecl = /(?:^|[\s;{])(color|background|background-color|border-color|border|outline)\s*:\s*([^;]+);/g;
  for (const m of rest.matchAll(colourDecl)) {
    const value = m[2];
    if (/^\s*0\s*$/.test(value) || /\btransparent\b/.test(value) || /^\s*\d+px solid var\(--pp-[a-z]+\)\s*$/.test(value)) continue;
    assert.ok(/var\(--pp-[a-z]+\)/.test(value), `${m[1]}: ${value.trim()} bypasses the --pp-* roles`);
  }
});

test("CONTRAST: the helper agrees with lib/theme.ts's contrastRatio, and documents the pre-fix failure (--page-muted on --shell-bg, parchment)", () => {
  for (const [a, b] of [
    ["#eae7e1", "#07080a"],
    ["#686e69", "#07080a"],
    ["#233029", "#fffef9"],
  ]) {
    assert.ok(Math.abs(contrast(a, b) - themeContrastRatio(a, b)) < 1e-9);
  }
  // Before RANGEPICKER-002 the picker's label colour in the parchment theme was `var(--page-muted, ...)` on the shell.
  const before = contrast(hexOf(PARCHMENT, "--page-muted"), hexOf(PARCHMENT, "--shell-bg"));
  assert.ok(before < 4.5, `expected the old binding to fail 4.5:1, got ${before.toFixed(3)}`);
});
