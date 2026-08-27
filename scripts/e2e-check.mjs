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
// Chromium exposes the Web Speech constructor even on a headless CI runner,
// so the production launcher correctly prefers it. The E2E transcript checks,
// however, need deterministic audio. Explicitly choose Demo rather than
// pretending a microphone is absent and accidentally testing silence.
//
// The audio picker is a radiogroup, not a row of buttons: it is a choice
// between mutually exclusive options, and saying so is what lets a screen
// reader announce "2 of 3" instead of reading three unrelated buttons.
await page.getByRole("radio", { name: /^Demo/ }).click();
await page.getByRole("button", { name: "Run demo" }).click();
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
  !/No saved sessions/.test(await page.locator("body").innerText()),
);
await page.screenshot({ path: join(outDir, "sessions.png") });

// --- Counter Mode ---------------------------------------------------------
// Two pages, because it is genuinely two devices: the iPad on the desk and the
// visitor's own phone. One browser context so they share the server, nothing
// else.
const host = await context.newPage();
const guest = await context.newPage();

// Give the visitor page a deterministic browser speech recogniser. It behaves
// like one natural utterance: one tap starts listening, a final transcript
// arrives, then silence ends the utterance automatically.
await guest.addInitScript(() => {
  class MockSpeechRecognition {
    lang = "";
    continuous = false;
    interimResults = true;
    onresult = null;
    onerror = null;
    onend = null;
    timer = null;

    start() {
      this.timer = window.setTimeout(() => {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              isFinal: true,
              length: 1,
              0: { transcript: "I need help with my visa" },
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

// Once the staff member ends the conversation the visitor's next poll gets a
// 404 — that IS the design, and the browser logs it as a failed resource. It is
// expected only from that moment on; before it, a 404 is a real failure.
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
const code = joinText.match(/TY-([A-Z0-9]{4})/)?.[1];
check("counter issues a room code", !!code, code ? `TY-${code}` : "none found");
check(
  "counter renders a QR the visitor can scan",
  (await host.locator('svg[role="img"]').count()) > 0,
);
await host.screenshot({ path: join(outDir, "counter-host-qr.png") });

// The visitor's phone, arriving by the URL the QR encodes.
await guest.setViewportSize({ width: 390, height: 844 });
await guest.goto(`${base}/c/${code}`, { waitUntil: "networkidle" });
const pickerText = await guest.locator("body").innerText();
check("visitor picks a language written in their own script", /한국어/.test(pickerText) && /Tiếng Việt/.test(pickerText));
// With no key configured there is no company to name, and saying so plainly is
// the correct disclosure. Silence is not — and neither is naming an
// environment variable at someone holding a phone they did not choose.
check(
  "visitor is told who will see their words, or that nobody can translate",
  /Translated by/.test(pickerText) || /Translation is not working right now/i.test(pickerText),
  /Translated by/.test(pickerText) ? "provider named" : "no provider configured",
);
await guest.screenshot({ path: join(outDir, "counter-guest-languages.png") });

await guest.getByRole("button", { name: "English", exact: true }).click();
await guest.getByRole("button", { name: "Start", exact: true }).click();
await guest.waitForTimeout(2500);

// The host device notices the visitor without being told.
await host.waitForTimeout(2500);
check(
  "host moves from the code to the conversation once the visitor joins",
  await host.getByRole("button", { name: /자주 쓰는 문구/ }).isVisible(),
);

// A quick phrase: the path that must never touch a model.
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

// Tap-to-talk and non-blocking typing. Intercept just these two messages so the
// test controls translation latency without needing a paid model credential.
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
          body.source === "voice" ? "비자 관련 도움이 필요합니다" : "입력도 동시에 가능합니다",
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
const guestMic = guest.getByRole("button", { name: "Voice input" });
await guestMic.click();
await guest.waitForTimeout(50);

check(
  "one mic tap starts listening",
  (await guestMic.getAttribute("aria-pressed")) === "true",
);

await guestInput.fill("typed while listening");
check(
  "typing remains editable while listening",
  (await guestInput.inputValue()) === "typed while listening",
);

// The mock utterance ends naturally and auto-submits the voice message. Its
// translation is intentionally delayed so we can submit typed text meanwhile.
await guest.waitForTimeout(850);
check(
  "speech auto-submits after the utterance ends",
  queuedRequests.length === 1 && queuedRequests[0]?.source === "voice",
);

const guestSend = guest.getByRole("button", { name: "Send" });
check("Send stays enabled while translation is pending", await guestSend.isEnabled());
await guestSend.click();
check("typed draft clears immediately when queued", (await guestInput.inputValue()) === "");

await guest.waitForTimeout(250);
check(
  "second message waits behind the in-flight translation",
  queuedRequests.length === 1,
);

await guest.waitForTimeout(1150);
check(
  "queued text sends after voice in order",
  queuedRequests.length === 2 &&
    queuedRequests[0]?.source === "voice" &&
    queuedRequests[1]?.source === "text",
);

await guest.waitForTimeout(250);
const afterTapToTalk = await guest.locator("body").innerText();
check("voice transcript appears in the chat", /I need help with my visa/.test(afterTapToTalk));
check("queued typed message also appears in the chat", /typed while listening/.test(afterTapToTalk));
await guest.screenshot({ path: join(outDir, "counter-guest-tap-to-talk.png") });
await guest.unroute("**/api/counter/message");

// Ending discards the session outright, rather than leaving it readable.
sessionEnded = true;
await host.getByRole("button", { name: "종료" }).click();
await host.waitForTimeout(2000);

const afterEnd = await fetch(`${base}/api/counter/session?code=${code}`);
check("ending the conversation discards it on the server", afterEnd.status === 404);
check(
  "the visitor is told it ended, in their own language",
  /This conversation has ended/.test(await guest.locator("body").innerText()),
);

await browser.close();

// --- Report ---------------------------------------------------------------
if (pageProblems.length) {
  console.log("\nPage problems:");
  for (const problem of pageProblems) console.log(`  ${problem}`);
}

const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed || pageProblems.length) process.exit(1);