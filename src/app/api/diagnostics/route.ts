/**
 * GET /api/diagnostics — what this deployment is actually doing.
 *
 * For a deployer, not for the interpreter. Carries configuration, provider
 * health, measured latency and quota state.
 *
 * NEVER exposes secrets. Keys are reported as booleans and nothing else; there
 * is no code path here that can emit a key, a partial key or a fingerprint of
 * one.
 */
import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import { capabilitiesFor, assessFreeTierViability, LIVE_WORKLOAD } from "@/providers/llm/capabilities";
import { llmRouter } from "@/providers/llm";
import { OPEN_WEIGHT } from "@/providers/llm/router";
import { counterStore } from "@/counter/store";
import { COUNTER_LANGUAGES } from "@/counter/languages";
import { QUICK_PHRASES, quickPhraseCoverage } from "@/counter/quick-phrases";
import { hasStrings } from "@/counter/ui-strings";
import { LLM_PROVIDER_IDS } from "@/providers/llm/types";
import { telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTIONAL_MODEL_FIELDS = new Set([
  "GEMINI_LLM_MODEL",
  "GROQ_LLM_MODEL",
  "OPENROUTER_LLM_MODEL",
  "OPENAI_LLM_MODEL",
  "ANTHROPIC_LLM_MODEL",
]);

export async function GET() {
  const env = appEnv();
  const router = llmRouter();
  const plan = router.plan();

  // Vercel can retain an optional variable with an empty-string value. The
  // parser deliberately rejects an empty model id, but for an optional model
  // override an empty value semantically means "use the provider default".
  // Suppress only that deployment-noise case. A non-empty malformed model id
  // still appears as a real configuration error.
  const configProblems = env.problems.filter((problem) => {
    if (!OPTIONAL_MODEL_FIELDS.has(problem.field)) return true;
    return process.env[problem.field]?.trim() !== "";
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),

    stt: {
      provider: env.stt.provider,
      keyConfigured:
        env.stt.provider === "deepgram"
          ? !!env.stt.deepgramKey
          : env.stt.provider === "openai"
            ? !!env.stt.openaiKey
            : true,
      ephemeralKeysAvailable:
        env.stt.provider === "deepgram" ? !!env.stt.deepgramProjectId : true,
      model: env.stt.provider === "deepgram" ? env.stt.deepgramModel : env.stt.openaiModel,
    },

    llm: {
      routingMode: plan.mode,
      privacyMode: plan.privacyMode,
      allowPaidFallback: plan.allowPaidFallback,
      active: plan.active,
      chain: plan.chain,
      warnings: plan.warnings,
      providers: LLM_PROVIDER_IDS.map((id) => {
        const caps = capabilitiesFor(id);
        const health = router.health().find((h) => h.provider === id)!;
        const viability =
          caps.freeTierPossible && id !== "local"
            ? assessFreeTierViability(id, LIVE_WORKLOAD.tokensPerCallFull)
            : undefined;
        return {
          id,
          label: caps.label,
          model: env.llm.providers[id].model,
          // Boolean only. The key itself never leaves the server.
          configured: env.llm.providers[id].configured,
          eligible: health.eligible,
          ineligibleReason: health.ineligibleReason,
          breakerState: health.breaker.state,
          consecutiveFailures: health.breaker.consecutiveFailures,
          lastFailureKind: health.breaker.lastFailure?.kind,
          quota: {
            free: caps.freeTierQuota,
            viableForLiveSermon: viability?.viable,
            detail: viability?.detail,
            requestsThisMinute: health.rateLimit.requestsThisMinute,
            tokensThisMinute: health.rateLimit.tokensThisMinute,
            requestsToday: health.rateLimit.requestsToday,
            pressure: health.rateLimit.pressure.level,
            pressureDetail: health.rateLimit.pressure.detail,
          },
          capabilities: {
            structuredOutput: caps.structuredOutput,
            promptCaching: caps.promptCaching,
            thinkingControl: caps.thinkingControl,
            recommendedLiveContextTokens: caps.recommendedLiveContextTokens,
          },
          privacy: {
            freeTier: caps.freeTierPrivacy,
            paidTier: caps.paidTierPrivacy,
            note: caps.privacyNote,
          },
          verifiedAt: caps.verifiedAt,
        };
      }),
    },

    counter: (() => {
      const openWeight = router.matching(OPEN_WEIGHT);
      return {
        // Live counts only — never a code, a language pair or a word of text.
        sessions: counterStore().stats(),
        preferOpenWeightModels: env.llm.counterPreferOpen,
        openWeightProviders: openWeight,
        // The honest headline: the preference is set but nothing satisfies it.
        openWeightAvailable: openWeight.length > 0,
        translationProvider: router.preferred(
          env.llm.counterPreferOpen ? OPEN_WEIGHT : undefined,
        ),
        languages: COUNTER_LANGUAGES.length,
        quickPhrases: QUICK_PHRASES.length,
        // Where a visitor gets the full experience, and where they get
        // English chrome and model-translated phrases instead.
        coverage: COUNTER_LANGUAGES.map((language) => ({
          code: language.code,
          label: language.en,
          quickPhrases: Math.round(quickPhraseCoverage(language.code) * 100),
          interfaceTranslated: hasStrings(language.code),
          speechInput: language.speechSupported,
        })),
        // Stated, not discovered in front of a visitor. See docs/counter-mode.md.
        storeLimitation:
          "Sessions live in the memory of one process. Multi-instance or serverless deployments will lose them between requests.",
      };
    })(),

    bible: {
      provider: env.bible.provider,
      translation: env.bible.translation,
      textAvailable: env.bible.provider !== "reference-only",
    },

    workload: LIVE_WORKLOAD,
    telemetry: telemetry.snapshot(),
    configProblems,
  });
}

export type DiagnosticsPayload = Awaited<ReturnType<typeof GET>> extends NextResponse<infer T>
  ? T
  : never;
