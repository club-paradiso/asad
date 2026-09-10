/**
 * A quota failure must cost one cloud turn, not every following sentence.
 * The Translator API is mocked here; CI does not claim to exercise Chrome's
 * downloadable Korean-English language pack.
 */
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch(chromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(error.message));

await page.addInitScript(() => {
  window.localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");
  window.__quotaTranslations = [];
  window.Translator = {
    create() {
      return Promise.resolve({
        async translate(input) {
          window.__quotaTranslations.push(input);
          return input.includes("그리고")
            ? "And we keep walking together today."
            : "We should love one another today.";
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
      setTimeout(() => this.onresult?.({ resultIndex: 0, results: { length: 1, 0: first } }), 300);
      setTimeout(() => this.onresult?.({
        resultIndex: 1,
        results: {
          length: 2,
          0: first,
          1: { isFinal: true, length: 1, 0: { transcript: "그리고 오늘도 함께 걸어갑니다.", confidence: 0.99 } },
        },
      }), 2200);
    }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
});

let interpretCalls = 0;
await page.route("**/api/interpret", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  interpretCalls += 1;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      output: {
        safeChunks: [{ text: "오늘 우리는 서로를 사랑해야 합니다.", confidence: "medium" }],
        confidence: "medium",
      },
      provider: "local",
      model: "deterministic",
      degraded: true,
      reason: "OpenRouter rate limit exceeded: free-models-per-day quota exhausted",
    }),
  });
});

await page.goto(`${base}/live`, { waitUntil: "networkidle" });
await page.getByRole("radio", { name: /^브라우저/ }).click();
await page.getByRole("radio", { name: /^빠르게/ }).click();
await page.getByRole("button", { name: "통역 시작" }).click();
await page.waitForFunction(
  () => (window.__quotaTranslations?.length ?? 0) >= 2,
  undefined,
  { timeout: 12_000 },
);
const translated = await page.evaluate(() => window.__quotaTranslations ?? []);
await browser.close();

const checks = [
  ["quota failure touched cloud exactly once", interpretCalls === 1, `${interpretCalls} call(s)`],
  ["first turn used browser translation", translated.some((text) => text.includes("사랑해야")), ""],
  ["next turn bypassed cloud and still translated", translated.some((text) => text.includes("그리고")), ""],
  ["page stayed healthy", problems.length === 0, problems.join(" | ")],
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} quota-bypass checks passed`);
if (failed) process.exit(1);
