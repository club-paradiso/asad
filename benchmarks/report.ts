/**
 * Benchmark report rendering.
 *
 * Two audiences. The summary table is for whoever picks the default model. The
 * side-by-side review sheet is for a human interpreter, who is the only one who
 * can actually judge whether an English rendering is sayable — the machine
 * scores are proxies and are labelled as such.
 */
import type { BenchmarkRun } from "./runner";
import { BENCH_CASES } from "./dataset";
import { WEIGHTS } from "./score";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const ms = (n: number) => (n > 0 ? `${n}ms` : "—");

export function renderConsole(run: BenchmarkRun): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("═".repeat(72));
  lines.push(`  tong-yuck LLM benchmark · ${run.cases} cases · ${run.repeats}× each`);
  lines.push("═".repeat(72));

  if (run.scores.length === 0) {
    lines.push("");
    lines.push("  No providers ran.");
  }

  for (const score of run.scores) {
    const flag = score.disqualified ? " ✗ DISQUALIFIED" : "";
    lines.push("");
    lines.push(`  ${score.provider} (${score.model})${flag}`);
    lines.push(`    total            ${pct(score.total)}`);
    lines.push(`    fidelity         ${pct(score.components.fidelity)}`);
    lines.push(`    speakability     ${pct(score.components.speakability)}`);
    lines.push(`    latency          ${pct(score.components.latency)}  p50 ${ms(score.latency.p50)} · p95 ${ms(score.latency.p95)}`);
    lines.push(`    schema           ${pct(score.components.schema)}`);
    lines.push(`    sustainability   ${pct(score.components.sustainability)}`);
    lines.push(`    privacy          ${pct(score.components.privacy)}`);
    if (score.hardFailures.length) {
      lines.push(`    hard failures    ${score.hardFailures.join(", ")}`);
    }
    for (const note of score.notes) lines.push(`    · ${note}`);
  }

  if (run.skipped.length) {
    lines.push("");
    lines.push("  Skipped (no credentials):");
    for (const s of run.skipped) lines.push(`    - ${s.provider}: ${s.reason}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function renderMarkdown(run: BenchmarkRun): string {
  const out: string[] = [];

  out.push("# tong-yuck LLM benchmark");
  out.push("");
  out.push(`Run ${run.startedAt} → ${run.finishedAt}`);
  out.push("");
  out.push(
    `${run.cases} interpretation cases, ${run.repeats}× each, ${run.deadlineMs}ms deadline, Node ${run.environment.node}.`,
  );
  out.push("");

  if (run.scores.length === 0) {
    out.push("**No providers ran.** Every candidate was skipped for lack of credentials.");
    out.push("");
  }

  /* --- Summary ---------------------------------------------------------- */
  out.push("## Summary");
  out.push("");
  out.push(
    `Weights: fidelity ${pct(WEIGHTS.fidelity)} · speakability ${pct(WEIGHTS.speakability)} · latency ${pct(WEIGHTS.latency)} · schema ${pct(WEIGHTS.schema)} · sustainability ${pct(WEIGHTS.sustainability)} · privacy ${pct(WEIGHTS.privacy)}.`,
  );
  out.push("");
  out.push(
    "| Provider | Model | Total | Fidelity | Speakable | Latency p50 / p95 | Schema | Quota | Privacy | Verdict |",
  );
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of run.scores) {
    out.push(
      `| ${s.provider} | \`${s.model}\` | **${pct(s.total)}** | ${pct(s.components.fidelity)} | ${pct(
        s.components.speakability,
      )} | ${ms(s.latency.p50)} / ${ms(s.latency.p95)} | ${pct(s.components.schema)} | ${pct(
        s.components.sustainability,
      )} | ${pct(s.components.privacy)} | ${s.disqualified ? "**disqualified**" : "eligible"} |`,
    );
  }
  out.push("");

  if (run.skipped.length) {
    out.push("### Not tested");
    out.push("");
    out.push("These providers were skipped because no credential was configured:");
    out.push("");
    for (const s of run.skipped) out.push(`- **${s.provider}** — ${s.reason}`);
    out.push("");
    out.push(
      "> No claim is made about their quality or latency. A provider that was not run was not measured.",
    );
    out.push("");
  }

  /* --- Hard failures ---------------------------------------------------- */
  const withFailures = run.scores.filter((s) => s.hardFailures.length > 0);
  if (withFailures.length) {
    out.push("## Hard failures");
    out.push("");
    out.push("These make a candidate unsuitable regardless of its numeric score.");
    out.push("");
    for (const s of withFailures) {
      out.push(`### ${s.provider}`);
      out.push("");
      for (const failure of s.hardFailures) out.push(`- \`${failure}\``);
      const failing = s.cases.filter((c) => c.hardFailures.length > 0);
      out.push("");
      for (const c of failing) {
        out.push(`- **${c.caseId}** (${c.category}): ${c.hardFailures.join(", ")}`);
        if (c.fidelity.forbiddenHit.length) {
          out.push(`  - produced a forbidden rendering: ${c.fidelity.forbiddenHit.map((f) => `"${f}"`).join(", ")}`);
        }
      }
      out.push("");
    }
  }

  /* --- Human review sheet ------------------------------------------------ */
  out.push("## Side-by-side review");
  out.push("");
  out.push(
    "For a human interpreter. The scores above are proxies; whether English is *sayable* is a judgement only a person doing the job can make.",
  );
  out.push("");

  for (const benchCase of BENCH_CASES) {
    out.push(`### ${benchCase.id} · ${benchCase.category}`);
    out.push("");
    out.push(`> ${benchCase.challenge}`);
    out.push("");
    out.push("**Korean**");
    out.push("");
    out.push("```");
    out.push(benchCase.korean);
    out.push("```");
    out.push("");
    if (benchCase.reference) {
      out.push(`**Reference rendering** — ${benchCase.reference}`);
      out.push("");
    }

    for (const score of run.scores) {
      const result = score.cases.find((c) => c.caseId === benchCase.id);
      if (!result) continue;
      const marks = [
        `${result.latencyMs}ms`,
        `${result.speakability.stats.chunks} chunks`,
        result.schemaValid ? "schema ok" : "**schema FAILED**",
        ...(result.hardFailures.length ? [`**${result.hardFailures.join(", ")}**`] : []),
      ];
      out.push(`**${score.provider}** — ${marks.join(" · ")}`);
      out.push("");
      if (result.safeChunks.length === 0) {
        out.push(`> _(no output${result.error ? `: ${result.error}` : ""})_`);
      } else {
        for (const chunk of result.safeChunks) out.push(`> ${chunk}`);
        for (const chunk of result.anticipatedChunks) out.push(`> ◦ _${chunk}_ (anticipated)`);
      }
      const warnings = result.speakability.issues.filter((i) => i.severity === "error");
      if (warnings.length) {
        out.push(">");
        for (const w of warnings) out.push(`> ⚠ ${w.code}: ${w.detail}`);
      }
      out.push("");
    }
  }

  return out.join("\n");
}
