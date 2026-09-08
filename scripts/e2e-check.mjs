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
import { chromiumLaunchOptions } from "./browser.mjs";
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

const browser = await chromium.launch(chromiumLaunchOptions());
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
await page.getByPlaceholder("그리스도 안에서 우리는 누구인가").fill("택하신 족속");
await page.getByPlaceholder("1 Peter 2:9").fill("1 Peter 2:9");
await page.getByRole("button", { name: /통역 브리프 만들기/ }).click();
await page.waitForTimeout(2500);

const brief = await page.locator("body").innerText();
check("prep romanises the speaker", /Ryu Jeong-gil/.test(brief));
check("prep resolves the main passage", /1 Peter 2:9/.test(brief));
check("prep names real difficulties", /predicate/i.test(brief));
await page.screenshot({ path: join(outDir, "prep.png") });

// --- The fork -------------------------------------------------------------
await page.goto(base, { waitUntil: "networkidle" });
const homeText = await page.locator("body").innerText();
check(
  "home offers both modes as peers",
  /라이브 통역/.test(homeText) && /현장 응대/.test(homeText),
);
await page.screenshot({ path: join(outDir, "home.png") });

// --- Live session ---------------------------------------------------------
await page.goto(`${base}/live`, { waitUntil: "networkidle" });
const privacyDialog = page.getByRole("dialog", { name: /This setup sends what is said/ });
if (await privacyDialog.isVisible().catch(() => false)) {
  await privacyDialog.getByRole("button", { name: "Use local-only mode" }).click();
  check("live privacy gate offers a working local-only path", true);
}
await page.getByRole("radio", { name: /^데모/ }).click();
await page.getByRole("button", { name: "데모 실행" }).click();
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
await page.getByRole("button", { name: /End session|End/ }).click();
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
  !/아직 저장된 세션이 없어요/.test(await page.locator("body").innerText()),
);
await page.screenshot({ path: join(outDir, "sessions.png") });

// --- Counter Mode ---------------------------------------------------------
const host = await context.newPage();
const guest = await context.newPage();

// Give the visitor page a deterministic browser speech recogniser. Real
// WebSpeech may auto-end and be restarted by ASAD after a pause, but a restart
// starts a fresh capture; it must not replay the audio/result from the previous
// recognition cycle. Emit our synthetic utterance only once for the same reason.
await guest.addInitScript(() => {
  class MockSpeechRecognition {
    lang = "";
    continuous = false;
    interimResults = true;
    maxAlternatives = 1;
    onresult = null;
    onerror = null;
    onend = null;
    onstart = null;
    timer = null;
    emitted = false;

    start() {
      this.onstart?.();
      if (this.emitted) return;
      this.emitted = true;
      this.timer = window.setTimeout(() => {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              isFinal: true,
              length: 1,
              0: { transcript: "My visa number is 123456" },
            },
          },
        });
        window.setTimeout(() => this.onend?.(), 120);
      }, 700);
    }

    stop() {
      if (this.timer) window.clearTimeout(this.timer);
      this.onend?.();
    }

    abort() {
      if (this.timer) window.clearTimeout(this.timer);
      this.onend?.();
    }
  }

  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
});

let sessionEnded = false;
const expectedAfterEnd = (text) => sessionEnded && /status of 404/.test(text);

for (const [label, target] of [["host", host], ["guest", guest]]) {
  target.on("pageerror", (error) => pageProblems.push(`counter ${label} exception: ${error.message}`));
  target.on("console", (message) => {
    if (message.type() !== "error" || expectedAfterEnd(message.text())) return;
    pageProblems.push(`counter ${label} console: ${message.text()}`);
  });
}

await host.goto(`${base}/counter`, { waitUntil: "networkidle" });
await host.getByRole("button", { name: "QR 코드 띄우기" }).click();
await host.waitForTimeout(1500);

const joinText = await host.locator("body").innerText();
const code = joinText.match(/AS-([A-Z0-9]{4})/)?.[1];
check("counter issues a room code", !!code, code ? `AS-${code}` : "none found");
check(
  "counter renders a QR the visitor can scan",
  (await host.locator('svg[role="img"]').count()) > 0,
);
await host.screenshot({ path: join(outDir, "counter-host-qr.png") });

