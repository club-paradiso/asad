/**
 * Generates the PWA icons and the square brand icon.
 *
 * This used to be a hand-written PNG encoder drawing three stacked bars — the
 * committed / current / anticipated chunk states. That mark described the
 * console's mechanism; it did not describe the product, and it could not draw
 * the one the brand now has (a question mark whose dot is a check), because a
 * pixel-buffer encoder cannot draw a curve.
 *
 * So it rasterises the real SVG in the browser that is already a dev
 * dependency, which also means the icon and the in-app `<Mark>` can never
 * drift: both are the same path data.
 *
 * Run with `npm run icons`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const PAPER = "#faf7f2";
const INK = "#12100e";
const RED = "#c81e1e";

/**
 * The mark, at icon scale.
 *
 * Two departures from the in-app component, both because an icon is read at
 * 40px on a home screen rather than at 24px in a header:
 *   - the strokes are heavier, so the hook survives downscaling;
 *   - the tick is drawn on ink, not paper, because a launcher grid puts this
 *     next to other icons and the dark field is what separates it from them.
 */
const mark = (bg, hook, tick, inset) => `
  <rect width="512" height="512" fill="${bg}"/>
  <g transform="translate(${inset}, ${inset}) scale(${(512 - inset * 2) / 32})"
     fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.5 10.6c0-3.5 2.9-6.1 6.6-6.1 3.8 0 6.5 2.4 6.5 5.8 0 2.8-1.5 4.3-3.9 5.9-2 1.3-2.7 2.3-2.7 4.1v.8"
          stroke="${hook}" stroke-width="4"/>
    <path d="m11.9 27.1 2.7 2.6 5.5-6.2" stroke="${tick}" stroke-width="4"/>
  </g>`;

/**
 * `maskable` gets a much larger inset: Android crops a maskable icon to
 * whatever shape the launcher likes, and anything outside the safe circle
 * (80% of the width) can be cut. The hook's tail is the first thing to go.
 */
const ICONS = [
  { file: "icon-192.png", size: 192, svg: mark(INK, PAPER, RED, 96) },
  { file: "icon-512.png", size: 512, svg: mark(INK, PAPER, RED, 96) },
  { file: "icon-maskable-512.png", size: 512, svg: mark(INK, PAPER, RED, 136) },
  { file: "favicon.png", size: 64, svg: mark(INK, PAPER, RED, 88) },
  // The square brand icon an embed host or store listing asks for. Paper
  // ground: it is shown on the host's own chrome, which is usually light, and
  // a black tile there reads as a missing image.
  { file: "brand-600.png", size: 600, svg: mark(PAPER, INK, RED, 108) },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage();

for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block}</style>` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" ` +
      `width="${icon.size}" height="${icon.size}">${icon.svg}</svg>`,
  );
  const buffer = await page.locator("svg").screenshot({ omitBackground: false });
  writeFileSync(join(OUT, icon.file), buffer);
  console.log(`wrote ${icon.file} (${icon.size}px)`);
}

await browser.close();
