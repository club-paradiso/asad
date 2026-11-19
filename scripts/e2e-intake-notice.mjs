// Staff desk -> visitor screen fixed phrases ("안내 문구"), in Chromium and WebKit (legacy iPad engine).
import { chromium, webkit } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const IDS = ["ticket","call","moment","counter","floor3","back4","visit","resvNeed","resvShow","docs","form","passport","photo","fee","online","today","interp"];
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// CI runs without the shared Redis store, so the intake API is served by an in-test fake with the same
// contract as src/app/api/intake/*. Server-side validation itself is covered by src/intake/store.test.ts.
async function fakeBackend(ctx, station) {
  const s = { code: "NTCE234567", token: "n".repeat(43), station, entries: [], live: null, notice: null, seq: 0 };
  await ctx.route("**/api/intake/session*", async route => {
    const req = route.request();
    if (req.method() === "POST") return json(route, 201, { code: s.code, staffToken: s.token, expiresAt: Date.now() + 3600e3, station });
    if (req.headers()["x-asad-intake-staff-token"] !== s.token) return json(route, 403, { error: "forbidden" });
    return json(route, 200, { code: s.code, expiresAt: Date.now() + 3600e3, entries: s.entries, live: s.live, notice: s.notice, station });
  });
  await ctx.route("**/api/intake/live", async route => {
    const { code: _c, ...rest } = route.request().postDataJSON();
    s.live = { ...rest, updatedAt: Date.now() };
    return json(route, 200, { ok: true, stale: false });
  });
  await ctx.route("**/api/intake/notice*", async route => {
    const req = route.request();
    if (req.method() === "GET") return json(route, 200, { notice: s.notice, seq: s.seq });
    if (req.headers()["x-asad-intake-staff-token"] !== s.token) return json(route, 403, { error: "forbidden" });
    const body = req.postDataJSON();
    const ok = body.code === s.code && (body.id === null || IDS.includes(body.id)) &&
      (body.id === "counter") === (body.counter !== undefined) && Object.keys(body).every(k => ["code", "id", "counter"].includes(k));
    if (!ok) return json(route, 400, { error: "Invalid notice." });
    s.seq++;
    s.notice = body.id === null ? null : { id: body.id, n: s.seq, at: Date.now(), ...(body.counter ? { counter: body.counter } : {}) };
    return json(route, 200, { ok: true, notice: s.notice, seq: s.seq });
  });
}

const textOf = async (page) => (await page.locator("#notice-layer").innerText()).replace(/\s+/g, " ");

async function run(name, engine, station) {
  const browser = await engine.launch(name === "chromium" ? chromiumLaunchOptions() : {});
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await fakeBackend(ctx, station);
    const desk = await ctx.newPage();
    desk.on("pageerror", e => errors.push("desk: " + e.message));
    await desk.goto(BASE + "/compat/desk.html");
    await desk.selectOption("#staff-station", String(station));
    await desk.getByRole("button", { name: "시작" }).click();
    await desk.locator(".code").first().waitFor();
    const code = (await desk.locator(".code").first().innerText()).trim();

    const kiosk = await ctx.newPage();
    kiosk.on("pageerror", e => errors.push("kiosk: " + e.message));
    await kiosk.goto(`${BASE}/compat/kiosk.html?desk=${code}&station=${station}&display=1`);

    await kiosk.getByRole("button", { name: "Tiếng Việt" }).click();
    await desk.locator(".noticePanel").waitFor({ timeout: 15000 });

    await desk.getByRole("button", { name: "창구 안내" }).click();
    await desk.getByRole("button", { name: "3번 창구" }).click();
    await desk.getByText("표시 중: 3번 창구 안내").waitFor();
    await kiosk.locator("#notice-layer").waitFor({ timeout: 8000 });
    const shown = await textOf(kiosk);
    if (!shown.includes("Vui lòng đến quầy số 3.") || !shown.includes("3번 창구로 가세요.")) throw Error("counter phrase: " + shown);

    await desk.getByRole("button", { name: "통합신청서" }).click();
    await kiosk.waitForFunction(() => document.querySelector("#notice-layer")?.textContent.includes("Application Form"), null, { timeout: 8000 });

    await desk.getByRole("button", { name: "화면에서 지우기" }).click();
    await kiosk.locator("#notice-layer").waitFor({ state: "detached", timeout: 8000 });

    // The visitor can close it; it does not come back until the staff member sends again.
    await desk.getByRole("button", { name: "번호표" }).click();
    await kiosk.locator("#notice-layer").waitFor({ timeout: 8000 });
    await kiosk.getByRole("button", { name: "OK" }).click();
    await kiosk.waitForTimeout(6000);
    if (await kiosk.locator("#notice-layer").count()) throw Error("dismissed phrase came back");
    await desk.getByRole("button", { name: "번호표" }).click();
    await kiosk.locator("#notice-layer").waitFor({ timeout: 8000 });

    if (errors.length) throw Error(errors.join("\n"));
    console.log(`PASS ${name}: desk phrase cards → visitor overlay (counter pad, replace, clear, dismiss, resend)`);
  } finally { await browser.close(); }
}

await run("chromium", chromium, 4);
await run("webkit", webkit, 5);
