/**
 * Two-lane Live regression through the real /live UI.
 *
 * window.Translator and SpeechRecognition are mocked; /api/interpret is held
 * and released by this script so the races are deterministic:
 *
 *   1. provisional on-device English renders before the delayed cloud answer;
 *   2. a cloud answer released while the provisional line is still editable
 *      refines exactly that turn, in place;
 *   3. a cloud answer released after the provisional line committed is dropped
 *      and the committed text is byte-identical;
 *   4. later Korean keeps rendering while an earlier cloud request is held;
 *   5. cloud requests stay bounded: never two in flight, never more than one
 *      per turn;
 *   6. answers released after End change nothing;
 *   7. client telemetry carries the two-lane stages and no transcript text;
 *   8. the quota-dead bypass still holds with the fast lane on.
 *
 * This proves the application's semantics. It does NOT exercise Chrome's
 * downloadable Korean→English language pack; the Translator here is a mock.
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

const KOREAN = [
  "오늘 우리는 서로를 사랑해야 합니다.",
  "그리고 오늘도 함께 걸어갑니다.",
  "우리는 하나님의 부르심을 받은 사람들입니다.",
  "믿음은 바라는 것들의 실상입니다.",
  "소망은 우리를 부끄럽게 하지 않습니다.",
  "그러므로 서로 격려하며 살아갑시다.",
];
const PROVISIONAL = KOREAN.map((_, i) => `Provisional line ${i + 1} from the device.`);
const EMIT_EVERY_MS = 1_500;

const browser = await chromium.launch(chromiumLaunchOptions());

/** On an unexpected throw, say what the page looked like before exiting. */
async function explainFailure(page, problems, held, error) {
  console.error(`\nUNEXPECTED: ${error instanceof Error ? error.message : String(error)}`);
  try {
    console.error("rows:", JSON.stringify(await chunkRows(page)));
    console.error("probe:", JSON.stringify(await page.evaluate(() => window.__probe)));
    console.error("held requests:", held.length);
  } catch {}
  console.error("page problems:", problems.join(" | ") || "none");
  await browser.close();
  process.exit(1);
}

/** Install mocks: fast Translator, scripted recogniser, render-time probes. */
async function setUpPage(context, { koreanLines, provisionalLines }) {
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.addInitScript(
    ({ korean, provisional, emitEvery }) => {
      window.localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");
      window.__probe = { stableAt: [], provisionalRenders: [], translatorCalls: [] };

      window.Translator = {
        create(options) {
          options?.monitor?.({
            addEventListener(type, listener) {
              if (type === "downloadprogress") listener({ loaded: 1 });
            },
          });
          return Promise.resolve({
            async translate(input) {
              window.__probe.translatorCalls.push(input);
              await new Promise((resolve) => setTimeout(resolve, 30));
              const index = korean.findIndex((line) => input.includes(line));
              return index === -1 ? `Provisional: ${input}` : provisional[index];
            },
            destroy() {},
          });
        },
      };

      // Provisional first paint, measured in the page: the moment a chunk
      // marked provisional enters the DOM.
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            const matches = node.matches?.("[data-provisional]") ? [node] : [];
            for (const element of [...matches, ...node.querySelectorAll?.("[data-provisional]") ?? []]) {
              const turnId = Number(element.getAttribute("data-turn-id"));
              if (!window.__probe.provisionalRenders.some((r) => r.turnId === turnId)) {
                window.__probe.provisionalRenders.push({ turnId, at: performance.now() });
              }
            }
          }
        }
      });
      observer.observe(document, { childList: true, subtree: true });

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
          const results = [];
          korean.forEach((line, index) => {
            window.setTimeout(() => {
              results.push({ isFinal: true, length: 1, 0: { transcript: line, confidence: 0.99 } });
              const list = { length: results.length };
              results.forEach((r, i) => { list[i] = r; });
              window.__probe.stableAt.push({ turnId: index + 1, at: performance.now() });
              this.onresult?.({ resultIndex: index, results: list });
            }, 300 + index * emitEvery);
          });
        }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      }
      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;
    },
    { korean: koreanLines, provisional: provisionalLines, emitEvery: EMIT_EVERY_MS },
  );
  return { page, problems };
}

const chunkRows = (page) =>
  page.$$eval("[data-chunk-state]", (nodes) =>
    nodes.map((n) => ({
      turnId: Number(n.getAttribute("data-turn-id")),
      state: n.getAttribute("data-chunk-state"),
      provisional: n.getAttribute("data-provisional") === "true",
      text: n.querySelector("p")?.textContent?.replace(/^[≈↺◦]\s*/, "").trim() ?? "",
    })),
  );

