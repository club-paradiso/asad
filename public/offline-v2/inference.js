import { env, pipeline } from "./transformers.web.js";

const runtime = new URL("./", import.meta.url).href;
const networkFetch = self.fetch.bind(self);
const wasm = new URL("ort-wasm-simd-threaded.jsep.wasm", runtime).href;
const wasmFactory = new URL("ort-wasm-simd-threaded.jsep.mjs", runtime).href;
// Transformers.js requires a local locator even when serving a custom cache.
// Refuse its implicit fetches. Only an explicit download uses networkFetch.
self.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input, runtime);
  if (url.href !== wasm && url.href !== wasmFactory) return Promise.reject(new TypeError("Offline inference asset is not cached."));
  return networkFetch(input, options);
};
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
// v4 supports WASM caching, but the service worker already verifies the entire
// local shell. Avoid blob: imports and prevent ONNX from reaching a CDN.
env.useWasmCache = false;
env.fetch = () => Promise.reject(new TypeError("Unverified remote model fetch blocked."));
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { mjs: wasmFactory, wasm };
env.backends.onnx.wasm.proxy = false;

const models = new Map();
const MARKER = new URL("verified.json", runtime).href;
const urlFor = (model, path) => `https://huggingface.co/${model.repo}/resolve/${model.revision}/${path}`;
const cacheName = (model) => `asad-model-v1-${model.revision}`;

env.customCache = {
  async match(url) {
    const revision = /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/([a-f0-9]{40})\//.exec(url)?.[1];
    if (!revision || !(await caches.has(cacheName({ revision })))) return undefined;
    return (await (await caches.open(cacheName({ revision }))).match(url)) ?? undefined;
  },
  async put() {},
};

async function complete(model) {
  if (!(await caches.has(cacheName(model)))) return false;
  const cache = await caches.open(cacheName(model));
  if (!(await cache.match(MARKER))) return false;
  for (const asset of model.files) {
    const response = await cache.match(urlFor(model, asset.path));
    if (response?.headers.get("x-asad-sha256") !== asset.sha256 ||
        Number(response.headers.get("content-length")) !== asset.bytes) return false;
  }
  return true;
}

async function download(model, progress) {
  if (await complete(model)) {
    progress(1);
    return;
  }
  const cache = await caches.open(cacheName(model));
  const total = model.files.reduce((sum, asset) => sum + asset.bytes, 0);
  let completed = 0;
  try {
    for (const asset of model.files) {
      const url = urlFor(model, asset.path);
      const cached = await cache.match(url);
      if (cached?.headers.get("x-asad-sha256") === asset.sha256 &&
          Number(cached.headers.get("content-length")) === asset.bytes) {
        completed += asset.bytes;
        progress(completed / total);
        continue;
      }
      const response = await networkFetch(url, { credentials: "omit", cache: "no-store" });
      if (!response.ok || !response.body) throw new Error("Model download failed. Check your connection and retry.");
      const reader = response.body.getReader();
      const bytes = new Uint8Array(asset.bytes);
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.byteLength > bytes.length) {
          await reader.cancel();
          throw new Error("Model file failed its size check.");
        }
        bytes.set(value, offset);
        offset += value.byteLength;
        progress((completed + offset) / total);
      }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((part) => part.toString(16).padStart(2, "0")).join("");
      if (offset !== asset.bytes || hash !== asset.sha256) throw new Error("Model file failed its integrity check.");
      await cache.put(url, new Response(bytes, { headers: {
        "content-length": String(asset.bytes),
        "x-asad-sha256": hash,
      } }));
      completed += asset.bytes;
    }
  } catch (error) {
    if (error.name === "QuotaExceededError") throw new Error("This browser has insufficient storage for the local model.");
    throw error;
  }
  // Publish the revision only after all files have passed their integrity checks.
  await cache.put(MARKER, new Response("ok"));
}

async function load(kind, spec) {
  if (models.has(kind)) return models.get(kind);
  if (!(await complete(spec))) throw new Error("Local model is incomplete. Prepare it again in Settings.");
  const started = performance.now();
  const task = kind === "speech" ? "automatic-speech-recognition" : "translation";
  // WASM is the supported baseline. The WebGPU backend is deliberately opt-in
  // at the protocol level and never used by the live console without validation.
  const preferences = spec.experimentalGpu && navigator.gpu ? ["webgpu", "wasm"] : ["wasm"];
  for (const device of preferences) {
    try {
      const run = await pipeline(task, spec.repo, {
        revision: spec.revision, dtype: "q8", device, local_files_only: true,
        session_options: { enableCpuMemArena: false },
      });
      const loaded = { run, device, setupMs: performance.now() - started };
      models.set(kind, loaded);
      return loaded;
    } catch (error) {
      if (device === "wasm") throw error;
    }
  }
}

let tail = Promise.resolve();
self.addEventListener("message", ({ data }) => {
  const { id, kind, spec, action, input } = data;
  const publish = (message) => self.postMessage({ id, ...message });
  tail = tail.then(async () => {
    if (action === "probe") {
      // Browser CI probes the actual v4 worker + locally served WASM, without
      // downloading large private-use model fixtures or sending API requests.
      const response = await networkFetch(wasm, { cache: "no-store" });
      if (!response.ok) throw new Error("Local ONNX WASM is unavailable.");
      const compiledWasm = await WebAssembly.compile(await response.arrayBuffer());
      publish({ ok: compiledWasm instanceof WebAssembly.Module, version: env.version });
      return;
    }
    if (action === "download") {
      await download(spec, (ratio) => publish({ ratio }));
      publish({ ok: true });
      return;
    }
    const { run, device, setupMs } = await load(kind, spec);
    publish({ loading: false });
    const started = performance.now();
    const result = kind === "speech"
      ? (await run(input, { language: "ko", task: "transcribe", return_timestamps: false, max_new_tokens: 96 })).text
      : (await run(input, { max_new_tokens: 160, truncation: true })).at(0)?.translation_text;
    publish({ ok: true, result, ms: performance.now() - started, device, setupMs });
  }).catch((error) => publish({ error: error?.message || "Local inference failed." }));
});
