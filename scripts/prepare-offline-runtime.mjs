import { copyFile, mkdir, readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const runtime = new URL("public/offline-v2/", root);
const transformers = new URL("node_modules/@huggingface/transformers/", root);
const onnx = new URL("node_modules/onnxruntime-web/", root);
const transformerPackage = JSON.parse(await readFile(new URL("package.json", transformers), "utf8"));
const onnxPackage = JSON.parse(await readFile(new URL("package.json", onnx), "utf8"));

// ONNX must come from the *exact* version used to bundle Transformers.js v4.
// Copying a v3 JSEP wasm from the Transformers.js dist directory does not work.
if (transformerPackage.version !== "4.3.2" ||
    onnxPackage.version !== transformerPackage.dependencies["onnxruntime-web"]) {
  throw new Error("Transformers.js / ONNX Runtime Web version mismatch");
}
await mkdir(runtime, { recursive: true });
const assets = [
  [new URL("dist/transformers.min.js", transformers), "transformers.min.js"],
  [new URL("dist/ort-wasm-simd-threaded.jsep.mjs", onnx), "ort-wasm-simd-threaded.jsep.mjs"],
  [new URL("dist/ort-wasm-simd-threaded.jsep.wasm", onnx), "ort-wasm-simd-threaded.jsep.wasm"],
  [new URL("public/offline-v1/ko-check.wav", root), "ko-check.wav"],
  [new URL("LICENSE", transformers), "TRANSFORMERS-LICENSE.txt"],
];
for (const [source, filename] of assets) {
  const size = (await stat(source)).size;
  if (size === 0 || (filename.endsWith(".wasm") && size < 1_000_000)) {
    throw new Error(`Invalid offline runtime asset: ${filename}`);
  }
  await copyFile(source, new URL(filename, runtime));
}
