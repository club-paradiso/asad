/**
 * npm run soak
 *
 * Long-session soak test. Simulates a full service and asserts the things that
 * quietly break over 45 minutes: unbounded memory, a growing request backlog,
 * context that creeps upward, or a rate-limit loop.
 *
 *   npm run soak                  # 45 minutes
 *   npm run soak -- --minutes 60
 */
import { runLiveBenchmark } from "../benchmarks/live-harness.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--minutes");
const minutes = at === -1 ? 45 : Number(args[at + 1]);

console.log(`\ntong-yuck soak test · ${minutes} simulated minutes\n`);

const before = process.memoryUsage().heapUsed;
const result = await runLiveBenchmark({
  minutes,
  lag: "balanced",
  onProgress: (m) => console.log(m),
});
if (global.gc) global.gc();
const after = process.memoryUsage().heapUsed;

const checks = [];
const check = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

console.log("");

// The chunk store caps what it keeps in view; without that a 70-minute session
// grows without limit.
check(
  "chunks in memory stay bounded",
  result.bounds.finalChunks <= 400,
  `${result.bounds.finalChunks} chunks after ${result.segments} segments (cap 400)`,
);

check(
  "context per call stays bounded",
  result.tokens.perCall.max <= 4000,
  `peak ${result.bounds.peakContextTokens} tokens; max per call ${result.tokens.perCall.max}`,
);

// Context must not grow with session length — that is what makes minute 60 as
// cheap as minute 5.
const firstQuarter = result.tokens.perCall.p50;
check(
  "context does not grow with session length",
  result.tokens.perCall.max <= firstQuarter * 2.5,
  `median ${firstQuarter}, max ${result.tokens.perCall.max}`,
);

check(
  "no request backlog",
  result.bounds.maxInFlight <= 1,
  `max concurrent interpretation calls: ${result.bounds.maxInFlight}`,
);

check(
  "no rate-limit loop",
  result.rateLimitEvents < result.interpretationCalls * 0.25,
  `${result.rateLimitEvents} rate-limit events across ${result.interpretationCalls} calls`,
);

const growthMb = (after - before) / 1024 / 1024;
check(
  "heap growth is modest",
  growthMb < 120,
  `${growthMb.toFixed(1)} MB retained after ${minutes} simulated minutes`,
);

check(
  "call rate matches the expected live workload",
  result.callsPerMinute > 0 && result.callsPerMinute < 30,
  `${result.callsPerMinute} calls/min`,
);

const failed = checks.filter((c) => !c.passed).length;
console.log(`\n${checks.length - failed}/${checks.length} soak checks passed`);
process.exit(failed > 0 ? 1 : 0);
