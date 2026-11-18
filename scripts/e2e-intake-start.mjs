import { chromium } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const base = process.argv[2] || "http://localhost:3000";
const browser = await chromium.launch(chromiumLaunchOptions());
const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", err => errors.push(err.message));

try {
  // Test the real button on the legacy-compatible static desk, with API mocked so no
  // real Redis, paid resources, or visitor records are involved.
  let calls = 0;
  // URLs with a ?query have distinct route globs in Playwright.
  await page.route("**/api/intake/session?*", async route => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ code: "ABCD234567", expiresAt: Date.now() + 3600000, entries: [] }),
    });
  });
  await page.route("**/api/intake/session", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ code: "ABCD234567", expiresAt: Date.now() + 3600000, entries: [] }),
      });
      return;
    }
    if (route.request().method() !== "POST") {
      await route.fulfill({ status: 405, contentType: "application/json", body: '{"error":"not permitted"}' });
      return;
    }
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Backend unavailable"}' });
    } else {
      await route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({
          code: "ABCD234567",
          staffToken: "abcdefghijklmnopqrstuvwxyzABCDE1234567",
          expiresAt: Date.now() + 60 * 60_000,
        }),
      });
    }
  });

  await page.goto(base + "/secret", { waitUntil: "networkidle" });
  const btn = page.getByRole("button", { name: "실시간 접수 시작" });
  await btn.waitFor({ state: "visible" });
  if (!(await btn.isEnabled())) throw Error("Start button is disabled on first render");
  await btn.click();
  await page.getByRole("alert").getByText(/접수 서버에 연결할 수 없습니다/).waitFor({ timeout: 8000 });
  const retry = page.getByRole("button", { name: "실시간 접수 시작" });
  await retry.click();
  await page.getByText("ABCD234567").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "iPad 연결 링크 복사" }).waitFor({ timeout: 8000 });
  if (errors.length) throw Error("Browser exceptions: " + errors.join("; "));
  if (calls !== 2) throw Error("Expected 2 POST requests, got " + calls);
  console.log("PASS /secret button click, API 503 visible, retry, session code & QR UI, " + calls + " POST calls");
} finally {
  await browser.close();
}