/**
 * npm run soak:two-lane
 *
 * Simulated two-lane service. Replays the demo sermon through the REAL engine
 * with a mocked on-device translator and a mocked cloud whose latency varies
 * enough to leave the cloud lane behind the fast lane, plus injected failures.
 *
 * Asserts the things a two-lane design can quietly get wrong: more than one
 * cloud request in flight, an unbounded coalesced backlog, Korean that reaches
 * neither lane, and committed English that changes after the fact.
 *
 * Virtual time throughout. It measures no real Chrome model and no real cloud.
 *
 *   npm run soak:two-lane                  # 45 simulated minutes
 *   npm run soak:two-lane -- --minutes 5
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLiveBenchmark } from "../benchmarks/live-harness.ts";
import { MAX_COALESCED_TURNS } from "../src/interpreter/engine/turns.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const minutes = Number(flag("minutes", "45"));
const lag = flag("lag", "balanced");

const simulation = {
  provisionalDelayMs: 120,
  cloudDelayMs: { min: 400, max: 3_200 },
  spikeRate: 0.06,
  spikeMs: 5_000,
  cloudFailureRate: 0.03,
  translatorFailureRate: 0.02,
  seed: 20260910,
};

console.log(`\ntong-yuck two-lane soak · ${minutes} simulated minutes · lag=${lag}`);
console.log(`simulation: ${JSON.stringify(simulation)}\n`);

const before = process.memoryUsage().heapUsed;
const result = await runLiveBenchmark({
  minutes,
  lag,
  forceProfile: "ultra-compact",
  twoLane: simulation,
  onProgress: (m) => console.log(m),
});
if (global.gc) global.gc();
const after = process.memoryUsage().heapUsed;

const two = result.twoLane;
const lanes = two.lanes;
const pct = (p, unit = "ms") =>
  `p50 ${Math.round(p.p50)}${unit} · p90 ${Math.round(p.p90)}${unit} · p95 ${Math.round(p.p95)}${unit} · max ${Math.round(p.max)}${unit} (n=${p.count})`;

console.log(`\n${"═".repeat(68)}`);
console.log(`  Two-lane simulation · ${result.minutes} min · lag=${result.lag}`);
console.log("═".repeat(68));
console.log(`  segments                     ${result.segments}`);
console.log(`  logical turns                ${lanes.turns}`);
console.log(`  cloud calls                  ${result.interpretationCalls} (${result.callsPerMinute}/min)`);
console.log(`  provisional applied          ${lanes.provisionalApplied}`);
console.log(`  provisional failed/superseded ${lanes.provisionalFailed} / ${lanes.provisionalSuperseded}`);
console.log(`  refinements applied          ${lanes.contextualRefined}`);
console.log(`  refinements discarded (committed) ${lanes.contextualDiscardedCommitted}`);
console.log(`  contextual kept provisional  ${lanes.contextualKept}`);
console.log(`  contextual applied fresh     ${lanes.contextualApplied}`);
console.log(`  stale drops (cloud/on-device) ${lanes.contextualStale} / ${lanes.provisionalStale}`);
console.log(`  cloud failures injected      ${two.cloudFailuresInjected} (engine saw ${lanes.contextualFailed})`);
console.log(`  translator failures injected ${two.translatorFailuresInjected}`);
console.log(`  coalesced turns / overflow   ${lanes.coalescedTurns} / ${lanes.coalesceOverflowDrops}`);
console.log(`  max pending (coalesced) turns ${lanes.maxPendingTurns}`);
console.log(`  max concurrent cloud calls   ${result.bounds.maxInFlight}`);
console.log("");
console.log(`  stable → provisional         ${pct(two.stableToProvisional)}`);
console.log(`  stable → contextual accepted ${pct(two.stableToContextual)}`);
console.log(`  provisional → refinement     ${pct(two.provisionalToRefinement)}`);
console.log("");
console.log(`  tokens per call              ${pct(result.tokens.perCall, "")}`);
console.log(`  chunks / segments in memory  ${result.bounds.finalChunks} / ${result.bounds.finalSegments}`);
console.log(`  peak context tokens          ${result.bounds.peakContextTokens}`);
console.log(`  uncovered Korean beats       ${two.uncoveredKorean}`);
console.log(`  committed rewrites           ${two.committedRewrites}`);
console.log("");

const checks = [];
const check = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

check("chunks in memory stay bounded", result.bounds.finalChunks <= 400, `${result.bounds.finalChunks} chunks (cap 400)`);
check("context per call stays bounded", result.tokens.perCall.max <= 4000, `max ${result.tokens.perCall.max} tokens`);
check(
  "context does not grow with session length",
  result.tokens.perCall.max <= result.tokens.perCall.p50 * 2.5,
  `median ${result.tokens.perCall.p50}, max ${result.tokens.perCall.max}`,
);
check("cloud concurrency respects the bound of one", result.bounds.maxInFlight <= 1, `max concurrent ${result.bounds.maxInFlight}`);
check(
  "coalesced backlog stays bounded",
  lanes.maxPendingTurns <= MAX_COALESCED_TURNS,
  `max pending ${lanes.maxPendingTurns} (bound ${MAX_COALESCED_TURNS})`,
);
check("no rate-limit loop", result.rateLimitEvents < result.interpretationCalls * 0.25, `${result.rateLimitEvents} events`);
// The last beat can legitimately still be in flight when the session ends.
check("no lost Korean", two.uncoveredKorean <= 1, `${two.uncoveredKorean} uncovered beat(s) of ${result.segments}`);
check("committed history was never rewritten", two.committedRewrites === 0, `${two.committedRewrites} rewrite(s)`);
check(
  "every turn got English from a lane",
  lanes.provisionalApplied + lanes.provisionalSuperseded + lanes.contextualApplied >= lanes.turns - lanes.provisionalStale - 1,
  `${lanes.provisionalApplied + lanes.provisionalSuperseded + lanes.contextualApplied} of ${lanes.turns} turns`,
);
check("call rate matches the expected live workload", result.callsPerMinute > 0 && result.callsPerMinute < 30, `${result.callsPerMinute} calls/min`);
const growthMb = (after - before) / 1024 / 1024;
check("heap growth is modest", growthMb < 120, `${growthMb.toFixed(1)} MB retained after ${minutes} simulated minutes`);

const dir = join(process.cwd(), "benchmarks", "results");
mkdirSync(dir, { recursive: true });
const name = `live-two-lane-${minutes}min-${lag}`;
writeFileSync(join(dir, `${name}.json`), JSON.stringify(result, null, 2));
console.log(`\nWrote benchmarks/results/${name}.json`);
console.log("NOTE: simulated lanes on a virtual clock. Not a measurement of Chrome's translator or any cloud model.");

const failed = checks.filter((c) => !c.passed).length;
console.log(`\n${checks.length - failed}/${checks.length} two-lane soak checks passed`);
process.exit(failed > 0 ? 1 : 0);
