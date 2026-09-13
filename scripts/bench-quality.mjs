/**
 * npm run bench:quality
 *
 * Runs the deterministic quality harness and writes the report to
 * benchmarks/results/quality-latest.md. No provider, no credentials.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderQualityReport, runQualityHarness } from "../benchmarks/quality.ts";

const report = runQualityHarness();
const markdown = renderQualityReport(report);
const dir = join(process.cwd(), "benchmarks", "results");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "quality-latest.md"), `${markdown}\n`);
console.log(markdown);
