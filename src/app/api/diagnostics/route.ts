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
import { LLM_PROVIDER_IDS } from "@/providers/llm/types";
import { telemetry } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = appEnv();
  const router = llmRouter();
  const plan = router.plan();

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

    bible: {
      provider: env.bible.provider,
      translation: env.bible.translation,
      textAvailable: env.bible.provider !== "reference-only",
    },

    workload: LIVE_WORKLOAD,
    telemetry: telemetry.snapshot(),
    configProblems: env.problems,
  });
}

export type DiagnosticsPayload = Awaited<ReturnType<typeof GET>> extends NextResponse<infer T>
  ? T
  : never;
