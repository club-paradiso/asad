// Staff desk -> visitor screen fixed phrases ("안내 문구"), in Chromium and WebKit (legacy iPad engine).
import { chromium, webkit } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const textOf = async (page) => (await page.locator("#notice-layer").innerText()).replace(/\s+/g, " ");

async function run(name, engine, station) {
  const browser = await engine.launch(name === "chromium" ? chromiumLaunchOptions() : {});
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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

// Earlier CI steps open several desks; session creation is limited to 6/min per address.
if (process.env.CI) await new Promise(r => setTimeout(r, 61_000));
await run("chromium", chromium, 4);
await run("webkit", webkit, 5);