/** Wait until some rendered chunk row matches every field of `match`. */
const waitForRow = (page, match, timeout = 10_000) =>
  page.waitForFunction(
    (m) =>
      [...document.querySelectorAll("[data-chunk-state]")].some((n) => {
        const row = {
          turnId: Number(n.getAttribute("data-turn-id")),
          state: n.getAttribute("data-chunk-state"),
          provisional: n.getAttribute("data-provisional") === "true",
          text: n.querySelector("p")?.textContent ?? "",
        };
        if (m.turnId !== undefined && row.turnId !== m.turnId) return false;
        if (m.state !== undefined && row.state !== m.state) return false;
        if (m.provisional !== undefined && row.provisional !== m.provisional) return false;
        if (m.textIncludes !== undefined && !row.text.includes(m.textIncludes)) return false;
        return true;
      }),
    match,
    { timeout },
  );

/* ------------------------------------------------------------------------
 * Scenario 1: races
 * ---------------------------------------------------------------------- */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, problems } = await setUpPage(context, { koreanLines: KOREAN, provisionalLines: PROVISIONAL });

  const held = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let totalCalls = 0;
  const release = (entry, text) =>
    entry
      .fulfil({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          output: { safeChunks: [{ text, confidence: "high" }], confidence: "high" },
          provider: "openrouter",
          model: "e2e-model",
        }),
      })
      .catch(() => {})
      .finally(() => {
        inFlight -= 1;
      });

  await page.route("**/api/interpret", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    totalCalls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    held.push({ body: JSON.parse(route.request().postData() ?? "{}"), fulfil: (init) => route.fulfill(init), at: Date.now() });
  });

  await page.goto(`${base}/live`, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /^브라우저/ }).click();
  await page.getByRole("radio", { name: /^빠르게/ }).click();
  await page.getByRole("button", { name: "통역 시작" }).click();

  try {
  // 1. Provisional before cloud.
  await waitForRow(page, { turnId: 1, provisional: true });
  const firstRows = await chunkRows(page);
  check(
    "provisional English rendered before the held cloud answer",
    firstRows.some((r) => r.turnId === 1 && r.provisional && r.state === "current" && r.text === PROVISIONAL[0]) && held.length === 1,
    `${firstRows.length} row(s), ${held.length} held request(s)`,
  );

  // 2. Same-turn refinement while still editable (FAST dwell is 1.2s).
  await release(held[0], "Refined line 1 from the cloud.");
  await waitForRow(page, { turnId: 1, provisional: false, textIncludes: "Refined line 1" }, 3_000);
  const refinedRows = await chunkRows(page);
  check(
    "cloud refinement replaced only the editable provisional chunk of turn 1, in place",
    refinedRows.filter((r) => r.turnId === 1).length === 1 &&
      refinedRows[0].text === "Refined line 1 from the cloud." &&
      refinedRows[0].state === "current" &&
      !refinedRows[0].provisional,
    refinedRows.map((r) => `${r.turnId}:${r.state}${r.provisional ? "*" : ""}`).join(" "),
  );

  // 3. Turn 2: let it commit, then release a late rewrite.
  await waitForRow(page, { turnId: 2, state: "committed" });
  const lockedBefore = (await chunkRows(page)).find((r) => r.turnId === 2);
  while (held.length < 2) await page.waitForTimeout(50);
  await release(held[1], "Late rewrite of line 2 that must not appear.");
  await page.waitForTimeout(600);
  const lockedAfter = (await chunkRows(page)).find((r) => r.turnId === 2);
  check(
    "a cloud answer arriving after commit did not rewrite the committed line",
    lockedBefore?.text === PROVISIONAL[1] && lockedAfter?.text === PROVISIONAL[1] && lockedAfter?.state === "committed",
    `before="${lockedBefore?.text}" after="${lockedAfter?.text}"`,
  );
  check(
    "rewritten text was never appended either",
    !(await page.locator("body").innerText()).includes("Late rewrite"),
  );

  // 4. Later Korean while an earlier cloud request is held. From here on every
  //    request stays held until End.
  await waitForRow(page, { turnId: KOREAN.length }, 15_000);
  const allRows = await chunkRows(page);
  const turnsRendered = new Set(allRows.map((r) => r.turnId));
  check(
    "later Korean kept rendering while an earlier cloud request was outstanding",
    KOREAN.every((_, i) => turnsRendered.has(i + 1)) && held.length > 2 && held.length - 2 <= KOREAN.length - 2,
    `turns ${[...turnsRendered].join(",")}; ${held.length} request(s) so far`,
  );

  // 5. Bounded.
  check("never more than one cloud request in flight", maxInFlight === 1, `max ${maxInFlight}`);
  check("no more cloud requests than turns", totalCalls <= KOREAN.length, `${totalCalls} call(s) for ${KOREAN.length} turn(s)`);

  // Provisional first-paint latency, measured in the page.
  const probe = await page.evaluate(() => window.__probe);
  const latencies = probe.provisionalRenders
    .map((r) => {
      const stable = probe.stableAt.find((s) => s.turnId === r.turnId);
      return stable ? r.at - stable.at : null;
    })
    .filter((ms) => ms !== null)
    .sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.max(0, Math.ceil((p / 100) * latencies.length) - 1))];
  const p50 = latencies.length ? Math.round(pct(50)) : NaN;
  const p95 = latencies.length ? Math.round(pct(95)) : NaN;
  check(
    "mocked-Translator provisional first paint: p50 < 1000ms, p95 < 1800ms (mock, not Chrome)",
    latencies.length >= KOREAN.length - 1 && p50 < 1_000 && p95 < 1_800,
    `n=${latencies.length} p50=${p50}ms p95=${p95}ms all=[${latencies.map((v) => Math.round(v)).join(", ")}]`,
  );

  // 6. End, then release everything still held. Saving the session makes the
  //    review screen render the final English, which is what must not move.
  await page.getByLabel("Session settings").click();
  await page.getByRole("switch", { name: /Save this session/ }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const beforeEnd = await chunkRows(page);
  await page.getByRole("button", { name: /End session|End/ }).click();
  await page.waitForFunction(() => /SUGGESTED PREP FOR NEXT TIME/i.test(document.body.innerText), undefined, { timeout: 10_000 });
  const heldAtEnd = held.slice(2);
  for (const entry of heldAtEnd) await release(entry, "STALE-AFTER-END");
  await page.waitForTimeout(800);
  const review = await page.locator("body").innerText();
  check(
    "answers released after End changed nothing",
    heldAtEnd.length > 0 && !review.includes("STALE-AFTER-END") && beforeEnd.every((r) => review.includes(r.text)),
    `${heldAtEnd.length} answer(s) released after End`,
  );

  // 7. Telemetry: two-lane stages piggybacked on a later request, no text.
  const stages = new Set(held.flatMap((h) => (h.body.clientTelemetry ?? []).map((s) => s.stage)));
  const telemetryJson = JSON.stringify(held.flatMap((h) => h.body.clientTelemetry ?? []));
  check(
    "client telemetry carried the two-lane stages",
    ["stable_to_provisional", "stable_to_provisional_render", "provisional_to_refinement", "stable_to_safe", "stable_to_render"].every((s) => stages.has(s)),
    [...stages].sort().join(","),
  );
  check(
    "client telemetry contains no transcript text",
    !/[가-힣]/.test(telemetryJson) && !telemetryJson.includes("Provisional line") && !telemetryJson.includes("Refined"),
  );
  check("Translator.translate saw every turn", probe.translatorCalls.length >= KOREAN.length, `${probe.translatorCalls.length} call(s)`);
  check("no page errors", problems.length === 0, problems.join(" | "));

  await page.screenshot({ path: join(outDir, "live-two-lane.png"), fullPage: true });
  } catch (error) {
    await explainFailure(page, problems, held, error);
  }
  await context.close();
}