await guest.setViewportSize({ width: 390, height: 844 });
await guest.goto(`${base}/c/${code}`, { waitUntil: "networkidle" });
const pickerText = await guest.locator("body").innerText();
check("visitor picks a language written in their own script", /한국어/.test(pickerText) && /Tiếng Việt/.test(pickerText));
check(
  "visitor gets a provider-neutral translation notice",
  /Everything you write is translated for the staff member/.test(pickerText) &&
    /Translation is not working right now/i.test(pickerText),
);
await guest.screenshot({ path: join(outDir, "counter-guest-languages.png") });

await guest.getByRole("button", { name: "English", exact: true }).click();
await guest.getByRole("button", { name: "Start", exact: true }).click();
await guest.waitForTimeout(2500);

await host.waitForTimeout(2500);
check(
  "host moves from the code to the conversation once the visitor joins",
  await host.getByRole("button", { name: /자주 쓰는 문구/ }).isVisible(),
);

await host.getByRole("button", { name: /자주 쓰는 문구/ }).click();
await host.getByRole("button", { name: "안녕하세요. 무엇을 도와드릴까요?" }).click();
await host.waitForTimeout(2000);
await guest.waitForTimeout(2000);

const hostConversation = await host.locator("body").innerText();
const guestConversation = await guest.locator("body").innerText();

check(
  "quick phrase reaches the visitor with no model configured",
  /Hello\. How can I help you\?/.test(guestConversation),
);
check(
  "the visitor sees BOTH languages, not just their own",
  /Hello\. How can I help you\?/.test(guestConversation) &&
    /안녕하세요\. 무엇을 도와드릴까요\?/.test(guestConversation),
);
check(
  "the staff member sees both languages too",
  /안녕하세요\. 무엇을 도와드릴까요\?/.test(hostConversation) &&
    /Hello\. How can I help you\?/.test(hostConversation),
);
check("a table phrase is marked as one", /Set phrase|정형 문구/.test(guestConversation));

await host.screenshot({ path: join(outDir, "counter-host-conversation.png") });
await guest.screenshot({ path: join(outDir, "counter-guest-conversation.png") });

const queuedRequests = [];
await guest.route("**/api/counter/message", async (route) => {
  if (route.request().method() !== "POST") {
    await route.continue();
    return;
  }

  const body = route.request().postDataJSON();
  if (
    body?.source !== "voice" &&
    !(body?.source === "text" && body?.text === "typed while listening")
  ) {
    await route.continue();
    return;
  }

  queuedRequests.push({ source: body.source, text: body.text, at: Date.now() });
  if (body.source === "voice") await new Promise((resolve) => setTimeout(resolve, 1200));

  const seq = body.source === "voice" ? 2 : 3;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      message: {
        id: `e2e-${body.source}`,
        seq,
        from: "guest",
        source: body.source,
        originalText: body.text,
        originalLang: "en-US",
        translatedText:
          body.source === "voice" ? "비자 번호는 123456입니다" : "입력도 동시에 가능합니다",
        targetLang: "ko-KR",
        at: Date.now(),
        status: "done",
        confidence: "high",
      },
      viaModel: true,
      provider: "e2e",
      latencyMs: body.source === "voice" ? 1200 : 0,
    }),
  });
});

const guestInput = guest.getByPlaceholder("Type your message");
const guestMic = guest.getByRole("button", { name: "Speak", exact: true });
await guestMic.click();
await guest.waitForTimeout(50);

check(
  "one mic tap starts listening",
  (await guest.locator('button[aria-pressed="true"]').count()) === 1,
);

await guestInput.fill("typed while listening");
check(
  "typing remains editable while listening",
  (await guestInput.inputValue()) === "typed while listening",
);

await guest.waitForTimeout(850);
const confirmVoice = guest.getByRole("button", { name: "Edit transcript" });
await confirmVoice.waitFor({ state: "visible", timeout: 2500 });
check(
  "critical voice transcript waits for human review",
  queuedRequests.length === 0 && (await confirmVoice.isVisible()),
);
await confirmVoice.click();
check(
  "recognized speech remains editable before sending",
  (await guestInput.inputValue()) === "My visa number is 123456",
);

