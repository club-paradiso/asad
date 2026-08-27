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
import { counterStore, counterStoreInfo } from "@/counter/store";
import { COUNTER_LANGUAGES } from "@/counter/languages";
import { QUICK_PHRASES, quickPhraseCoverage } from "@/counter/quick-phrases";
import { hasStrings } from "@/counter/ui-strings";
import { LLM_PROVIDER_IDS } from "@/providers/llm/types";
import { telemetry } from "@/lib/telemetry";
import { capabilitiesForModel, liveSuitabilityProblem } from "@/providers/llm/models";
import { describePolicy } from "@/providers/llm/openrouter";
import { RATE_RULES, sessionEnforcement } from "@/lib/guard";

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
  const store = counterStore();
  const [counterSessions] = await Promise.all([store.stats()]);
  const storage = counterStoreInfo();

  // Vercel can retain an optional variable with an empty-string value. The
  // parser deliberately rejects an empty model id, but for an optional model
  // override an empty value semantically means "use the provider default".
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

      // The gateway's own configuration. Reported whether or not OpenRouter is
      // currently serving turns: a deployer needs to see the policy they set,
      // not only the policy that happens to be in use.
      openrouter: (() => {
        const { openrouter } = env.llm;
        const caps = capabilitiesForModel(openrouter.primaryModel);
        return {
          primaryModel: openrouter.primaryModel,
          qualityModel: openrouter.qualityEscalation ? openrouter.qualityModel : null,
          qualityEscalation: openrouter.qualityEscalation,
          policy: {
            sort: openrouter.policy.sort,
            dataCollection: openrouter.policy.dataCollection,
            zdr: openrouter.policy.zdr,
            allowFallbacks: openrouter.policy.allowFallbacks,
            requireParameters: openrouter.policy.requireParameters,
            only: openrouter.policy.only ?? null,
            ignore: openrouter.policy.ignore ?? null,
            summary: describePolicy(openrouter.policy),
          },
          // What the request builder will actually emit for this model.
          modelCapabilities: {
            family: caps.family,
            structuredOutput: caps.structuredOutput,
            sampling: caps.sampling,
            reasoning: caps.reasoning,
            maxOutputTokens: caps.maxOutputTokens,
            latencyClass: caps.latencyClass,
            liveSuitable: caps.liveSuitable,
            liveWarning: liveSuitabilityProblem(caps),
            promptCaching: caps.promptCaching,
            source: caps.source,
          },
        };
      })(),
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
        sessions: counterSessions,
        storage: {
          kind: store.kind,
          shared: store.shared,
          configured: storage.configured,
          source: storage.source,
          warning: storage.warning,
        },
        preferOpenWeightModels: env.llm.counterPreferOpen,
        openWeightProviders: openWeight,
        openWeightAvailable: openWeight.length > 0,
        // What a counter turn would actually reach. The open-weight setting
        // reorders the chain; it never empties it.
        translationProvider: router.wouldReach(
          env.llm.counterPreferOpen ? OPEN_WEIGHT : undefined,
        ),
        languages: COUNTER_LANGUAGES.length,
        quickPhrases: QUICK_PHRASES.length,
        coverage: COUNTER_LANGUAGES.map((language) => ({
          code: language.code,
          label: language.en,
          quickPhrases: Math.round(quickPhraseCoverage(language.code) * 100),
          interfaceTranslated: hasStrings(language.code),
          speechInput: language.speechSupported,
        })),
        storeLimitation: store.shared
          ? null
          : "Sessions live in the memory of one process. Configure Upstash Redis for reliable multi-instance/serverless Counter Mode.",
      };
    })(),

    bible: {
      provider: env.bible.provider,
      translation: env.bible.translation,
      textAvailable: env.bible.provider !== "reference-only",
    },

    // What stands between a public URL and the deployer's provider balance.
    // The per-instance caveat is stated here rather than implied, because a
    // limit that claims to be global and is not is worse than no limit.
    protection: {
      accessGate: env.access.enabled,
      // "enforced" needs a secret that is identical on every instance. Without
      // one, session tokens key rate limits but cannot refuse a request — see
      // sessionEnforcement in src/lib/guard.ts.
      sessionEnforcement: sessionEnforcement(),
      rateLimits: RATE_RULES,
      scope: "per-instance",
      note: "Rate limits are held in the memory of one server instance. On a multi-instance or serverless deployment the effective ceiling is the limit multiplied by the number of warm instances. For a hard global ceiling, set a spend limit on the provider key.",
    },

    workload: LIVE_WORKLOAD,
    telemetry: telemetry.snapshot(),
    configProblems,
  });
}

export type DiagnosticsPayload = Awaited<ReturnType<typeof GET>> extends NextResponse<infer T>
  ? T
  : never;
