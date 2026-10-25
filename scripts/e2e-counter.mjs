/**
 * Counter Mode two-device end-to-end check, with timing.
 *
 * Drives a staff browser and a visitor browser against a running server, the
 * way a desk and a phone would: the desk opens /counter and starts a session,
 * the visitor opens the join link, picks a language and the two exchange
 * messages. Every send is timed from the click to the moment the text is
 * visible on the OTHER device — the number a person at the counter actually
 * waits for.
 *
 * Run against a build with NO translation provider configured (the default in
 * CI): quick phrases are the no-model path and measure transport alone, and a
 * typed message exercises the pending → failed path honestly rather than
 * pretending a mocked model was a translation.
 *
 *   npm run build && LLM_ROUTING_MODE=local npm start &
 *   node scripts/e2e-counter.mjs http://localhost:3000 ./e2e-out
 *
 * Exits non-zero if any check fails or either page logs an error.
 */
import { chromium, devices } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = process.argv[3] ?? "./e2e-out";
mkdirSync(outDir, { recursive: true });

const results = [];
const timings = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const problems = [];
const watch = (page, label) => {
  page.on("pageerror", (error) => problems.push(`${label} exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|404/.test(message.text())) {
      problems.push(`${label} console: ${message.text()}`);
    }
  });
};

const browser = await chromium.launch(chromiumLaunchOptions());
const desk = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: "ko-KR" });
const phone = await browser.newContext({ ...devices["iPhone 13"], locale: "vi-VN" });
const staff = await desk.newPage();
const visitor = await phone.newPage();
watch(staff, "staff");
watch(visitor, "visitor");

/** Time from `act()` until `locator` is visible on the other page. */
async function timed(name, act, locator, timeoutMs = 15_000) {
  const started = Date.now();
  await act();
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    const ms = Date.now() - started;
    timings.push({ name, ms });
    check(name, true, `${ms} ms`);
    return ms;
  } catch (error) {
    const page = locator.page();
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
    check(name, false, `${String(error.message ?? error).split("\n")[0]} · at ${page.url()} · "${body}"`);
    return null;
  }
}

// --- Staff starts a session -------------------------------------------------
await staff.goto(`${base}/counter`, { waitUntil: "networkidle" });
await staff.getByRole("button", { name: /QR 코드 띄우기|새 민원 시작/ }).click();
await staff.getByText(/QR 코드를 스캔해 주세요/).waitFor({ timeout: 15_000 });
const codeText = await staff.locator("p.font-mono").first().innerText();
const code = codeText.replace(/[^A-Z0-9]/gi, "").slice(-4);
check("staff sees a room code", /^[A-Z0-9]{4}$/.test(code), code);
await staff.screenshot({ path: join(outDir, "counter-staff-qr.png") });

// --- Visitor joins -----------------------------------------------------------
await visitor.goto(`${base}/c/${code}`, { waitUntil: "networkidle" });
await visitor.screenshot({ path: join(outDir, "counter-visitor-picker.png") });
await visitor.getByRole("button", { name: "Tiếng Việt" }).click();
const joinStarted = Date.now();
await visitor.getByRole("button", { name: /Bắt đầu|Start/ }).click();
await visitor.getByPlaceholder(/Nhập|Type/).waitFor({ timeout: 15_000 });
check("visitor joins in Vietnamese", true, `${Date.now() - joinStarted} ms`);
// The desk notices the visitor through polling.
await timed(
  "staff sees the visitor joined",
  async () => {},
  staff.getByText(/베트남어/),
);

// --- Quick phrase: the no-model path, pure transport -------------------------
// The bar is collapsed between sends, so each phrase is two taps: open, pick.
const phrase = async (label, expected, target = visitor) =>
  timed(
    `quick phrase reaches the visitor (${label})`,
    async () => {
      const toggle = staff.getByRole("button", { name: "자주 쓰는 문구" });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await staff.getByRole("button", { name: label }).first().click();
    },
    target.getByText(expected, { exact: false }).first(),
  );
const samples = [];
for (const [label, expected] of [
  [/안녕하세요/, "Xin chào"],
  [/잠시만 기다려/, "Vui lòng đợi"],
  [/신분증|여권/, "hộ chiếu"],
]) {
  const ms = await phrase(label, expected);
  if (ms !== null) samples.push(ms);
}

// --- Typed message: optimistic bubble, then the server's verdict -------------
// With no provider the server answers in well under 100 ms — faster than the
// DOM can be observed — so the request is held at the network layer for a
// realistic provider-shaped interval. The real request still goes through.
const SIMULATED_TRANSLATION_MS = 1500;
await visitor.route("**/api/counter/message", async (route) => {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_TRANSLATION_MS));
  await route.continue();
});
const typed = "Tôi muốn gia hạn thời gian cư trú.";
const typedStarted = Date.now();
await visitor.getByPlaceholder(/Nhập|Type/).fill(typed);
await visitor.getByRole("button", { name: /Gửi|Send/ }).click();
const pendingVisible = await visitor
  .locator('[data-status="pending"]')
  .waitFor({ state: "visible", timeout: 2000 })
  .then(() => Date.now() - typedStarted)
  .catch(() => null);
check("sender sees their message at once, marked as translating", pendingVisible !== null, `${pendingVisible} ms`);
// With no provider configured the server stores it as failed; the visitor
// must see that, with their text intact and a retry offered.
const settled = await visitor
  .locator('[data-status="done"], [data-status="failed"]')
  .filter({ hasText: typed })
  .first()
  .waitFor({ state: "visible", timeout: 20_000 })
  .then(() => Date.now() - typedStarted)
  .catch(() => null);
const status = settled === null ? null : await visitor.locator(`[data-status]`).filter({ hasText: typed }).first().getAttribute("data-status");
check(
  "typed message settles to a definite status",
  settled !== null,
  `${status} after ${settled} ms (${SIMULATED_TRANSLATION_MS} ms of that is the simulated hold)`,
);
await visitor.unroute("**/api/counter/message");
check("original text never lost", (await visitor.locator("body").innerText()).includes(typed));
await timed(
  "staff sees the visitor's message (original text, whatever the translation did)",
  async () => {},
  staff.getByText(typed, { exact: false }).first(),
);
await staff.screenshot({ path: join(outDir, "counter-staff-conversation.png") });
await visitor.screenshot({ path: join(outDir, "counter-visitor-conversation.png") });

// --- Reload resilience: the visitor refreshes and keeps the conversation ----
await visitor.reload({ waitUntil: "networkidle" });
const resumed = await visitor
  .getByText(typed, { exact: false })
  .first()
  .waitFor({ state: "visible", timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
check("visitor survives a page reload on the same conversation", resumed);

// --- Two-tap end on the staff device ----------------------------------------
await staff.getByRole("button", { name: "종료", exact: true }).click();
check("staff End asks once before acting", await staff.getByRole("button", { name: /다시 누르면 종료/ }).isVisible());
await staff.getByRole("button", { name: /다시 누르면 종료/ }).click();
await timed(
  "visitor learns the conversation ended",
  async () => {},
  visitor.getByText(/đã kết thúc|ended|Đang kết thúc/i).first(),
  15_000,
);

// --- A right-to-left visitor, for the layout evidence ------------------------
// "종료" took the desk back to the mode picker; the next visitor starts from
// the remembered setup in one tap.
await staff.goto(`${base}/counter`, { waitUntil: "networkidle" });
await staff.getByRole("button", { name: /새 민원 시작|QR 코드 띄우기/ }).click();
await staff.getByText(/QR 코드를 스캔해 주세요/).waitFor({ timeout: 15_000 });
const code2 = (await staff.locator("p.font-mono").first().innerText()).replace(/[^A-Z0-9]/gi, "").slice(-4);
check("staff gets a fresh code for the next visitor", /^[A-Z0-9]{4}$/.test(code2) && code2 !== code, code2);
const arabic = await browser.newContext({ ...devices["Pixel 7"], locale: "ar-SA" });
const arabicVisitor = await arabic.newPage();
watch(arabicVisitor, "arabic visitor");
await arabicVisitor.goto(`${base}/c/${code2}`, { waitUntil: "networkidle" });
await arabicVisitor.getByRole("button", { name: "العربية" }).click();
await arabicVisitor.getByRole("button", { name: /ابدأ|Start/ }).click();
await arabicVisitor.getByPlaceholder(/اكتب|Type/).waitFor({ timeout: 15_000 });
await staff.getByText(/아랍어/).waitFor({ timeout: 15_000 });
await phrase(/신분증|여권/, "جواز", arabicVisitor);
await arabicVisitor.getByPlaceholder(/اكتب|Type/).fill("رقم تأشيرتي D-10 وموعدي 3 PM");
await arabicVisitor.getByRole("button", { name: /إرسال|Send/ }).click();
await arabicVisitor.locator("[data-status]").filter({ hasText: "D-10" }).first().waitFor({ timeout: 20_000 }).catch(() => {});
check(
  "RTL bubble keeps a Latin status code intact",
  (await arabicVisitor.locator("body").innerText()).includes("D-10"),
);
await arabicVisitor.screenshot({ path: join(outDir, "counter-visitor-arabic.png") });
await arabicVisitor.getByRole("button", { name: /إنهاء المحادثة/ }).click();
await arabicVisitor.getByRole("button", { name: /اضغط مرة أخرى/ }).click();
await arabic.close();

// --- Report -----------------------------------------------------------------
const sorted = [...samples].sort((a, b) => a - b);
const summary = {
  base,
  at: new Date().toISOString(),
  quickPhraseDeliveryMs: samples,
  quickPhraseDeliveryP50: sorted[Math.floor(sorted.length / 2)] ?? null,
  timings,
  checks: results,
  problems,
};
writeFileSync(join(outDir, "counter-e2e.json"), JSON.stringify(summary, null, 2));
for (const problem of problems) console.log(`PROBLEM  ${problem}`);
await browser.close();
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed; ${problems.length} page problems`);
process.exit(failed || problems.length ? 1 : 0);
