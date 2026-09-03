/**
 * Benchmark scoring.
 *
 * Weighted per the Phase 2 brief:
 *
 *   semantic fidelity        30%   (machine-checkable proxies + human review)
 *   interpreter speakability 25%   (deterministic heuristics)
 *   live latency             20%   (measured against the SLO)
 *   structured output        10%   (schema compliance rate)
 *   free-tier sustainability 10%   (quota vs. a real 45-minute sermon)
 *   privacy suitability       5%   (data-use posture on the tier in use)
 *
 * The fidelity component is deliberately a PROXY, not a claim of measuring
 * translation quality: it checks required/forbidden renderings, Scripture
 * normalisation and cultural-note production. Real fidelity needs a human, and
 * the review sheet exists so one can do it.
 *
 * Hard failures short-circuit the score entirely — see `HARD_FAILURES`.
 */
import {
  assessSpeakability,
  type SpeakabilityReport,
} from "@/lib/speakability";
import {
  assessFreeTierViability,
  capabilitiesFor,
} from "@/providers/llm/capabilities";
import { LATENCY_SLO, summarise } from "@/lib/telemetry";
import type { LlmProviderId, LlmUsage } from "@/providers/llm/types";
import type { InterpreterOutput } from "@/types";
import type { BenchCase } from "./dataset";

export const WEIGHTS = {
  fidelity: 0.3,
  speakability: 0.25,
  latency: 0.2,
  schema: 0.1,
  sustainability: 0.1,
  privacy: 0.05,
} as const;

/** Regardless of score, these make a candidate unsuitable. */
export type HardFailure =
  | "invented_scripture"
  | "literal_wordplay"
  | "forbidden_rendering"
  | "schema_broken"
  | "unusable_latency"
  | "anticipation_hazard"
  | "no_output";

export interface CaseResult {
  caseId: string;
  category: string;
  ok: boolean;
  latencyMs: number;
  /** Raw chunks, for the human review sheet. */
  safeChunks: string[];
  anticipatedChunks: string[];
  schemaValid: boolean;
  speakability: SpeakabilityReport;
  fidelity: {
    score: number;
    missingRequired: string[];
    forbiddenHit: string[];
    scriptureMissing: string[];
    culturalMissing: string[];
  };
  hardFailures: HardFailure[];
  /** Provider-reported usage summed across every repeat of this case. */
  usage?: LlmUsage;
  /** Number of repeated requests that returned usage metadata. */
  usageReports?: number;
  error?: string;
}

export interface ProviderScore {
  provider: LlmProviderId;
  model: string;
  tier: "paid" | "free-or-unknown";
  cases: CaseResult[];
  latency: ReturnType<typeof summarise>;
  components: {
    fidelity: number;
    speakability: number;
    latency: number;
    schema: number;
    sustainability: number;
    privacy: number;
  };
  total: number;
  usage: {
    requestsWithUsage: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheHitRate: number | null;
  };
  hardFailures: HardFailure[];
  /** True when hard failures make the candidate unsuitable at any score. */
  disqualified: boolean;
  notes: string[];
}

const lower = (s: string) => s.toLowerCase();

/**
 * Markers that mean "this candidate did not attempt a translation".
 *
 * This check exists because of a real scoring bug caught while validating the
 * harness: the local interpreter's placeholder output scored 100% fidelity on
 * several cases simply by containing none of the forbidden strings. A
 * non-answer trivially avoids every forbidden rendering, so absence of failure
 * must not be counted as success.
 */
const NON_ANSWER = [
  "[no interpretation model configured",
  "korean transcript only]",
];

const isNonAnswer = (chunks: string[]): boolean =>
  chunks.length === 0 ||
  chunks.every((chunk) =>
    NON_ANSWER.some((marker) => lower(chunk).includes(marker)),
  );

