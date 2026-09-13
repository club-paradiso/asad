/**
 * Deterministic quality harness.
 *
 * Scores the model-free parts of the quality path against
 * `quality-fixtures.ts` and reports rates a human can compare across runs:
 * repair success, unnecessary repairs, entity preservation, target-check
 * recall and false alarms, stability-gate agreement, domain classification.
 *
 * It never fabricates a provider number. Anything that depends on a cloud
 * model is out of scope here by construction.
 */
import {
  emptyEntityMemory,
  establishEntity,
  type EntityMemoryState,
} from "@/interpreter/memory/entity-memory";
import { assessSource, assessTarget } from "@/interpreter/repair/assess";
import { materiallyDifferent } from "@/interpreter/repair/stability";
import {
  createContextEngine,
  currentDomain,
  observe,
} from "@/interpreter/context/engine";
import {
  DOMAIN_FIXTURES,
  SOURCE_REPAIR_FIXTURES,
  STABILITY_FIXTURES,
  TARGET_CHECK_FIXTURES,
  type EntitySeed,
} from "./quality-fixtures";

export interface QualityCase {
  id: string;
  ok: boolean;
  detail: string;
}

export interface QualityReport {
  sourceRepair: {
    cases: QualityCase[];
    /** Repairs applied where a repair was expected. */
    repairSuccess: number;
    /** Repairs applied where none was allowed. */
    unnecessaryRepairs: number;
    /** Hypotheses issued where a hypothesis (not a repair) was expected. */
    hypothesisSuccess: number;
    expectedRepairs: number;
    forbiddenRepairs: number;
    expectedHypotheses: number;
  };
  targetCheck: {
    cases: QualityCase[];
    /** Fixtures whose expected kinds were all raised. */
    recall: number;
    /** Quiet fixtures that raised nothing. */
    quiet: number;
    expectedFlags: number;
    quietFixtures: number;
  };
  stability: { cases: QualityCase[]; agreement: number; total: number };
  domain: { cases: QualityCase[]; correct: number; total: number };
}

function seedEntities(seeds: EntitySeed[], language: string): EntityMemoryState {
  let state = emptyEntityMemory();
  for (const seed of seeds) {
    const repeats = Math.max(1, seed.repeats ?? 1);
    for (let i = 0; i < repeats; i += 1) {
      state = establishEntity(state, {
        canonical: seed.canonical,
        target: seed.target,
        kind: seed.kind ?? "other",
        provenance: seed.provenance,
        now: 1_000 + i,
        language,
      });
    }
  }
  return state;
}

