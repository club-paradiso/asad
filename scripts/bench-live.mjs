/**
 * npm run bench:live
 *
 * Replays deterministic transcript timing through the real interpretation
 * pipeline and reports measured latency. Uses whatever provider is configured;
 * with no key that is the local interpreter, which still exercises the engine,
 * the stabiliser, the context budgeter and the router.
 *
 *   npm run bench:live                  # 10 minutes, balanced lag
 *   npm run bench:live -- --minutes 45  # full sermon
 *   npm run bench:live -- --lag fast
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLiveBenchmark } from "../benchmarks/live-harness.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const minutes = Number(flag("minutes", "10"));
const lag = flag("lag", "balanced");
const forceProfile = flag("profile");
/**
 * Hold each answer for a simulated cloud round trip, with NO on-device fast
 * lane — which is what Safari, Firefox and every phone actually run.
 *
 * Without this the harness answers in under a millisecond, so it measures
 * engine overhead and nothing else: the one number it cannot show is what a
 * real provider's latency does to the pipeline around it. The delays below are
 * a stated simulation, not a measurement of any vendor.
 */
const simulateCloud = args.includes("--simulate-cloud");
const cloudMin = Number(flag("cloud-min", "400"));
const cloudMax = Number(flag("cloud-max", "3200"));

console.log(`\ntong-yuck live pipeline benchmark`);
console.log(`Simulating ${minutes} minutes of Korean speech at lag=${lag}`);
if (simulateCloud) {
  console.log(
    `Cloud-first path: simulated provider latency ${cloudMin}–${cloudMax}ms, no on-device fast lane`,
  );
}
console.log("");

const result = await runLiveBenchmark({
  minutes,
  lag,
  forceProfile,
  twoLane: simulateCloud
    ? {
        provisional: "off",
        provisionalDelayMs: 0,
        cloudDelayMs: { min: cloudMin, max: cloudMax },
        spikeRate: 0.06,
        spikeMs: 5_000,
        cloudFailureRate: 0.03,
        seed: 20260918,
      }
    : undefined,
  onProgress: (m) => console.log(m),
});

const pct = (p, unit = "ms") =>
  `p50 ${p.p50}${unit} · p90 ${p.p90}${unit} · p95 ${p.p95}${unit} · max ${p.max}${unit} (n=${p.count})`;
const tick = (ok) => (ok ? "MET" : "MISSED");

console.log(`\n${"═".repeat(68)}`);
console.log(`  Live pipeline · ${result.minutes} min · lag=${result.lag}`);
console.log("═".repeat(68));
console.log(`  segments               ${result.segments}`);
console.log(`  interpretation calls   ${result.interpretationCalls} (${result.callsPerMinute}/min)`);
console.log(`  providers used         ${JSON.stringify(result.providersUsed)}`);
console.log(`  context profiles       ${JSON.stringify(result.tokens.profileCounts)}`);
console.log(`  fallbacks              ${result.fallbacks}`);
console.log(`  rate-limit events      ${result.rateLimitEvents}`);
console.log("");
console.log(`  provider response      ${pct(result.latency.providerResponse)}`);
console.log(`    SLO p50 ≤1500ms      ${tick(result.slo.providerP50Met)}`);
console.log(`    SLO p95 ≤3000ms      ${tick(result.slo.providerP95Met)}`);
console.log("");
console.log(`  stable Korean → safe   ${pct(result.latency.stableToSafe)}`);
console.log(`    SLO p50 ≤2500ms      ${tick(result.slo.stableToSafeP50Met)}`);
console.log(`    SLO p95 ≤4500ms      ${tick(result.slo.stableToSafeP95Met)}`);
console.log("");
console.log(`  tokens per call        ${pct(result.tokens.perCall, "")}`);
console.log(`  session total tokens   ${result.tokens.sessionTotal.toLocaleString()}`);
console.log("");
console.log(`  bounded growth`);
console.log(`    chunks in memory     ${result.bounds.finalChunks}`);
console.log(`    segments in memory   ${result.bounds.finalSegments}`);
console.log(`    peak context tokens  ${result.bounds.peakContextTokens}`);
console.log(`    max concurrent calls ${result.bounds.maxInFlight}`);
console.log("");

if (result.twoLane) {
  const pct = (p) =>
    `p50 ${Math.round(p.p50)}ms · p90 ${Math.round(p.p90)}ms · p95 ${Math.round(p.p95)}ms · max ${Math.round(p.max)}ms (n=${p.count})`;
  console.log(`  cloud-first path (simulated)`);
  console.log(`    stable → interpretation  ${pct(result.twoLane.stableToContextual)}`);
  console.log(`    turns / coalesced        ${result.twoLane.lanes.turns} / ${result.twoLane.lanes.coalescedTurns}`);
  console.log(`    uncovered source beats   ${result.twoLane.uncoveredKorean}`);
  console.log("");
}

const dir = join(process.cwd(), "benchmarks", "results");
mkdirSync(dir, { recursive: true });
const name = simulateCloud ? `live-cloud-${minutes}min-${lag}` : `live-${minutes}min-${lag}`;
writeFileSync(join(dir, `${name}.json`), JSON.stringify(result, null, 2));
console.log(`Wrote benchmarks/results/${name}.json`);

if (Object.keys(result.providersUsed).length === 1 && result.providersUsed.local) {
  console.log(
    "\nNOTE: only the local interpreter ran. Provider latency here is engine overhead,\nnot a measurement of any cloud model.",
  );
}
