/**
 * The language pair, end to end in a browser.
 *
 * Live Interpretation used to be Korean into English and nothing else, in the
 * pipeline as well as in the UI. These checks follow one non-default pair all
 * the way down — picker, recogniser locale, on-device translator, the wire, the
 * console — and then check that a pair which cannot work is refused BEFORE the
 * microphone opens rather than after.
 *
 * The Translator API and SpeechRecognition are mocked. This is not a claim
 * about Chrome's language packs or about any vendor's Chinese accuracy; it is a
 * claim about what ASAD asks them for.
 */
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { choosePair, chooseRecogniser, start } from "./launcher.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const KOREAN = "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.";

let failures = 0;
const check = (name, passed, detail = "") => {
  if (!passed) failures += 1;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch(chromiumLaunchOptions());

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));

  await page.addInitScript((korean) => {
    window.localStorage.setItem("tong-yuck:free-tier-privacy-ack-v2", "1");
    window.__probe = { translatorCreated: [], recogniserLangs: [] };

    window.Translator = {
      create(options) {
        window.__probe.translatorCreated.push(options);
        return Promise.resolve({
          async translate() {
            return "我們今天要一起看的經文";
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
      start() {
        window.__probe.recogniserLangs.push(this.lang);
        this.onstart?.();
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: {
              length: 1,
              0: { isFinal: true, length: 1, 0: { transcript: korean, confidence: 0.95 } },
            },
          });
        }, 250);
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  }, KOREAN);

  return { page, context, problems };
}

/* --- Korean into Traditional Chinese ------------------------------------- */
{
  const { page, context, problems } = await newPage();
  const requests = [];
  await page.route("**/api/interpret", async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        output: {
          safeChunks: [{ text: "我們今天要一起看的經文是彼得前書二章九節。", confidence: "high" }],
          confidence: "high",
        },
        provider: "openrouter",
        model: "test-model",
      }),
    });
  });

  await page.goto(`${base}/live`, { waitUntil: "networkidle" });
  await chooseRecogniser(page, "webspeech");
  await choosePair(page, "ko-KR", "zh-TW");
  await start(page);
  await page
    .waitForFunction(() => (window.__probe?.recogniserLangs?.length ?? 0) > 0, undefined, {
      timeout: 8_000,
    })
    .catch(() => {});
  const deadline = Date.now() + 8_000;
  while (requests.length === 0 && Date.now() < deadline) await page.waitForTimeout(100);

  const probe = await page.evaluate(() => window.__probe);
  const header = await page.locator('[data-surface="live"] header').innerText();

  check(
    "the recogniser was opened on the chosen source locale",
    probe.recogniserLangs.includes("ko-KR"),
    probe.recogniserLangs.join(", ") || "never started",
  );
  check(
    "the on-device translator was asked for the SCRIPT, not the base language",
    probe.translatorCreated.some(
      (options) => options.sourceLanguage === "ko" && options.targetLanguage === "zh-Hant",
    ),
    JSON.stringify(probe.translatorCreated),
  );
  check(
    "the interpretation request carried the pair",
    requests[0]?.source === "ko-KR" && requests[0]?.target === "zh-TW",
    requests[0] ? `${requests[0].source} → ${requests[0].target}` : "no request",
  );
  check(
    "the request carried a RESOLVED context, never the user's auto",
    typeof requests[0]?.context === "string" && requests[0].context !== "auto",
    requests[0]?.context ?? "missing",
  );
  check(
    "the console names the pair it is actually running",
    header.includes("ko → zh-TW"),
    header.replace(/\s+/g, " ").slice(0, 90),
  );
  check("no page errors on a non-default pair", problems.length === 0, problems.join(" | "));
  await context.close();
}

/* --- A pair that cannot work is refused before the microphone opens ------ */
{
  const { page, context, problems } = await newPage();
  let interpretCalls = 0;
  await page.route("**/api/interpret", async (route) => {
    interpretCalls += 1;
    await route.abort();
  });

  await page.goto(`${base}/live`, { waitUntil: "networkidle" });
  await chooseRecogniser(page, "webspeech");
  await choosePair(page, "ko-KR", "ko-KR");

  const startButton = page.getByRole("button", { name: /데모 실행|통역 시작/ });
  check("Start is disabled on a pair that cannot be interpreted", await startButton.isDisabled());
  check(
    "the launcher says why, rather than failing after the tap",
    /같은 언어/.test(await page.locator("body").innerText()),
  );

  const probe = await page.evaluate(() => window.__probe);
  check(
    "nothing opened the microphone",
    probe.recogniserLangs.length === 0 && interpretCalls === 0,
    `${probe.recogniserLangs.length} recogniser start(s), ${interpretCalls} request(s)`,
  );

  // Correcting the pair clears the refusal without a reload.
  await choosePair(page, "ko-KR", "ja-JP");
  check("choosing a workable pair re-enables Start", await startButton.isEnabled());
  check("no page errors on a refused pair", problems.length === 0, problems.join(" | "));
  await context.close();
}

await browser.close();

console.log(
  `\n${failures === 0 ? "All" : `${failures} failed of`} language-pair checks${failures === 0 ? " passed" : ""}.`,
);
console.log(
  "NOTE: window.Translator and SpeechRecognition are mocked. This checks what ASAD asks for, not what any vendor delivers.",
);
if (failures > 0) process.exit(1);