export function runQualityHarness(): QualityReport {
  /* --- Source repair --------------------------------------------------- */
  const sourceCases: QualityCase[] = [];
  let repairSuccess = 0;
  let unnecessaryRepairs = 0;
  let hypothesisSuccess = 0;
  let expectedRepairs = 0;
  let forbiddenRepairs = 0;
  let expectedHypotheses = 0;

  for (const fixture of SOURCE_REPAIR_FIXTURES) {
    const entities = seedEntities(fixture.entities, fixture.language);
    const assessment = assessSource({
      text: fixture.heard,
      language: fixture.language,
      meta: fixture.meta,
      entities,
    });
    const repaired = assessment.text !== fixture.heard;
    let ok: boolean;
    if (fixture.mustNotRepair) {
      forbiddenRepairs += 1;
      ok = !repaired;
      if (repaired) unnecessaryRepairs += 1;
    } else if (fixture.expectHypothesis) {
      expectedHypotheses += 1;
      ok = !repaired && assessment.hypotheses.length > 0;
      if (ok) hypothesisSuccess += 1;
      if (repaired) unnecessaryRepairs += 1;
    } else {
      expectedRepairs += 1;
      ok = assessment.text === fixture.expected;
      if (ok) repairSuccess += 1;
    }
    sourceCases.push({
      id: fixture.id,
      ok,
      detail: `${fixture.heard} → ${assessment.text} [${assessment.band}; ${assessment.signals.join(", ")}]`,
    });
  }

  /* --- Target checks --------------------------------------------------- */
  const targetCases: QualityCase[] = [];
  let recall = 0;
  let quiet = 0;
  let expectedFlags = 0;
  let quietFixtures = 0;
  for (const fixture of TARGET_CHECK_FIXTURES) {
    const entities = seedEntities(fixture.entities ?? [], fixture.pair.source);
    const assessment = assessTarget({
      source: fixture.source,
      targetChunks: fixture.target,
      pair: fixture.pair,
      entities,
    });
    const kinds = new Set(assessment.issues.map((issue) => issue.kind));
    let ok: boolean;
    if (fixture.quiet) {
      quietFixtures += 1;
      ok = assessment.issues.length === 0;
      if (ok) quiet += 1;
    } else {
      expectedFlags += 1;
      ok =
        fixture.expectKinds.every((kind) => kinds.has(kind as never)) &&
        (fixture.expectFixedContains === undefined || assessment.text.includes(fixture.expectFixedContains));
      if (ok) recall += 1;
    }
    targetCases.push({
      id: fixture.id,
      ok,
      detail: `${[...kinds].join(",") || "quiet"}${assessment.changed ? ` → ${assessment.text}` : ""}`,
    });
  }

  /* --- Stability gate -------------------------------------------------- */
  const stabilityCases: QualityCase[] = [];
  let agreement = 0;
  for (const fixture of STABILITY_FIXTURES) {
    const verdict = materiallyDifferent(fixture.current, fixture.proposed, { language: fixture.language });
    const ok = verdict.different === fixture.different;
    if (ok) agreement += 1;
    stabilityCases.push({ id: fixture.id, ok, detail: verdict.reasons.join(",") || "no reason" });
  }

  /* --- Domain classification ------------------------------------------ */
  const domainCases: QualityCase[] = [];
  let correct = 0;
  for (const fixture of DOMAIN_FIXTURES) {
    let state = createContextEngine({ manual: "auto", language: fixture.language });
    for (const unit of fixture.units) {
      state = observe(state, { stableText: unit, language: fixture.language });
    }
    const inference = currentDomain(state);
    const ok =
      inference.domain === fixture.expect && !(fixture.forbid ?? []).includes(inference.domain);
    if (ok) correct += 1;
    domainCases.push({
      id: fixture.id,
      ok,
      detail: `${inference.domain} (${inference.confidence.toFixed(2)}; ${inference.signals.join(",")})`,
    });
  }

  return {
    sourceRepair: {
      cases: sourceCases,
      repairSuccess,
      unnecessaryRepairs,
      hypothesisSuccess,
      expectedRepairs,
      forbiddenRepairs,
      expectedHypotheses,
    },
    targetCheck: { cases: targetCases, recall, quiet, expectedFlags, quietFixtures },
    stability: { cases: stabilityCases, agreement, total: STABILITY_FIXTURES.length },
    domain: { cases: domainCases, correct, total: DOMAIN_FIXTURES.length },
  };
}

export function renderQualityReport(report: QualityReport): string {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);
  const lines = [
    "# Deterministic quality harness",
    "",
    "Model-free parts of the quality path. Provider quality is not measured here.",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Source repair success | ${report.sourceRepair.repairSuccess}/${report.sourceRepair.expectedRepairs} (${pct(report.sourceRepair.repairSuccess, report.sourceRepair.expectedRepairs)}) |`,
    `| Unnecessary repairs | ${report.sourceRepair.unnecessaryRepairs}/${report.sourceRepair.forbiddenRepairs + report.sourceRepair.expectedHypotheses} |`,
    `| Hypotheses where expected | ${report.sourceRepair.hypothesisSuccess}/${report.sourceRepair.expectedHypotheses} |`,
    `| Target-check recall | ${report.targetCheck.recall}/${report.targetCheck.expectedFlags} (${pct(report.targetCheck.recall, report.targetCheck.expectedFlags)}) |`,
    `| Target-check false alarms | ${report.targetCheck.quietFixtures - report.targetCheck.quiet}/${report.targetCheck.quietFixtures} |`,
    `| Stability-gate agreement | ${report.stability.agreement}/${report.stability.total} |`,
    `| Domain classification | ${report.domain.correct}/${report.domain.total} |`,
    "",
    "## Cases",
    "",
  ];
  for (const [group, cases] of [
    ["source", report.sourceRepair.cases],
    ["target", report.targetCheck.cases],
    ["stability", report.stability.cases],
    ["domain", report.domain.cases],
  ] as const) {
    for (const c of cases) lines.push(`- ${c.ok ? "✓" : "✗"} ${group}/${c.id} — ${c.detail}`);
  }
  return lines.join("\n");
}