const guestSend = guest.getByRole("button", { name: "Send" });
await guestSend.click();
await guest.waitForTimeout(50);
check(
  "reviewed speech submits only after the operator sends it",
  queuedRequests.length === 1 &&
    queuedRequests[0]?.source === "voice" &&
    (await guestInput.inputValue()) === "",
);
await guest.getByRole("button", { name: "Restore previous text" }).click();
check(
  "text typed while listening can be restored",
  (await guestInput.inputValue()) === "typed while listening",
);
check("Send stays enabled while translation is pending", await guestSend.isEnabled());
await guestSend.click();
await guest.waitForTimeout(1600);
check(
  "voice and typed turns can overlap without losing either request",
  queuedRequests.length === 2 &&
    queuedRequests[0]?.source === "voice" &&
    queuedRequests[1]?.source === "text" &&
    queuedRequests[1]?.text === "typed while listening",
);

await guest.screenshot({ path: join(outDir, "counter-guest-conversation.png") });

// --- UI regression: a phone, a right-to-left script, and no recogniser -----
//
// Uyghur is the hardest case the interface has: right-to-left, no speech
// recogniser anywhere in the stack, and administrative codes that are
// left-to-right inside a right-to-left sentence. If the layout survives this
// it survives the rest.
// A fresh context: the host screen restores its last session from storage, so
// reusing the first one would never show the join screen again.
const rtlContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});
const rtlHost = await rtlContext.newPage();
const rtlGuest = await rtlContext.newPage();
for (const [label, target] of [["rtl host", rtlHost], ["rtl guest", rtlGuest]]) {
  target.on("pageerror", (error) => pageProblems.push(`${label} exception: ${error.message}`));
  target.on("console", (message) => {
    if (message.type() !== "error" || expectedAfterEnd(message.text())) return;
    pageProblems.push(`${label} console: ${message.text()}`);
  });
}

await rtlHost.goto(`${base}/counter`, { waitUntil: "networkidle" });
await rtlHost.getByRole("button", { name: "QR 코드 띄우기" }).click();
await rtlHost.waitForTimeout(1500);
const rtlCode = (await rtlHost.locator("body").innerText()).match(/AS-([A-Z0-9]{4})/)?.[1];

// An iPhone 12/13/14 viewport, which is what actually gets handed across a desk.
await rtlGuest.setViewportSize({ width: 390, height: 844 });
await rtlGuest.goto(`${base}/c/${rtlCode}`, { waitUntil: "networkidle" });
check(
  "the picker offers Uyghur in its own script",
  /ئۇيغۇرچە/.test(await rtlGuest.locator("body").innerText()),
);

await rtlGuest.getByRole("button", { name: "ئۇيغۇرچە", exact: true }).click();
// Voice preparation must not be offered for a language nothing can transcribe:
// it asks for a permission that can never be spent.
check(
  "no microphone permission is asked for a typed-only language",
  (await rtlGuest.getByRole("button", { name: /🎙|Prepare voice input/ }).count()) === 0,
);
await rtlGuest.screenshot({ path: join(outDir, "counter-uyghur-picker.png") });

await rtlGuest.locator("button").filter({ hasText: "باشلاش" }).first().click();
await rtlGuest.waitForTimeout(2500);

const rtlRoot = rtlGuest.locator("div[dir='rtl']").first();
check("the visitor's screen flips to right-to-left", (await rtlRoot.count()) > 0);
check(
  "no microphone button is offered when nothing can transcribe the language",
  (await rtlGuest.getByRole("button", { name: "سۆزلەش", exact: true }).count()) === 0,
);
check(
  "typing is presented as the normal path instead",
  (await rtlGuest.getByPlaceholder("ئۇچۇرىڭىزنى كىرگۈزۈڭ").count()) === 1,
);

