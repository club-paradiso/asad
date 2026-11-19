import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { chromiumLaunchOptions } from "./browser.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const runtime = "/offline-v2/";
const assets = ["inference.js", "transformers.web.js", "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm", "ko-check.wav"].map(x => runtime + x);
for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  const browser = await engine.launch(name === "Chromium" ? chromiumLaunchOptions() : {});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const unexpected = [];
    page.on("pageerror", error => unexpected.push(error.message));
    context.on("request", request => {
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin) unexpected.push(request.url());
    });
    await page.goto(base + "/live");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    const ready = await page.evaluate(async paths => {
      const channel = new MessageChannel();
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Shell cache timed out")), 60000);
        channel.port1.onmessage = ({ data }) => { clearTimeout(timer); resolve(data.ok === true); };
        navigator.serviceWorker.controller.postMessage({ type: "ASAD_PREPARE_SHELL", paths }, [channel.port2]);
      });
    }, assets);
    assert.ok(ready, name + ": shell cache preparation");
    for (const path of assets) {
      assert.equal(await page.evaluate(async p => !!(await (await caches.open("asad-offline-shell-v2")).match(p)), path), true);
    }
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    const probe = await page.evaluate(url => new Promise((resolve, reject) => {
      const worker = new Worker(url, { type: "module" });
      const timer = setTimeout(() => { worker.terminate(); reject(Error("Worker probe timed out")); }, 45000);
      worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(Error(error.message)); };
      worker.onmessage = ({ data }) => {
        clearTimeout(timer); worker.terminate();
        if (data.error) reject(Error(data.error)); else resolve(data);
      };
      worker.postMessage({ id: 1, action: "probe" });
    }), runtime + "inference.js");
    assert.ok(probe.ok, name + ": local ONNX wasm compiled");
    assert.equal(probe.version, "4.3.2");
    assert.deepEqual(unexpected, [], name + ": external network or script errors");
    console.log("PASS", name, "v4 Worker import, JSEP WASM compile, service-worker offline cache");
    await context.close();
  } finally {
    await browser.close();
  }
}
