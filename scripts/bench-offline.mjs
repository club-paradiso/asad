import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
import { env, pipeline } from "@huggingface/transformers";

const [root, name = "opus", audioPath = "public/offline-v1/ko-check.wav"] = process.argv.slice(2);
if (!root) throw new Error("Usage: npm run bench:offline -- <model-root> [opus|qwen|whisper] [16k mono PCM WAV]");
const entries = {
  opus: ["translation", "Xenova/opus-mt-ko-en"],
  qwen: ["text-generation", "onnx-community/Qwen3-0.6B-ONNX"],
  whisper: ["automatic-speech-recognition", "Xenova/whisper-tiny"],
};
if (!entries[name]) throw new Error("Specify opus, qwen or whisper.");
env.allowRemoteModels = false;
env.localModelPath = resolve(root) + "/";
const corpus = [
  ["conversation", "오늘 날씨가 좋습니다."],
  ["negation", "우리는 회의를 취소하지 않았지만 시간은 바꿨습니다."],
  ["date", "회의는 2026년 11월 28일 오전 9시 30분에 시작합니다."],
  ["money", "사과 3개와 배 2개를 샀고, 총 15000원을 냈습니다."],
  ["scripture", "요한복음 3장 16절을 함께 읽겠습니다."],
  ["names", "모세는 이스라엘 백성을 이끌고 이집트를 떠났습니다."],
  ["reference", "민수가 영희에게 책을 건넸습니다. 그녀는 그 책을 읽지 않았습니다."],
  ["politeness", "죄송하지만 회의 자료를 다시 보내 주시겠어요?"],
  ["mixed", "다음 주에 Zoom으로 회의하고 Slack에 공유하겠습니다."],
  ["coalesced", "예루살렘에서 시작했습니다. 그 뒤 베들레헴을 방문했고, 10시에 돌아왔습니다."],
];
const [task, model] = entries[name];
const memory = { initialMiB: Math.round(process.memoryUsage.rss() / 1048576) };
let peak = memory.initialMiB;
const sampler = setInterval(() => { peak = Math.max(peak, Math.round(process.memoryUsage.rss() / 1048576)); }, 25);
const initial = performance.now();
const run = await pipeline(task, model, {
  device: "cpu", dtype: "q8", local_files_only: true,
  session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false },
});
const loadMs = performance.now() - initial;
async function infer(input) {
  if (name === "qwen") {
    const prompt = run.tokenizer.apply_chat_template([
      { role: "system", content: "You are a Korean-to-English interpreter. Return only the English translation. Preserve all details, names, numbers, and negation." },
      { role: "user", content: input },
    ], { tokenize: false, add_generation_prompt: true, enable_thinking: false });
    return (await run(prompt, { max_new_tokens: 96, do_sample: false, return_full_text: false }))[0].generated_text;
  }
  if (name === "whisper") return (await run(input, { language: "ko", task: "transcribe", max_new_tokens: 96 })).text;
  return (await run(input, { max_new_tokens: 160, truncation: true }))[0].translation_text;
}

let cases = corpus;
if (name === "whisper") {
  const wav = await readFile(audioPath);
  const clean = Float32Array.from({ length: (wav.length - 44) / 2 }, (_, i) => wav.readInt16LE(44 + 2 * i) / 32768);
  const pause = new Float32Array(clean.length + 32000);
  pause.set(clean, 32000);
  const noisy = clean.map((sample, i) => sample + Math.sin(i * 1.713) * 0.004);
  const faster = Float32Array.from({ length: Math.floor(clean.length / 1.25) }, (_, i) => clean[Math.floor(i * 1.25)]);
  cases = [["clean", clean], ["leading-pause", pause], ["light-noise", noisy], ["sped-up", faster], ["truncated", clean.slice(0, Math.round(clean.length * 0.65))]];
}

const rows = [];
const rounds = Number(process.env.ASAD_BENCH_ROUNDS ?? 3);
for (let round = 0; round < rounds; round++) {
  for (const [label, input] of cases) {
    const t = performance.now();
    const output = await infer(input);
    rows.push({ round, label, ms: Math.round(performance.now() - t), output });
    peak = Math.max(peak, Math.round(process.memoryUsage.rss() / 1048576));
  }
}
const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
memory.peakMiB = peak;
clearInterval(sampler);
await run.dispose();
console.log(JSON.stringify({
  model, environment: `${os.platform()} ${os.arch()} ${os.cpus()[0].model} · Node ${process.version} · ONNX CPU one thread`,
  loadMs: Math.round(loadMs), p50Ms: percentile(0.5), p95Ms: percentile(0.95), memory, rows,
}, null, 2));
