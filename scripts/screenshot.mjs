/**
 * Device screenshots for the design acceptance pass.
 *
 * The console has to be judged on the devices it will actually be used on —
 * an iPhone propped in a church booth, an iPad on a stand, a laptop — so this
 * drives a real browser at those viewports and can run a short interaction
 * script first.
 *
 *   node scripts/screenshot.mjs <url> <out.png> <preset> <waitMs> "click:Start|wait:8000|key:t"
 */
import { chromium } from "playwright";

const [, , url = "http://localhost:3000/", out = "shot.png", preset = "laptop", waitMs = "2000", actions = ""] =
  process.argv;

const PRESETS = {
  "iphone-landscape": { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "iphone-portrait": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "ipad-landscape": { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "ipad-portrait": { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
};

const config = PRESETS[preset];
if (!config) {
  console.error(`Unknown preset "${preset}". Known: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const context = await browser.newContext({ ...config, colorScheme: "dark" });
const page = await context.newPage();

const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`exception: ${error.message}`));

await page.goto(url, { waitUntil: "networkidle" });

for (const action of actions.split("|").filter(Boolean)) {
  const [kind, value] = action.split(":");
  if (kind === "click") await page.getByText(value, { exact: false }).first().click();
  else if (kind === "key") await page.keyboard.press(value);
  else if (kind === "wait") await page.waitForTimeout(Number(value));
}

await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
await browser.close();

console.log(`wrote ${out}`);
if (problems.length) {
  console.log("page problems:");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}
