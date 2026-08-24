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

console.log(`\ntong-yuck live pipeline benchmark`);
console.log(`Simulating ${minutes} minutes of Korean speech at lag=${lag}\n`);

const result = await runLiveBenchmark({
  minutes,
  lag,
  forceProfile,
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

const dir = join(process.cwd(), "benchmarks", "results");
mkdirSync(dir, { recursive: true });
const name = `live-${minutes}min-${lag}`;
writeFileSync(join(dir, `${name}.json`), JSON.stringify(result, null, 2));
console.log(`Wrote benchmarks/results/${name}.json`);

if (Object.keys(result.providersUsed).length === 1 && result.providersUsed.local) {
  console.log(
    "\nNOTE: only the local interpreter ran. Provider latency here is engine overhead,\nnot a measurement of any cloud model.",
  );
}
