#!/usr/bin/env node
/**
 * Synthetic-only, no credentials by default. This is a *benchmark harness*,
 * not evidence that any real provider performed well unless --index-live was
 * explicitly requested and the console reports live external calls.
 *
 * Zero live traffic with the default command.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { runEnsemble } from "../src/features/earbud/ensemble/runner.ts";
import { checkCandidate, preservesCriticalTokens, overlap } from "../src/features/earbud/ensemble/decision.ts";
import { translateIndex } from "../src/features/earbud/ensemble/providers.ts";

const flags = process.argv.slice(2);
const live = flags.includes("--index-live");
if (live && !flags.includes("--confirm-synthetic-only")) {
  console.error("Live API calls require explicit --confirm-synthetic-only.");
  process.exit(2);
}
// Live probes are deterministic, data-minimal and explicitly authorised.
const argument = (name) => {
  const idx = flags.indexOf(name);
  return idx < 0 ? null : flags[idx + 1] ?? "";
};
const timeoutMs = Number(argument("--timeout-ms") ?? "4500");
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 20000) {
  console.error("--timeout-ms must be between 1000 and 20000.");
  process.exit(2);
}
const requestedSources = argument("--sources");
const requested = requestedSources ? requestedSources.split(",").map(x => x.trim()).filter(Boolean) : null;
const outputPath = argument("--output");
if (outputPath === "") { console.error("--output requires a file path."); process.exit(2); }
const limitOption = flags.indexOf("--limit");
const requestedLimit = limitOption >= 0 ? Number(flags[limitOption + 1]) : (live ? 3 : 100);
if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
  console.error("The --limit must be an integer between 1 and 100.");
  process.exit(2);
}
const file = join(dirname(fileURLToPath(import.meta.url)), "../benchmarks/earbud/synthetic-ko.json");
const suite = JSON.parse(readFileSync(file, "utf8"));
if (suite.version !== 1 || !Array.isArray(suite.items)) throw new Error("Invalid synthetic fixture suite.");
// Phase 4B live smoke deliberately spans different languages instead of
// testing the first English-only rows; offline mock still covers all fixtures.
const allFixtures = live
  ? [...new Map(suite.items.map(item => [item.source, item])).values()]
  : suite.items;
if (requested && requested.some(lang => !allFixtures.some(row => row.source === lang))) {
  console.error("--sources contains an unknown source language.");
  process.exit(2);
}
const fixtures = (requested
  ? allFixtures.filter(row => requested.includes(row.source))
  : allFixtures
).slice(0, requestedLimit);
if (!fixtures.length) { console.error("No synthetic fixtures selected."); process.exit(2); }
const stats = [];
const percentile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(q * sorted.length) - 1]);
};
for (const row of fixtures) {
  const input = { source: row.source, target: row.target ?? "ko-KR", text: row.text };
  const started = performance.now();
  let text = null;
  let picked = null;
  let adjudication = "not-run";
  let failure = "";
  try {
    if (live) {
      // Public Index API only; no Azure/Gemini traffic. Full ensemble live
      // requests use the protected ASAD endpoint, whose Redis quota guard
      // must reserve characters before Azure can be contacted.
      text = await translateIndex(input, AbortSignal.timeout(timeoutMs));
      picked = "index";
      adjudication = "index-live";
    } else {
      // Deterministic mock verifies wiring, not real-world translation quality.
      const result = await runEnsemble(input, AbortSignal.timeout(5000), {
        index: async () => row.reference,
        azure: async () => row.reference,
      });
      text = result.text;
      picked = result.selected ?? null;
      adjudication = result.adjudication;
    }
  } catch (error) {
    // Provider adapter returns a bounded, safe status string, never source text.
    const description = error instanceof Error ? error.message : "";
    const http = /Index public API unavailable \((\d{3})\)/.exec(description);
    failure = http ? `HTTP ${http[1]}` :
      /timeout|abort|deadline/i.test(description) ? "timeout" : "provider/network error";
  }
  const elapsedMs = Math.round(performance.now() - started);
  const numericSafe = text ? preservesCriticalTokens(row.text, text) : null;
  const validation = text ? checkCandidate(row.text, text, input.target) : { ok: false };
  stats.push({
    id: row.id, lang: row.source, target: input.target, selected: picked, elapsedMs,
    adjudication, outputAvailable: Boolean(text),
    sourceTokenRetention: numericSafe, invariants: validation.ok,
    referenceWordOverlap: text ? Number(overlap(text, row.reference).toFixed(3)) : 0,
    failure,
  });
}
const answered = stats.filter(r => r.outputAvailable);
const timings = answered.map(r => r.elapsedMs);
const summary = {
  runStatus: live
    ? answered.length === 0 ? "UNAVAILABLE"
      : answered.length === stats.length && stats.every(r => r.invariants) ? "RESPONDING_WITH_BASIC_CHECKS" : "DEGRADED"
    : "MOCK_PIPELINE_ONLY",
  perRequestDeadlineMs: live ? timeoutMs : null,
  execution: live ? "LIVE_INDEX_PUBLIC_API" : "MOCK_SELF_CHECK_NOT_MODEL_PERFORMANCE",
  fixtureCount: stats.length,
  languages: [...new Set(stats.map(r => r.lang))],
  completed: answered.length,
  abstentionsOrFailures: stats.length - answered.length,
  invariantPasses: stats.filter(r => r.invariants).length,
  criticalTokenRetention: stats.filter(r => r.sourceTokenRetention === true).length,
  criticalTokenNotApplicable: stats.filter(r => r.sourceTokenRetention === null).length,
  meanReferenceWordOverlap: answered.length
    ? Number((answered.reduce((sum, r) => sum + r.referenceWordOverlap, 0) / answered.length).toFixed(3)) : null,
  p50Ms: percentile(timings, 0.50),
  p95Ms: percentile(timings, 0.95),
  // This is a lexical proxy, not BLEU, COMET, semantic accuracy or a human eval.
  warning: "Reference word overlap and source-token retention do not certify a correct translation. No real PII.",
};
const report = { summary, perFixture: stats };
// The artifact contains metadata only. Never include actual source or translations
// in CI logs, files or dashboards; these examples are synthetic nonetheless.
if (outputPath) {
  const path = resolve(outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(report, null, 2));
// Mock fixtures exercise contracts; live provider outages must be reported
// as a failure to the diagnostic step, not mislabeled as model success.
if (stats.some(r => r.failure || !r.invariants)) process.exitCode = 1;
