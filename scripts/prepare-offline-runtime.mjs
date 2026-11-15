import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const runtime = new URL("public/offline-v1/", root);
const dist = new URL("node_modules/@huggingface/transformers/dist/", root);
await mkdir(runtime, { recursive: true });
await Promise.all([
  "transformers.min.js",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
].map((file) => copyFile(new URL(file, dist), new URL(file, runtime))));

await copyFile(new URL("../LICENSE", dist), new URL("TRANSFORMERS-LICENSE.txt", runtime));
