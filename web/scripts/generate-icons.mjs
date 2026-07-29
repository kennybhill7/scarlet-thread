/**
 * Generates the PWA install icons referenced by web/app/manifest.ts.
 *
 * Next.js's code-generated icon convention (app/icon.tsx via next/og) covers
 * the browser-tab favicon and the Apple touch icon well, but a manifest's
 * `icons` array wants fixed, precisely-sized static PNGs -- especially the
 * "maskable" purpose, which needs real safe-zone padding baked into the
 * pixels so Android's circular/squircle mask doesn't clip the mountain peak.
 * That's simplest as a one-time build step, not a per-request route.
 *
 * Lives under web/scripts/ rather than tools/ because it needs `sharp`,
 * which is only installed in web/node_modules (a transitive dependency of
 * Next's own image optimization) -- Node's module resolution won't reach
 * across from a sibling tools/ directory. It is dev-only tooling, not app
 * runtime code; nothing under web/app or web/lib depends on it.
 *
 * The glyph is deliberately simple: a gold ascent/descent silhouette on the
 * app's own dark shell colour, echoing the Climb screen rather than
 * introducing a fourth visual language into a one-evening icon.
 *
 * Usage:  node scripts/generate-icons.mjs   (run from web/)
 * Author: Kenneth Hill
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, "..", "public", "icons");
const APP_DIR = path.join(ROOT, "..", "app");

const SHELL_BG = "#0d1420";
const GOLD = "#e8b465";
const GOLD_DEEP = "#d99a58";

/** The mountain glyph, drawn on a 100x100 viewBox. `pad` shrinks it toward
 * the center so a maskable OS crop-circle never clips the peak. */
function mountainSvg({ pad = 0 }) {
  const s = 100 - pad * 2;
  const o = pad;
  const points = [
    [o + s * 0.06, o + s * 0.82],
    [o + s * 0.36, o + s * 0.4],
    [o + s * 0.5, o + s * 0.58],
    [o + s * 0.64, o + s * 0.4],
    [o + s * 0.94, o + s * 0.82],
  ]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const peakDot = [o + s * 0.5, o + s * 0.58 - s * 0.16];

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GOLD}"/>
      <stop offset="1" stop-color="${GOLD_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="${SHELL_BG}"/>
  <polyline points="${points}" fill="none" stroke="url(#g)" stroke-width="${(s * 0.055).toFixed(2)}"
    stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${peakDot[0].toFixed(2)}" cy="${peakDot[1].toFixed(2)}" r="${(s * 0.045).toFixed(2)}" fill="${GOLD}"/>
</svg>`.trim();
}

async function render(svg, size, file) {
  const buffer = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(path.join(OUT_DIR, file), buffer);
  console.log(`  ${file} (${size}x${size}, ${(buffer.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Generating icons -> ${path.relative(process.cwd(), OUT_DIR)}`);

  const flush = mountainSvg({ pad: 0 });
  const safe = mountainSvg({ pad: 14 }); // ~20% safe zone for maskable

  await render(flush, 192, "icon-192.png");
  await render(flush, 512, "icon-512.png");
  await render(safe, 192, "maskable-192.png");
  await render(safe, 512, "maskable-512.png");
  await render(flush, 180, "apple-touch-icon.png");

  // Also drop copies where Next's file-convention auto-detects them, so the
  // browser tab and iOS home-screen icons are wired with zero extra markup.
  const faviconBuffer = await sharp(Buffer.from(mountainSvg({ pad: 0 })))
    .resize(48, 48)
    .png()
    .toBuffer();
  await writeFile(path.join(APP_DIR, "icon.png"), faviconBuffer);
  console.log("  app/icon.png (48x48) — replaces the default favicon.ico");

  const appleBuffer = await sharp(Buffer.from(flush)).resize(180, 180).png().toBuffer();
  await writeFile(path.join(APP_DIR, "apple-icon.png"), appleBuffer);
  console.log("  app/apple-icon.png (180x180)");

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
