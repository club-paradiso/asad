/**
 * npm run bench:llm
 *
 * Runs the interpretation benchmark against every provider that has a key
 * configured, and skips the rest. Writes JSON and Markdown reports.
 *
 *   npm run bench:llm                    # everything configured
 *   npm run bench:llm -- --only gemini   # one provider
 *   npm run bench:llm -- --repeats 3     # median of three runs per case
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBenchmark } from "../benchmarks/runner.ts";
import { renderConsole, renderMarkdown } from "../benchmarks/report.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const only = flag("only")?.split(",").map((s) => s.trim());
const repeats = Number(flag("repeats", "1"));
const deadlineMs = Number(flag("deadline", "12000"));

const run = await runBenchmark({
  only,
  repeats,
  deadlineMs,
  onProgress: (message) => process.stdout.write(`${message}\n`),
});

console.log(renderConsole(run));

const dir = join(process.cwd(), "benchmarks", "results");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "latest.json"), JSON.stringify(run, null, 2));
writeFileSync(join(dir, "latest.md"), renderMarkdown(run));
console.log(`Wrote benchmarks/results/latest.json and latest.md`);

// A disqualified provider is a real result, not a crash.
const eligible = run.scores.filter((s) => !s.disqualified);
if (run.scores.length > 0 && eligible.length === 0) {
  console.log("\nEvery provider that ran was disqualified.");
}
