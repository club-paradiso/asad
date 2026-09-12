/**
 * Browser E2E regression for what the Live console says when it breaks.
 *
 * Failure in a booth is not hypothetical: a microphone gets denied, a headset
 * is unplugged, a platform speech service hiccups. What the interpreter is
 * told at that moment is the product. So each scenario here drives a real
 * recogniser failure through the real console and asserts three things:
 *
 *   1. the status strip is quiet while the session is healthy — no provider
 *      name, no model, no routing state, no lag profile;
 *   2. a genuine failure is unmistakable and written in plain language;
 *   3. no message anywhere is a raw recogniser error code, and the advice
 *      matches the actual fault — a denied microphone used to be reported as
 *      a connection problem, sending the interpreter to check the venue Wi-Fi
 *      over a permission prompt they could have answered in two taps.
 *
 * SpeechRecognition is mocked so the failures are deterministic. The console,
 * the engine and the provider's own recovery rules are the real ones.
 */
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = process.argv[3] ?? "./e2e-out";
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, passed, detail = "") => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Every Web Speech error code, so none of them can leak into a sentence. */
const CODES = [
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "network",
  "language-not-supported",
  "a-code-from-a-future-browser",
];

const browser = await chromium.launch(chromiumLaunchOptions());

/**
 * Start a Live session on the browser recogniser, then hand control of it to
 * the caller. `recover` decides whether a restart succeeds, so a transient
 * failure and a permanent one can both be held still long enough to read.
 */
async function session(recover) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`exception: ${error.message}`));

  await page.addInitScript((allowRestart) => {
    // Consent is not what this regression is testing.
    window.localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");
    window.__starts = 0;
    class MockSpeechRecognition {
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 3;
      start() {
        window.__rec = this;
        window.__starts += 1;
        if (window.__starts === 1 || allowRestart) setTimeout(() => this.onstart?.(), 10);
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  }, recover);

  await page.goto(`${base}/live`, { waitUntil: "domcontentloaded" });
  await page.getByRole("radio", { name: "브라우저" }).click();
  await page.getByRole("button", { name: /통역 시작/ }).click();
  await page.waitForTimeout(1200);
  return { page, context, problems };
}

const readConsole = (page) =>
  page.evaluate(() => {
    const surface = document.querySelector('[data-surface="live"]');
    const strip = surface?.querySelector('header [role="status"]');
    return {
      strip: strip?.textContent?.trim() ?? "",
      header: surface?.querySelector("header")?.textContent?.trim() ?? "",
      body: surface?.textContent ?? "",
    };
  });

/* --- A healthy session says almost nothing ------------------------------- */
{
  const { page, context, problems } = await session(true);
  const state = await readConsole(page);
  check("a healthy session reports one word", state.strip === "Live", `strip: "${state.strip}"`);
  check(
    "the status strip carries no diagnostics",
    !/Browser|Deepgram|OpenAI|AI |Balanced|Sermon|local/i.test(state.header),
    `header: "${state.header.replace(/\s+/g, " ")}"`,
  );
  check("no page errors while healthy", problems.length === 0, problems.join(" | "));
  await page.screenshot({ path: join(outDir, "live-failure-healthy.png") });
  await context.close();
}

/* --- A denied microphone is named, and the advice fits ------------------- */
{
  const { page, context, problems } = await session(false);
  await page.evaluate(() => window.__rec?.onerror?.({ error: "not-allowed" }));
  await page.waitForTimeout(900);
  const state = await readConsole(page);

  check(
    "a denied microphone stops the session visibly",
    /Not listening/.test(state.strip),
    `strip: "${state.strip}"`,
  );
  check(
    "the advice is about permission, not the network",
    /Allow it in the browser/.test(state.body) && !/Check the connection/.test(state.body),
    /Allow it in the browser/.test(state.body) ? "" : "permission advice missing",
  );
  check(
    "the interpreter is offered a way back",
    await page.getByRole("button", { name: /Try again/ }).isVisible(),
  );
  check("no page errors on a denied microphone", problems.length === 0, problems.join(" | "));
  await page.screenshot({ path: join(outDir, "live-failure-mic-denied.png") });
  await context.close();
}

/* --- A transient failure recovers without alarming anyone ---------------- */
{
  const { page, context, problems } = await session(true);
  await page.evaluate(() => window.__rec?.onerror?.({ error: "audio-capture" }));
  await page.waitForTimeout(1500);
  const state = await readConsole(page);

  check(
    "a blip that healed leaves the console calm again",
    state.strip === "Live",
    `strip: "${state.strip}"`,
  );
  check(
    "a blip that healed said nothing to an interpreter mid-sentence",
    !/Try again/.test(state.body),
  );
  check("no page errors on a transient blip", problems.length === 0, problems.join(" | "));
  await context.close();
}

/* --- An unfamiliar code still ends somewhere the interpreter can act ----- */
{
  const { page, context, problems } = await session(false);
  // Spend the recogniser's retry budget on a code it has never seen.
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => window.__rec?.onerror?.({ error: "a-code-from-a-future-browser" }));
    await page.waitForTimeout(700);
  }
  const state = await readConsole(page);

  check(
    "an unfamiliar failure ends in a state the interpreter can act on",
    /Not listening/.test(state.strip) || /Try again/.test(state.body),
    `strip: "${state.strip}"`,
  );
  check(
    "no recogniser error code is ever shown",
    CODES.every((code) => !state.body.includes(code)),
    CODES.filter((code) => state.body.includes(code)).join(", "),
  );
  check("no page errors on an unfamiliar failure", problems.length === 0, problems.join(" | "));
  await page.screenshot({ path: join(outDir, "live-failure-unknown.png") });
  await context.close();
}

await browser.close();

const failed = checks.filter((item) => !item.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} live failure checks passed`);
if (failed.length > 0) process.exit(1);
