/**
 * Deterministic translation-quality benchmark for Counter Mode.
 *
 * No provider is called. What is measured is the behaviour of the integrity
 * and negation validators over the synthetic administrative corpus: how often
 * they wrongly flag a faithful rendering (false positives, the warning people
 * learn to ignore) and how often they miss a real corruption (false
 * negatives, the warning that was needed and never came).
 */
import { validateTranslationIntegrity } from "@/counter/integrity";
import { compareNegation, negationCheckAvailable } from "@/counter/negation";
import { QUALITY_CORPUS, type Defect, type QualityCase } from "./corpus";

export interface QualityFinding {
  caseId: string;
  pair: string;
  kind: "false-positive" | "false-negative";
  text: string;
  defect?: Defect;
  issues: string[];
}

export interface QualityReport {
  cases: number;
  faithful: { total: number; verified: number; falsePositives: number };
  corrupted: { total: number; caught: number; falseNegatives: number };
  byDefect: Record<string, { total: number; caught: number }>;
  byPair: Record<string, { faithful: number; falsePositives: number; corrupted: number; falseNegatives: number }>;
  negationCoverage: { covered: string[]; uncovered: string[] };
  findings: QualityFinding[];
}

const describe = (source: string, target: string, sourceLang: string, targetLang: string): string[] => {
  const integrity = validateTranslationIntegrity(source, target, sourceLang, targetLang);
  const negation = compareNegation(source, target, sourceLang, targetLang);
  const issues = integrity.issues.map(
    (issue) => `${issue.kind}:${issue.reason}:${issue.sourceText || issue.targetText}`,
  );
  if (negation === "dropped" || negation === "added") issues.push(`negation:${negation}`);
  return [...new Set(issues)];
};

export function runQualityBenchmark(corpus: QualityCase[] = QUALITY_CORPUS): QualityReport {
  const report: QualityReport = {
    cases: corpus.length,
    faithful: { total: 0, verified: 0, falsePositives: 0 },
    corrupted: { total: 0, caught: 0, falseNegatives: 0 },
    byDefect: {},
    byPair: {},
    negationCoverage: { covered: [], uncovered: [] },
    findings: [],
  };

  const languages = new Set<string>();
  for (const item of corpus) {
    languages.add(item.sourceLang);
    languages.add(item.targetLang);
    const pair = `${item.sourceLang}→${item.targetLang}`;
    const perPair = (report.byPair[pair] ??= { faithful: 0, falsePositives: 0, corrupted: 0, falseNegatives: 0 });

    for (const text of item.faithful) {
      report.faithful.total += 1;
      perPair.faithful += 1;
      const issues = describe(item.source, text, item.sourceLang, item.targetLang);
      if (issues.length === 0) report.faithful.verified += 1;
      else {
        report.faithful.falsePositives += 1;
        perPair.falsePositives += 1;
        report.findings.push({ caseId: item.id, pair, kind: "false-positive", text, issues });
      }
    }

    for (const corrupted of item.corrupted) {
      report.corrupted.total += 1;
      perPair.corrupted += 1;
      const perDefect = (report.byDefect[corrupted.defect] ??= { total: 0, caught: 0 });
      perDefect.total += 1;
      const issues = describe(item.source, corrupted.text, item.sourceLang, item.targetLang);
      if (issues.length > 0) {
        report.corrupted.caught += 1;
        perDefect.caught += 1;
      } else {
        report.corrupted.falseNegatives += 1;
        perPair.falseNegatives += 1;
        report.findings.push({
          caseId: item.id,
          pair,
          kind: "false-negative",
          text: corrupted.text,
          defect: corrupted.defect,
          issues,
        });
      }
    }
  }

  for (const language of [...languages].sort()) {
    (negationCheckAvailable(language) ? report.negationCoverage.covered : report.negationCoverage.uncovered).push(language);
  }
  return report;
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;

export function renderQualityMarkdown(report: QualityReport): string {
  const lines: string[] = [];
  lines.push(`| Metric | Value |`, `| --- | --- |`);
  lines.push(`| Cases | ${report.cases} |`);
  lines.push(
    `| Faithful renderings verified | ${report.faithful.verified} / ${report.faithful.total} (false-positive rate ${pct(report.faithful.falsePositives, report.faithful.total)}) |`,
  );
  lines.push(
    `| Corruptions caught | ${report.corrupted.caught} / ${report.corrupted.total} (false-negative rate ${pct(report.corrupted.falseNegatives, report.corrupted.total)}) |`,
  );
  lines.push("", `| Defect | Caught |`, `| --- | --- |`);
  for (const [defect, value] of Object.entries(report.byDefect).sort()) {
    lines.push(`| ${defect} | ${value.caught} / ${value.total} |`);
  }
  lines.push("", `| Pair | Faithful FP | Corrupted FN |`, `| --- | --- | --- |`);
  for (const [pair, value] of Object.entries(report.byPair).sort()) {
    lines.push(`| ${pair} | ${value.falsePositives} / ${value.faithful} | ${value.falseNegatives} / ${value.corrupted} |`);
  }
  lines.push(
    "",
    `Negation check available: ${report.negationCoverage.covered.join(", ") || "none"}.`,
    `Negation check knowingly absent: ${report.negationCoverage.uncovered.join(", ") || "none"}.`,
  );
  if (report.findings.length) {
    lines.push("", `| Case | Kind | Text | Validator output |`, `| --- | --- | --- | --- |`);
    for (const finding of report.findings) {
      lines.push(
        `| ${finding.caseId} | ${finding.kind}${finding.defect ? ` (${finding.defect})` : ""} | ${finding.text} | ${finding.issues.join("; ") || "verified"} |`,
      );
    }
  }
  return lines.join("\n");
}
