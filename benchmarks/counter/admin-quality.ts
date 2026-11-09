/**
 * Scores the administrative-meaning benchmark. Pure functions, no I/O.
 *
 * Kept separate, deliberately:
 *   - terminology normalisation (matcher)
 *   - ambiguity detection (meaning layer)
 *   - semantic validation (validator over provided renderings)
 *   - the development set (the structured-value corpus the lexicons were tuned
 *     against) reported apart from the held-out set
 *
 * None of these measures translation quality. A validator that scores well on
 * renderings written by the same author says nothing about how often a model
 * mistranslates in production.
 */
import { matchConcepts } from "@/counter/admin/matcher";
import { detectAmbiguities } from "@/counter/admin/meaning";
import { assessTranslation } from "@/counter/admin/assess";
import { checkSemanticIntegrity } from "@/counter/admin/semantic";
import { AMBIGUITY_CASES, SEMANTIC_CASES, TERMINOLOGY_CASES } from "./admin-corpus";
import { QUALITY_CORPUS } from "./corpus";

export interface Rate {
  hits: number;
  total: number;
  rate: number;
  /** Wilson 95% interval. */
  ci: [number, number];
}

export function wilson(hits: number, total: number): Rate {
  if (total === 0) return { hits, total, rate: 0, ci: [0, 0] };
  const z = 1.96;
  const p = hits / total;
  const denom = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { hits, total, rate: p, ci: [Math.max(0, centre - margin), Math.min(1, centre + margin)] };
}

export interface AdminBenchResult {
  terminology: { exact: Rate; byLang: Record<string, Rate>; failures: string[] };
  ambiguity: { recall: Rate; falsePositive: Rate; failures: string[] };
  semantic: {
    criticalBlocked: Rate;
    materialDetected: Rate;
    expectedCheckFound: Rate;
    faithfulFalseAlarm: Rate;
    byPair: Record<string, { faithful: Rate; corrupted: Rate }>;
    failures: string[];
  };
  development: { faithfulFalseAlarm: Rate; unsupported: number; failures: string[] };
}

const key = (items: Array<{ conceptId: string; kind: string }>) =>
  items.map((item) => `${item.conceptId}:${item.kind}`).sort().join("|");

export function runAdminBenchmark(): AdminBenchResult {
  /* --- Terminology ------------------------------------------------------- */
  const termFailures: string[] = [];
  const byLang: Record<string, { hits: number; total: number }> = {};
  let termHits = 0;
  for (const c of TERMINOLOGY_CASES) {
    const got = matchConcepts(c.text, c.lang).map((m) => ({ conceptId: m.conceptId, kind: m.kind }));
    const ok = key(got) === key(c.expect);
    byLang[c.lang] ??= { hits: 0, total: 0 };
    byLang[c.lang].total += 1;
    if (ok) {
      termHits += 1;
      byLang[c.lang].hits += 1;
    } else termFailures.push(`${c.id}: expected [${key(c.expect)}] got [${key(got)}]`);
  }

  /* --- Ambiguity --------------------------------------------------------- */
  const ambFailures: string[] = [];
  let posHits = 0;
  let posTotal = 0;
  let negFalse = 0;
  let negTotal = 0;
  for (const c of AMBIGUITY_CASES) {
    const got = detectAmbiguities({ text: c.text, lang: c.lang, recent: c.recent }).map((f) => f.ruleId);
    if (c.expect.length) {
      posTotal += 1;
      // Recall: every expected rule fired (extra findings on a positive are not penalised here).
      if (c.expect.every((rule) => got.includes(rule))) posHits += 1;
      else ambFailures.push(`${c.id}: expected [${c.expect.join(",")}] got [${got.join(",")}]`);
    } else {
      negTotal += 1;
      if (got.length) {
        negFalse += 1;
        ambFailures.push(`${c.id}: false positive [${got.join(",")}]`);
      }
    }
  }

  /* --- Semantic (held-out) ----------------------------------------------- */
  const semFailures: string[] = [];
  const pairs: Record<string, { f: [number, number]; c: [number, number] }> = {};
  let critBlocked = 0;
  let critTotal = 0;
  let material = 0;
  let corruptTotal = 0;
  let checkFound = 0;
  let falseAlarm = 0;
  let faithfulTotal = 0;
  for (const c of SEMANTIC_CASES) {
    const pair = `${c.sourceLang}→${c.targetLang}`;
    pairs[pair] ??= { f: [0, 0], c: [0, 0] };
    for (const text of c.faithful) {
      faithfulTotal += 1;
      pairs[pair].f[1] += 1;
      const result = assessTranslation(c.source, text, c.sourceLang, c.targetLang);
      if (result.assessment === "blocked" || result.assessment === "review") {
        falseAlarm += 1;
        pairs[pair].f[0] += 1;
        semFailures.push(
          `${c.id} faithful flagged (${result.assessment}): "${text}" — ${[
            ...result.issues.map((i) => `${i.kind}:${i.reason}`),
            ...(result.semantic?.issues ?? []).filter((i) => i.severity !== "low").map((i) => i.check),
          ].join(", ")}`,
        );
      }
    }
    for (const corruption of c.corrupted) {
      corruptTotal += 1;
      pairs[pair].c[1] += 1;
      const result = assessTranslation(c.source, corruption.text, c.sourceLang, c.targetLang);
      const semantic = checkSemanticIntegrity(c.source, corruption.text, c.sourceLang, c.targetLang);
      const detected = result.status === "mismatch";
      if (detected) material += 1;
      else pairs[pair].c[0] += 1;
      if (semantic.issues.some((issue) => issue.check === corruption.check)) checkFound += 1;
      if (corruption.severity === "critical") {
        critTotal += 1;
        if (result.assessment === "blocked") critBlocked += 1;
        else semFailures.push(`${c.id} critical NOT blocked (${result.assessment}): "${corruption.text}" expected ${corruption.check}`);
      } else if (!detected) {
        semFailures.push(`${c.id} high NOT detected (${result.assessment}): "${corruption.text}" expected ${corruption.check}`);
      }
    }
  }

  /* --- Development set (tuned against — reported apart) ------------------- */
  const devFailures: string[] = [];
  let devFalse = 0;
  let devTotal = 0;
  let devUnsupported = 0;
  for (const c of QUALITY_CORPUS) {
    for (const text of c.faithful) {
      const semantic = checkSemanticIntegrity(c.source, text, c.sourceLang, c.targetLang);
      if (semantic.status === "unsupported") {
        devUnsupported += 1;
        continue;
      }
      devTotal += 1;
      if (semantic.issues.some((issue) => issue.severity !== "low")) {
        devFalse += 1;
        devFailures.push(`${c.id}: ${semantic.issues.map((i) => i.check).join(",")}`);
      }
    }
  }

  return {
    terminology: {
      exact: wilson(termHits, TERMINOLOGY_CASES.length),
      byLang: Object.fromEntries(Object.entries(byLang).map(([lang, v]) => [lang, wilson(v.hits, v.total)])),
      failures: termFailures,
    },
    ambiguity: { recall: wilson(posHits, posTotal), falsePositive: wilson(negFalse, negTotal), failures: ambFailures },
    semantic: {
      criticalBlocked: wilson(critBlocked, critTotal),
      materialDetected: wilson(material, corruptTotal),
      expectedCheckFound: wilson(checkFound, corruptTotal),
      faithfulFalseAlarm: wilson(falseAlarm, faithfulTotal),
      byPair: Object.fromEntries(
        Object.entries(pairs).map(([pair, v]) => [
          pair,
          { faithful: wilson(v.f[0], v.f[1]), corrupted: wilson(v.c[1] - v.c[0], v.c[1]) },
        ]),
      ),
      failures: semFailures,
    },
    development: { faithfulFalseAlarm: wilson(devFalse, devTotal), unsupported: devUnsupported, failures: devFailures },
  };
}

