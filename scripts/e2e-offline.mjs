import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { chooseRecogniser, openAdvanced, start } from "./launcher.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const registry = JSON.parse(await readFile(new URL("../src/providers/offline/models.json", import.meta.url)));
const files = new Map(Object.values(registry).flatMap(({ repo, revision, files }) =>
  files.map(({ path }) => [`https://huggingface.co/${repo}/resolve/${revision}/${path}`, `${repo}/${path}`])));
const browser = await chromium.launch(chromiumLaunchOptions({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${resolve("public/offline-v1/ko-check.wav")}`],
}));
try {
  const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1180, height: 820 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.warn("Browser:", message.text().slice(0, 250));
  });
  let cutDownload = true;
  let weightRequests = 0;
  await context.route("https://huggingface.co/**", async (route) => {
    const key = files.get(route.request().url());
    if (!key) return route.abort();
    weightRequests++;
    if (cutDownload) {
      cutDownload = false;
      return route.abort("internetdisconnected");
    }
    if (!process.env.ASAD_MODEL_ROOT) return route.continue();
    return route.fulfill({
      path: resolve(process.env.ASAD_MODEL_ROOT, key),
      headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" },
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");
    class SpeechTestInput {
      start() { globalThis.testRecognizer = this; setTimeout(() => this.onstart?.(), 10); }
      stop() { this.onend?.(); }
      abort() {}
      deliver(text) {
        this.onresult?.({ resultIndex: 0,
          results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text, confidence: 0.98 } } },
        });
      }
    }
    globalThis.SpeechRecognition = SpeechTestInput;
    globalThis.webkitSpeechRecognition = SpeechTestInput;
    Object.defineProperty(globalThis, "Translator", { configurable: true, value: undefined });
  });
  await page.goto(`${base}/live`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await openAdvanced(page);
  const download = page.getByRole("button", { name: "Download Offline Models", exact: true });
  await download.click();
  await page.getByRole("alert").filter({ hasText: /fetch|download|network|load|failed/i })
    .waitFor({ timeout: 35_000 }).catch(async (error) => {
      console.error("Preparation status:", await page.getByRole("region", { name: "Offline interpretation" }).innerText(),
        "weight requests:", weightRequests, "page errors:", errors);
      throw error;
    });
  console.log("PASS interrupted download surfaced an error");
  await download.click();
  try {
    await page.getByRole("status").filter({ hasText: /^Offline Ready$/ }).waitFor({ timeout: 110_000 });
  } catch (error) {
    console.error("Preparation status:", await page.getByRole("region", { name: "Offline interpretation" }).innerText(),
      "weight requests:", weightRequests, "page errors:", errors);
    throw error;
  }
  console.log("PASS interrupted download and real Worker WASM preparation for both models");

  const prepareNoMoreDownloads = weightRequests;
  await chooseRecogniser(page, "webspeech");
  const quotaRoute = "**/api/interpret";
  let quotaCalls = 0;
  const quota = async (route) => {
    quotaCalls++;
    return route.fulfill({ json: { provider: "local", model: "deterministic",
      degraded: true, reason: "OpenRouter daily quota exhausted",
      output: { safeChunks: [{ text: "오늘 날씨가 좋습니다.", confidence: "low" }], confidence: "low" },
    } });
  };
  await page.route(quotaRoute, quota);
  await start(page);
  await page.waitForFunction(() => !!globalThis.testRecognizer);
  await page.evaluate(() => globalThis.testRecognizer.deliver("오늘 날씨가 좋습니다."));
  await page.getByText(/weather is (nice|good|fine|great)|(good|nice|fine|great) day/i).first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => globalThis.testRecognizer.deliver("창문을 닫아 주세요."));
  await page.getByText(/close the window/i).first().waitFor({ timeout: 30_000 });
  assert.equal(quotaCalls, 1);
  console.log("PASS actual English and quota cooldown after HTTP 200 provider=local");

  await page.unroute(quotaRoute, quota);
  await page.reload();
  await openAdvanced(page);
  await page.getByRole("status").filter({ hasText: /^Offline Ready$/ }).waitFor({ timeout: 60_000 });
  await chooseRecogniser(page, "webspeech");
  let serverResult;
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/interpret")) serverResult = await response.json().catch(() => undefined);
  });
  await start(page);
  await page.waitForFunction(() => !!globalThis.testRecognizer);
  await page.evaluate(() => globalThis.testRecognizer.deliver("오늘 날씨가 좋습니다."));
  await page.getByText(/weather is (nice|good|fine|great)|(good|nice|fine|great) day/i).first().waitFor({ timeout: 30_000 });
  assert.equal(serverResult?.provider, "local", "run this test with cloud credentials absent");
  console.log("PASS actual English with production app server and missing cloud credentials");

  await page.goto(`${base}/live`);
  await openAdvanced(page);
  await page.getByRole("status").filter({ hasText: /^Offline Ready$/ }).waitFor({ timeout: 60_000 });
  await page.getByRole("checkbox", { name: "Offline Mode" }).check();
  const dataRequests = [];
  const track = (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/")) {
      dataRequests.push(request.url());
    }
  };
  context.on("request", track);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openAdvanced(page);
  await page.getByRole("status").filter({ hasText: /^Offline Ready$/ }).waitFor({ timeout: 75_000 });
  await page.setViewportSize({ width: 820, height: 1180 });
  await start(page);
  await page.getByText(/fair|make sense/i).first().waitFor({ timeout: 40_000 });
  await page.getByText(/공평|확실히/).first().waitFor({ timeout: 20_000 });
  await page.getByText("Offline · Local", { exact: true }).waitFor();
  assert.equal(weightRequests, prepareNoMoreDownloads);
  assert.deepEqual(dataRequests, []);
  assert.deepEqual(errors, []);
  console.log("PASS offline reload, AudioWorklet → Whisper Korean → OPUS-MT English, zero external/API requests");
} finally {
  await browser.close();
}