/** Score one case against its expectations. */
export function scoreCase(
  benchCase: BenchCase,
  output: InterpreterOutput | null,
  latencyMs: number,
  error?: string,
): CaseResult {
  const safeChunks = output?.safeChunks.map((c) => c.text) ?? [];
  const anticipated = output?.anticipatedChunks?.map((c) => c.text) ?? [];
  const joined = lower([...safeChunks, ...anticipated].join(" "));
  const hardFailures: HardFailure[] = [];

  if (!output) {
    return {
      caseId: benchCase.id,
      category: benchCase.category,
      ok: false,
      latencyMs,
      safeChunks: [],
      anticipatedChunks: [],
      schemaValid: false,
      speakability: assessSpeakability([]),
      fidelity: {
        score: 0,
        missingRequired: benchCase.expect.required ?? [],
        forbiddenHit: [],
        scriptureMissing: benchCase.expect.scripture ?? [],
        culturalMissing: benchCase.expect.culturalKinds ?? [],
      },
      hardFailures: [error ? "schema_broken" : "no_output"],
      error,
    };
  }

  /* --- Non-answer guard -------------------------------------------------- */
  // A candidate that declined to translate scores zero on fidelity, not full
  // marks for avoiding the forbidden renderings it never had a chance to emit.
  if (isNonAnswer(safeChunks)) {
    return {
      caseId: benchCase.id,
      category: benchCase.category,
      ok: false,
      latencyMs,
      safeChunks,
      anticipatedChunks: anticipated,
      schemaValid: true,
      speakability: assessSpeakability([]),
      fidelity: {
        score: 0,
        missingRequired: benchCase.expect.required ?? [],
        forbiddenHit: [],
        scriptureMissing: benchCase.expect.scripture ?? [],
        culturalMissing: benchCase.expect.culturalKinds ?? [],
      },
      hardFailures: ["no_output"],
    };
  }

  /* --- Fidelity proxies -------------------------------------------------- */
  const missingRequired = (benchCase.expect.required ?? []).filter(
    (needle) => !joined.includes(lower(needle)),
  );
  const forbiddenHit = (benchCase.expect.forbidden ?? []).filter((needle) =>
    joined.includes(lower(needle)),
  );
  const foundScripture = (output.bibleReferences ?? []).map((r) => r.display);
  const scriptureMissing = (benchCase.expect.scripture ?? []).filter(
    (display) => !foundScripture.includes(display),
  );
  const kinds = (output.culturalNotes ?? []).map((n) => n.kind);
  const culturalMissing =
    benchCase.expect.culturalKinds &&
    !benchCase.expect.culturalKinds.some((k) => kinds.includes(k as never))
      ? benchCase.expect.culturalKinds
      : [];

  // A forbidden rendering is always disqualifying — these encode the specific
  // ways this product fails, not stylistic preferences.
  if (forbiddenHit.length > 0) {
    hardFailures.push("forbidden_rendering");
    if (benchCase.category === "wordplay")
      hardFailures.push("literal_wordplay");
    if (
      benchCase.category === "scripture-reference" ||
      benchCase.category === "scripture-paraphrase"
    ) {
      hardFailures.push("invented_scripture");
    }
  }

  if (benchCase.expect.forbidAnticipation && anticipated.length > 0) {
    hardFailures.push("anticipation_hazard");
  }

  const checks = [
    { weight: 2, passed: missingRequired.length === 0 },
    { weight: 3, passed: forbiddenHit.length === 0 },
    { weight: 2, passed: scriptureMissing.length === 0 },
    { weight: 1, passed: culturalMissing.length === 0 },
  ];
  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const fidelityScore =
    checks.reduce((a, c) => a + (c.passed ? c.weight : 0), 0) / totalWeight;

  /* --- Speakability ------------------------------------------------------ */
  const speakability = assessSpeakability(output.safeChunks);
  if (
    benchCase.expect.maxChunks !== undefined &&
    output.safeChunks.length > benchCase.expect.maxChunks
  ) {
    speakability.issues.push({
      code: "too_many_chunks",
      severity: "warning",
      detail: `${output.safeChunks.length} chunks; this case allows ${benchCase.expect.maxChunks}.`,
    });
  }

  if (latencyMs > 8000) hardFailures.push("unusable_latency");

  return {
    caseId: benchCase.id,
    category: benchCase.category,
    ok: hardFailures.length === 0,
    latencyMs,
    safeChunks,
    anticipatedChunks: anticipated,
    schemaValid: true,
    speakability,
    fidelity: {
      score: Number(fidelityScore.toFixed(3)),
      missingRequired,
      forbiddenHit,
      scriptureMissing,
      culturalMissing,
    },
    hardFailures,
  };
}