const pct = (r: Rate) =>
  `${r.hits}/${r.total} = ${(r.rate * 100).toFixed(1)}% (95% CI ${(r.ci[0] * 100).toFixed(1)}–${(r.ci[1] * 100).toFixed(1)}%)`;

export function renderAdminMarkdown(result: AdminBenchResult): string {
  const lines: string[] = [];
  lines.push("## Administrative meaning layer (synthetic, offline)");
  lines.push("");
  lines.push(
    "Deterministic components only. These numbers describe the matcher, the ambiguity rules and the semantic validator on a small synthetic corpus written by the same author as the rules. They are NOT a measure of translation quality and NOT external validation.",
  );
  lines.push("");
  lines.push("| Component | Metric | Result |");
  lines.push("| --- | --- | --- |");
  lines.push(`| Terminology | exact concept+kind match | ${pct(result.terminology.exact)} |`);
  lines.push(`| Ambiguity | recall on ambiguous utterances | ${pct(result.ambiguity.recall)} |`);
  lines.push(`| Ambiguity | false-positive rate on clear utterances | ${pct(result.ambiguity.falsePositive)} |`);
  lines.push(`| Semantic | critical corruptions blocked | ${pct(result.semantic.criticalBlocked)} |`);
  lines.push(`| Semantic | all corruptions flagged as mismatch | ${pct(result.semantic.materialDetected)} |`);
  lines.push(`| Semantic | expected check named | ${pct(result.semantic.expectedCheckFound)} |`);
  lines.push(`| Semantic | faithful renderings flagged (false alarm) | ${pct(result.semantic.faithfulFalseAlarm)} |`);
  lines.push(
    `| Semantic (development set, tuned against) | faithful renderings flagged | ${pct(result.development.faithfulFalseAlarm)}; ${result.development.unsupported} renderings in unsupported pairs skipped |`,
  );
  lines.push("");
  lines.push("| Language | Terminology exact |");
  lines.push("| --- | --- |");
  for (const [lang, rate] of Object.entries(result.terminology.byLang).sort()) lines.push(`| ${lang} | ${pct(rate)} |`);
  lines.push("");
  lines.push("| Pair | Faithful flagged | Corrupted caught |");
  lines.push("| --- | --- | --- |");
  for (const [pair, v] of Object.entries(result.semantic.byPair).sort()) {
    lines.push(`| ${pair} | ${v.faithful.hits}/${v.faithful.total} | ${v.corrupted.hits}/${v.corrupted.total} |`);
  }
  const failures = [
    ...result.terminology.failures,
    ...result.ambiguity.failures,
    ...result.semantic.failures,
    ...result.development.failures,
  ];
  lines.push("");
  lines.push(failures.length ? "Failures:" : "No failures on this corpus.");
  for (const failure of failures) lines.push(`- ${failure}`);
  return lines.join("\n");
}
