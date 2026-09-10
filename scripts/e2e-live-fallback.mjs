/**
 * Browser E2E regression for the Live degraded path.
 *
 * It deliberately makes `/api/interpret` return the server's deterministic
 * `provider: "local"` success response while exposing a browser Translator
 * implementation. The client must recognise that HTTP 200 is still degraded
 * and replace the Korean local output with on-device English.
 *
 * This does not pretend CI ships Chrome's real language pack. It verifies the
 * browser event wiring and the exact fallback transition the app controls.
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

const browser = await chromium.launch(chromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const pageProblems = [];
page.on("pageerror", (error) => pageProblems.push(`exception: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") pageProblems.push(`console: ${message.text()}`);
});

await page.addInitScript(() => {
  // Consent is not what this regression is testing. Seed the exact Live ack so
  // the Start click remains available for Translator.create(), matching a
  // returning operator's normal session.
  window.localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");

  window.__asadTranslatorCreated = 0;
  window.__asadTranslatorCalls = [];

  window.Translator = {
    create(options) {
      window.__asadTranslatorCreated += 1;
      options.monitor?.({
        addEventListener(type, listener) {
          if (type === "downloadprogress") listener({ loaded: 1 });
        },
      });
      return Promise.resolve({
        async translate(input) {
          window.__asadTranslatorCalls.push(input);
          return "We should love one another today.";
        },
        destroy() {},
      });
    },
  };

  class MockSpeechRecognition {
    lang = "";
    continuous = true;
    interimResults = true;
    maxAlternatives = 3;
    onresult = null;
    onerror = null;
    onend = null;
    onstart = null;
    emitted = false;

    start() {
      this.onstart?.();
      if (this.emitted) return;
      this.emitted = true;
      const first = { isFinal: true, length: 1, 0: { transcript: "오늘 우리는 서로를 사랑해야 합니다.", confidence: 0.99 } };
      window.setTimeout(() => { this.onresult?.({ resultIndex: 0, results: { length: 1, 0: first } }); }, 350);
      window.setTimeout(() => {
        this.onresult?.({
          resultIndex: 1,
          results: {
            length: 2,
            0: first,
            1: { isFinal: true, length: 1, 0: { transcript: "그리고 오늘도 함께 걸어갑니다.", confidence: 0.99 } },
          },
        });
      }, 2200);
    }

    stop() {
      this.onend?.();
    }

    abort() {
      this.onend?.();
    }
  }

  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
});

let forcedInterpretCalls = 0;
const forcedInterpretBodies = [];
await page.route("**/api/interpret", async (route) => {
  if (route.request().method() !== "POST") {
    await route.continue();
    return;
  }

  forcedInterpretCalls += 1;
  forcedInterpretBodies.push(JSON.parse(route.request().postData() ?? "{}"));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      output: {
        safeChunks: [
          {
            text: "오늘 우리는 서로를 사랑해야 합니다.",
            confidence: "medium",
          },
        ],
        confidence: "medium",
      },
      provider: "local",
      model: "deterministic",
      latencyMs: 1,
      degraded: true,
      reason: "Forced local provider for browser fallback E2E.",
    }),
  });
});

await page.goto(`${base}/live`, { waitUntil: "networkidle" });
await page.getByRole("radio", { name: /^브라우저/ }).click();
await page.getByRole("radio", { name: /^빠르게/ }).click();
await page.getByRole("button", { name: "통역 시작" }).click();

await page.waitForFunction(
  () => document.body.innerText.includes("We should love one another today."),
  undefined,
  { timeout: 12_000 },
);

const secondCallDeadline = Date.now() + 8_000;
while (forcedInterpretCalls < 2 && Date.now() < secondCallDeadline) await page.waitForTimeout(100);
const body = await page.locator("body").innerText();
const secondTelemetry = forcedInterpretBodies[1]?.clientTelemetry ?? [];
const secondTelemetryStages = new Set(secondTelemetry.map((sample) => sample.stage));
const translatorState = await page.evaluate(() => ({
  created: window.__asadTranslatorCreated ?? 0,
  calls: window.__asadTranslatorCalls ?? [],
}));

check(
  "real Live flow dispatched an interpretation request",
  forcedInterpretCalls > 0,
  `${forcedInterpretCalls} forced local response(s)`,
);
check(
  "a later Live turn piggybacks earlier client latency",
  forcedInterpretCalls >= 2 && secondTelemetryStages.has("stable_to_client_dispatch") && secondTelemetryStages.has("stable_to_safe") && secondTelemetryStages.has("stable_to_render"),
  `${secondTelemetry.length} client sample(s) on turn 2`,
);
check(
  "client latency payload contains no transcript text",
  !JSON.stringify(secondTelemetry).includes("오늘") && !JSON.stringify(secondTelemetry).includes("사랑"),
);
check(
  "Start gesture prepared the browser Translator",
  translatorState.created === 1,
  `Translator.create called ${translatorState.created} time(s)`,
);
check(
  "server HTTP 200 local response was translated on-device",
  translatorState.calls.includes("오늘 우리는 서로를 사랑해야 합니다."),
  `${translatorState.calls.length} Translator.translate call(s)`,
);
check(
  "Live console shows English from the browser fallback",
  body.includes("We should love one another today."),
);
check(
  "browser fallback did not crash the page",
  pageProblems.length === 0,
  pageProblems.join(" | "),
);

await page.screenshot({ path: join(outDir, "live-browser-fallback.png"), fullPage: true });
await browser.close();

const failed = checks.filter((item) => !item.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} browser fallback checks passed`);
if (failed.length > 0) process.exit(1);