/** Aggregate case results into a provider score. */
export function scoreProvider(
  provider: LlmProviderId,
  model: string,
  cases: CaseResult[],
  options: { paidTier?: boolean } = {},
): ProviderScore {
  const caps = capabilitiesFor(provider);
  const latency = summarise(
    cases.filter((c) => c.schemaValid).map((c) => c.latencyMs),
  );
  const notes: string[] = [];

  const fidelity = mean(cases.map((c) => c.fidelity.score));
  const speakability = mean(cases.map((c) => c.speakability.score));
  const schema = cases.length
    ? cases.filter((c) => c.schemaValid).length / cases.length
    : 0;

  // Latency scored against the SLO: full marks at or below the p50 target,
  // zero at twice the p95 target.
  const target = LATENCY_SLO.provider_response;
  const latencyScore =
    latency.count === 0
      ? 0
      : clamp01(1 - (latency.p95 - target.p50) / (target.p95 * 2 - target.p50));

  const viability = assessFreeTierViability(provider);
  const sustainability = options.paidTier ? 1 : viability.viable ? 1 : 0.25;
  if (options.paidTier) {
    notes.push(
      "Tier: paid (declared by LLM_PAID_TIER or required by the provider).",
    );
  } else if (!viability.viable) {
    notes.push(`Free-tier quota: ${viability.detail}`);
  } else if (viability.sustainedMinutes) {
    notes.push(
      `Free tier sustains ~${viability.sustainedMinutes} min/day of continuous speech.`,
    );
  }

  const posture = options.paidTier
    ? caps.paidTierPrivacy
    : caps.freeTierPrivacy;
  const privacy =
    posture === "local"
      ? 1
      : posture === "no-training"
        ? 1
        : posture === "varies"
          ? 0.4
          : 0.2;
  if (posture === "may-train" || posture === "varies")
    notes.push(caps.privacyNote);

  const components = {
    fidelity,
    speakability,
    latency: latencyScore,
    schema,
    sustainability,
    privacy,
  };

  const total =
    components.fidelity * WEIGHTS.fidelity +
    components.speakability * WEIGHTS.speakability +
    components.latency * WEIGHTS.latency +
    components.schema * WEIGHTS.schema +
    components.sustainability * WEIGHTS.sustainability +
    components.privacy * WEIGHTS.privacy;

  const hardFailures = [...new Set(cases.flatMap((c) => c.hardFailures))];
  // A single literal wordplay or invented Scripture is disqualifying however
  // good the average looks.
  const disqualifying: HardFailure[] = [
    "literal_wordplay",
    "invented_scripture",
    "schema_broken",
  ];
  const disqualified =
    hardFailures.some((f) => disqualifying.includes(f)) ||
    cases.filter((c) => c.hardFailures.length > 0).length > cases.length * 0.2;

  const usage = cases.reduce(
    (aggregate, benchCase) => {
      if (!benchCase.usage) return aggregate;
      aggregate.requestsWithUsage += benchCase.usageReports ?? 1;
      aggregate.inputTokens += benchCase.usage.inputTokens ?? 0;
      if (benchCase.usage.cachedInputTokens !== undefined) {
        aggregate.cachedInputTokens += benchCase.usage.cachedInputTokens;
        aggregate.cacheMeasuredInputTokens += benchCase.usage.inputTokens ?? 0;
      }
      aggregate.outputTokens += benchCase.usage.outputTokens ?? 0;
      aggregate.totalTokens += benchCase.usage.totalTokens ?? 0;
      return aggregate;
    },
    {
      requestsWithUsage: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheMeasuredInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheHitRate: null as number | null,
    },
  );
  usage.cacheHitRate =
    usage.cacheMeasuredInputTokens > 0
      ? usage.cachedInputTokens / usage.cacheMeasuredInputTokens
      : null;

  const { cacheMeasuredInputTokens: _cacheMeasuredInputTokens, ...publicUsage } = usage;

  return {
    provider,
    model,
    tier: options.paidTier ? "paid" : "free-or-unknown",
    cases,
    latency,
    components,
    total: Number(total.toFixed(4)),
    usage: publicUsage,
    hardFailures,
    disqualified,
    notes,
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
