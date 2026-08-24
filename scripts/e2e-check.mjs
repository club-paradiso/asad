/**
 * End-to-end flow check against a running server.
 *
 * Covers the paths that unit tests cannot: the prep brief round trip, the
 * correction UI, saving a session, the post-session review, export, and the
 * saved-sessions list. Run it after `npm run build && npm start`.
 *
 *   node scripts/e2e-check.mjs http://localhost:3000 ./out
 *
 * Exits non-zero if any check fails or the page logs an error.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = process.argv[3] ?? "./e2e-out";
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
  acceptDownloads: true,
});
const page = await context.newPage();

const pageProblems = [];
page.on("pageerror", (error) => pageProblems.push(`exception: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") pageProblems.push(`console: ${message.text()}`);
});

// --- Prep -----------------------------------------------------------------
await page.goto(`${base}/prep`, { waitUntil: "networkidle" });
await page.getByPlaceholder("류정길").fill("류정길");
await page.getByPlaceholder("새길교회").fill("새길교회");
await page.getByPlaceholder("Our Identity in Christ").fill("택하신 족속");
await page.getByPlaceholder("1 Peter 2:9").fill("1 Peter 2:9");
await page.getByRole("button", { name: /Build interpretation brief/ }).click();
await page.waitForTimeout(2500);

const brief = await page.locator("body").innerText();
check("prep romanises the speaker", /Ryu Jeong-gil/.test(brief));
check("prep resolves the main passage", /1 Peter 2:9/.test(brief));
check("prep names real difficulties", /predicate/i.test(brief));
await page.screenshot({ path: join(outDir, "prep.png") });

// --- Live session ---------------------------------------------------------
await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("Start interpreting").click();
await page.waitForTimeout(3000);

await page.getByLabel("Session settings").click();
await page.getByRole("switch", { name: /Save this session/ }).click();
await page.getByPlaceholder("유정길").fill("유정길");
await page.getByPlaceholder("류정길").fill("류정길");
await page.getByRole("button", { name: "Apply correction" }).click();
await page.waitForTimeout(300);
check(
  "correction previews the bound romanisation",
  /Ryu Jeong-gil/.test(await page.locator("body").innerText()),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(14000);

// --- Review ---------------------------------------------------------------
await page.getByRole("button", { name: "End" }).click();
await page.waitForTimeout(1500);

const review = await page.locator("body").innerText();
check("review renders", /SUGGESTED PREP FOR NEXT TIME/i.test(review));
check("review lists Scripture", /1 Peter 2:9/.test(review));
check("review carries the transcript", /베드로전서/.test(review));
check(
  "review suggests the corrected name for next time",
  /류정길[\s\S]{0,60}Ryu Jeong-gil/.test(review),
);
await page.screenshot({ path: join(outDir, "review.png") });

// --- Export ---------------------------------------------------------------
const pendingDownload = page.waitForEvent("download");
await page.getByRole("button", { name: "Export Markdown" }).click();
const download = await pendingDownload;
const exported = join(outDir, "session.md");
await download.saveAs(exported);

const markdown = readFileSync(exported, "utf8");
check("export contains both languages", /## Interpreter English/.test(markdown) && /베드로전서/.test(markdown));
check("export transcript uses the corrected name", !/저는 오늘 말씀을 전하게 된 유정길/.test(markdown));
check("export records the correction itself", /유정길 → \*\*류정길\*\*/.test(markdown));
check("export contains no audio", !/audio|base64|pcm16|blob:/i.test(markdown));

// --- Saved sessions -------------------------------------------------------
await page.goto(`${base}/sessions`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
check(
  "saved session appears in the list",
  !/No saved sessions/.test(await page.locator("body").innerText()),
);
await page.screenshot({ path: join(outDir, "sessions.png") });

await browser.close();

// --- Report ---------------------------------------------------------------
if (pageProblems.length) {
  console.log("\nPage problems:");
  for (const problem of pageProblems) console.log(`  ${problem}`);
}

const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed || pageProblems.length) process.exit(1);
