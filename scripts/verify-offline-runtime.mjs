import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const runtime = new URL("public/offline-v2/", root);
const transformers = JSON.parse(await readFile(new URL("node_modules/@huggingface/transformers/package.json", root)));
const ort = JSON.parse(await readFile(new URL("node_modules/onnxruntime-web/package.json", root)));
assert.equal(transformers.version, "4.3.2");
assert.equal(ort.version, transformers.dependencies["onnxruntime-web"]);
const files = ["inference.js", "transformers.web.js", "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm", "ko-check.wav"];
for (const name of files) assert.ok((await stat(new URL(name, runtime))).size > 100, name);
const shell = await readFile(new URL("public/sw.js", root), "utf8");
const browser = await readFile(new URL("src/providers/offline/runtime.ts", root), "utf8");
const worker = await readFile(new URL("inference.js", runtime), "utf8");
for (const file of files) {
  assert.ok(shell.includes(`/offline-v2/${file}`), `service worker missing ${file}`);
  assert.ok(browser.includes(`"${file}"`), `client missing ${file}`);
}
assert.match(worker, /env\.allowRemoteModels = false/);
assert.match(worker, /env\.useCustomCache = true/);
assert.match(worker, /env\.useWasmCache = false/);
assert.match(worker, /wasmPaths = \{ mjs: wasmFactory, wasm \}/);
console.log("PASS Transformers.js v4 and version-matched ONNX v4 offline assets");