/* ------------------------------------------------------------------------
 * Scenario 2: quota-dead cloud with the fast lane on
 * ---------------------------------------------------------------------- */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const lines = KOREAN.slice(0, 3);
  const { page, problems } = await setUpPage(context, { koreanLines: lines, provisionalLines: PROVISIONAL.slice(0, 3) });
  let calls = 0;
  await page.route("**/api/interpret", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        output: { safeChunks: [{ text: lines[0], confidence: "medium" }], confidence: "medium" },
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
  let rows = [];
  let probe = { translatorCalls: [] };
  try {
    await waitForRow(page, { turnId: 3 }, 12_000);
    await page.waitForTimeout(400);
    rows = await chunkRows(page);
    probe = await page.evaluate(() => window.__probe);
  } catch (error) {
    await explainFailure(page, problems, [], error);
  }
  check(
    "quota exhaustion touched the cloud exactly once while provisional English kept flowing",
    calls === 1 && [1, 2, 3].every((id) => rows.some((r) => r.turnId === id && r.text === PROVISIONAL[id - 1])),
    `${calls} cloud call(s); ${rows.length} row(s)`,
  );
  check(
    "each turn was translated on-device exactly once (no duplicate fallback translation)",
    probe.translatorCalls.length === lines.length,
    `${probe.translatorCalls.length} translate call(s)`,
  );
  check("no page errors in the quota scenario", problems.length === 0, problems.join(" | "));
  await context.close();
}

await browser.close();

const failed = checks.filter((c) => !c.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} two-lane checks passed`);
console.log("NOTE: window.Translator is mocked. This is not validation of Chrome's downloadable Korean→English language pack.");
if (failed.length > 0) process.exit(1);