// A quick phrase needs no model, so this works on a CI runner with no keys and
// still produces a real bilingual bubble.
await rtlHost.waitForTimeout(2000);
await rtlHost.getByRole("button", { name: /자주 쓰는 문구/ }).click();
await rtlHost.getByRole("button", { name: "안녕하세요. 무엇을 도와드릴까요?" }).click();
await rtlGuest.waitForTimeout(2500);
check(
  "the visitor reads Uyghur, not Arabic and not English",
  /ياردەم/.test(await rtlGuest.locator("body").innerText()),
);

// The bidi case. A message whose Latin codes are not isolated renders
// "D-10 to D-2" — both codes correct, the sentence reversed.
await rtlGuest.route("**/api/counter/message", async (route) => {
  const body = route.request().postDataJSON();
  if (route.request().method() !== "POST" || body?.source !== "text") {
    await route.continue();
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      message: {
        id: "e2e-rtl",
        seq: 90,
        from: "guest",
        source: "text",
        originalText: body.text,
        originalLang: "ug-CN",
        translatedText: "D-2에서 D-10으로 변경하고 싶습니다. HiKorea 예약, 2026-05-31.",
        targetLang: "ko-KR",
        at: Date.now(),
        status: "done",
        confidence: "high",
      },
      viaModel: true,
      provider: "e2e",
      latencyMs: 0,
    }),
  });
});

await rtlGuest
  .getByPlaceholder("ئۇچۇرىڭىزنى كىرگۈزۈڭ")
  .fill("مەن D-2 دىن D-10 غا ئۆزگەرتىمەن، HiKorea، 2026-05-31");
await rtlGuest.getByRole("button", { name: "ئەۋەتىش", exact: true }).click();
await rtlGuest.waitForTimeout(1800);

const isolated = await rtlGuest.locator("bdi[dir='ltr']").allInnerTexts();
check(
  "administrative codes are isolated so they cannot reorder",
  isolated.includes("D-2") && isolated.includes("D-10") && isolated.includes("HiKorea"),
  isolated.join(" | "),
);
check(
  "the isolated codes still read in their original order",
  isolated.indexOf("D-2") < isolated.indexOf("D-10"),
);

const overflow = await rtlGuest.evaluate(() => ({
  scroll: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
}));
check(
  "nothing overflows the phone viewport sideways",
  overflow.scroll <= overflow.client + 1,
  `${overflow.scroll} vs ${overflow.client}`,
);

const sendBox = await rtlGuest.getByRole("button", { name: "ئەۋەتىش", exact: true }).boundingBox();
check(
  "Send stays on screen and is big enough to hit",
  !!sendBox && sendBox.y + sendBox.height <= 844 && sendBox.height >= 44,
  sendBox ? `y=${Math.round(sendBox.y)} h=${Math.round(sendBox.height)}` : "missing",
);
await rtlGuest.screenshot({ path: join(outDir, "counter-uyghur-conversation.png") });

// The same screen on a desktop viewport, to catch a fix that only works small.
await rtlGuest.setViewportSize({ width: 1440, height: 900 });
await rtlGuest.waitForTimeout(400);
const desktopOverflow = await rtlGuest.evaluate(
  () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
);
check("the right-to-left layout holds on a desktop viewport too", desktopOverflow);
await rtlGuest.screenshot({ path: join(outDir, "counter-uyghur-desktop.png") });

// The visitor's in-flight poll will 404 against the session the host just
// deleted, which is the intended behaviour, not a page error.
sessionEnded = true;
await rtlHost.getByRole("button", { name: "종료" }).click();
await rtlGuest.waitForTimeout(1200);
await rtlHost.close();
await rtlGuest.close();
await rtlContext.close();

// End from the host and ensure the visitor receives the end state.
await host.getByRole("button", { name: "종료" }).click();
await guest.waitForTimeout(2600);

await host.close();
await guest.close();
await page.close();
await browser.close();

check("browser produced no unexpected page errors", pageProblems.length === 0, pageProblems.join(" | "));

const failed = results.filter((result) => !result.passed);
if (failed.length) {
  console.error(`\n${failed.length} end-to-end check(s) failed.`);
  process.exit(1);
}

console.log(`\n${results.length} end-to-end checks passed.`);
