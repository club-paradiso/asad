/**
 * Provider capability and quota registry.
 *
 * One table, not a scattering of `if (provider === "groq")` checks. The router,
 * the context budgeter and the diagnostics page all read from here.
 *
 * IMPORTANT — every figure below was verified against provider documentation on
 * the `verifiedAt` date. Free-tier limits and data-use policies change without
 * notice; re-verify before trusting these in a deployment. Nothing in the
 * application's *logic* depends on the exact numbers being current: they feed
 * warnings, routing preference and documentation, not correctness.
 */
import type { LlmProviderId } from "./types";

export type PrivacyPosture =
  /** Provider states it does not train on submitted content on this tier. */
  | "no-training"
  /** Provider may use submitted content to improve its products. */
  | "may-train"
  /** Depends on downstream routing / account settings — not knowable up front. */
  | "varies"
  /** Nothing leaves the machine. */
  | "local";

export interface FreeTierQuota {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  requestsPerDay?: number;
}

export interface LlmProviderCapabilities {
  id: LlmProviderId;
  label: string;
  /** Native JSON-schema enforcement, as opposed to "please emit JSON". */
  structuredOutput: boolean;
  streaming: boolean;
  promptCaching: boolean;
  freeTierPossible: boolean;
  /** Whether we have documented quota numbers for the free tier. */
  rateLimitsKnown: boolean;
  /** Whether the provider returns usage counts we can record. */
  usageTelemetry: boolean;
  /** Whether the provider exposes rate-limit headers we can read. */
  rateLimitHeaders: boolean;
  maxContextTokens?: number;
  /** What we are willing to spend per live turn on this provider. */
  recommendedLiveContextTokens?: number;
  freeTierQuota?: FreeTierQuota;
  /** Data-use posture on the FREE tier specifically. */
  freeTierPrivacy: PrivacyPosture;
  /** Data-use posture when paying. */
  paidTierPrivacy: PrivacyPosture;
  /** One line for the diagnostics page and the privacy disclosure. */
  privacyNote: string;
  /** Whether extended reasoning can be turned down for live use. */
  thinkingControl: boolean;
  docsUrl: string;
  verifiedAt: string;
}

/**
 * Live workload reference point, used to judge quota viability.
 *
 * Measured from Phase 1: roughly one interpretation call every 8 seconds of
 * speech, ~1,700 input + ~180 output tokens per call at the FULL context
 * profile. A 45-minute service is therefore ~340 calls and ~640k tokens.
 */
export const LIVE_WORKLOAD = {
  callsPerMinute: 7.5,
  tokensPerCallFull: 1900,
  tokensPerCallCompact: 1100,
  tokensPerCallUltraCompact: 600,
  sermonMinutes: 45,
} as const;

export const PROVIDER_CAPABILITIES: Record<LlmProviderId, LlmProviderCapabilities> = {
  local: {
    id: "local",
    label: "Local interpreter",
    structuredOutput: true,
    streaming: false,
    promptCaching: false,
    freeTierPossible: true,
    rateLimitsKnown: true,
    usageTelemetry: false,
    rateLimitHeaders: false,
    freeTierPrivacy: "local",
    paidTierPrivacy: "local",
    privacyNote: "Runs in this process. Nothing is sent anywhere.",
    thinkingControl: false,
    docsUrl: "",
    verifiedAt: "2026-08-24",
  },

  gemini: {
    id: "gemini",
    label: "Google Gemini",
    structuredOutput: true, // responseSchema / responseJsonSchema
    streaming: true,
    promptCaching: true, // implicit caching on Flash-class models
    freeTierPossible: true,
    rateLimitsKnown: true,
    usageTelemetry: true, // usageMetadata
    rateLimitHeaders: false, // quota surfaced via 429 body, not headers
    maxContextTokens: 1_000_000,
    recommendedLiveContextTokens: 4000,
    freeTierQuota: { requestsPerMinute: 15, tokensPerMinute: 250_000, requestsPerDay: 1000 },
    freeTierPrivacy: "may-train",
    paidTierPrivacy: "no-training",
    privacyNote:
      "Free tier: prompts and responses may be used to improve Google products, including human review. Paid tier: not used for training.",
    thinkingControl: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
    verifiedAt: "2026-08-24",
  },

  groq: {
    id: "groq",
    label: "Groq",
    structuredOutput: true, // OpenAI-compatible json_schema
    streaming: true,
    promptCaching: false,
    freeTierPossible: true,
    rateLimitsKnown: true,
    usageTelemetry: true,
    rateLimitHeaders: true, // x-ratelimit-* on every response
    maxContextTokens: 131_072,
    // The binding constraint is 6k TPM, not context length: at ~7.5 calls/min
    // anything above ~800 tokens per call exceeds the free tier.
    recommendedLiveContextTokens: 800,
    freeTierQuota: { requestsPerMinute: 30, tokensPerMinute: 6000, requestsPerDay: 14_400 },
    freeTierPrivacy: "no-training",
    paidTierPrivacy: "no-training",
    privacyNote:
      "Does not train on inputs or outputs on either tier. Short abuse/reliability logs, with zero-data-retention available in Data Controls.",
    thinkingControl: true, // reasoning_effort on gpt-oss models
    docsUrl: "https://console.groq.com/docs/rate-limits",
    verifiedAt: "2026-08-24",
  },

  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    structuredOutput: true, // depends on the routed model
    streaming: true,
    promptCaching: false,
    freeTierPossible: true,
    rateLimitsKnown: true,
    usageTelemetry: true,
    rateLimitHeaders: true,
    maxContextTokens: 131_072,
    recommendedLiveContextTokens: 2000,
    // 50/day on an unfunded account is the number that matters: a 45-minute
    // sermon needs ~340 calls, so it exhausts in roughly seven minutes.
    freeTierQuota: { requestsPerMinute: 20, requestsPerDay: 50 },
    freeTierPrivacy: "varies",
    paidTierPrivacy: "varies",
    privacyNote:
      "OpenRouter does not store prompts by default, but forwards them to whichever provider it routes to, whose own policy then applies. Account settings control whether training-capable providers may be used.",
    thinkingControl: false,
    docsUrl: "https://openrouter.ai/docs/api-reference/limits",
    verifiedAt: "2026-08-24",
  },

  openai: {
    id: "openai",
    label: "OpenAI",
    structuredOutput: true,
    streaming: true,
    promptCaching: true,
    freeTierPossible: false,
    rateLimitsKnown: true,
    usageTelemetry: true,
    rateLimitHeaders: true,
    maxContextTokens: 128_000,
    recommendedLiveContextTokens: 4000,
    freeTierPrivacy: "no-training",
    paidTierPrivacy: "no-training",
    privacyNote:
      "API data is not used for training by default. Limited abuse-monitoring retention; zero-retention available to eligible accounts.",
    thinkingControl: false,
    docsUrl: "https://platform.openai.com/docs/guides/rate-limits",
    verifiedAt: "2026-08-24",
  },

  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    structuredOutput: false, // no server-side JSON schema enforcement; prefill instead
    streaming: true,
    promptCaching: true,
    freeTierPossible: false,
    rateLimitsKnown: true,
    usageTelemetry: true,
    rateLimitHeaders: true,
    maxContextTokens: 200_000,
    recommendedLiveContextTokens: 4000,
    freeTierPrivacy: "no-training",
    paidTierPrivacy: "no-training",
    privacyNote:
      "API data is not used for training by default, with a limited abuse-monitoring window.",
    thinkingControl: true,
    docsUrl: "https://docs.anthropic.com/en/api/rate-limits",
    verifiedAt: "2026-08-24",
  },
};

export const capabilitiesFor = (id: LlmProviderId): LlmProviderCapabilities =>
  PROVIDER_CAPABILITIES[id];

/** Providers whose free tier may use submitted content to improve products. */
export const trainsOnFreeTier = (id: LlmProviderId): boolean =>
  PROVIDER_CAPABILITIES[id].freeTierPrivacy === "may-train" ||
  PROVIDER_CAPABILITIES[id].freeTierPrivacy === "varies";

export interface QuotaVerdict {
  viable: boolean;
  /** Which limit binds first, if any. */
  bindingLimit?: "rpm" | "tpm" | "rpd";
  /** Minutes of continuous interpretation before the daily cap is hit. */
  sustainedMinutes?: number;
  detail: string;
}

/**
 * Can this provider actually sustain a live sermon on its free tier?
 *
 * "Technically $0" and "survives 45 minutes of continuous speech" are very
 * different claims, and the difference is the whole point of this function.
 */
export function assessFreeTierViability(
  id: LlmProviderId,
  tokensPerCall: number = LIVE_WORKLOAD.tokensPerCallFull,
): QuotaVerdict {
  const caps = PROVIDER_CAPABILITIES[id];
  if (caps.freeTierPrivacy === "local") {
    return { viable: true, detail: "Local interpreter — no quota." };
  }
  const quota = caps.freeTierQuota;
  if (!quota) {
    return { viable: false, detail: "No free tier." };
  }

  const callsPerMinute = LIVE_WORKLOAD.callsPerMinute;
  const tokensPerMinute = callsPerMinute * tokensPerCall;

  if (quota.requestsPerMinute !== undefined && callsPerMinute > quota.requestsPerMinute) {
    return {
      viable: false,
      bindingLimit: "rpm",
      detail: `Needs ~${callsPerMinute} req/min, limit is ${quota.requestsPerMinute}.`,
    };
  }

  if (quota.tokensPerMinute !== undefined && tokensPerMinute > quota.tokensPerMinute) {
    const ratio = (tokensPerMinute / quota.tokensPerMinute).toFixed(1);
    return {
      viable: false,
      bindingLimit: "tpm",
      detail: `Needs ~${Math.round(tokensPerMinute).toLocaleString()} tokens/min at ${tokensPerCall} per call, limit is ${quota.tokensPerMinute.toLocaleString()} — ${ratio}× over.`,
    };
  }

  if (quota.requestsPerDay !== undefined) {
    const minutes = quota.requestsPerDay / callsPerMinute;
    if (minutes < LIVE_WORKLOAD.sermonMinutes) {
      return {
        viable: false,
        bindingLimit: "rpd",
        sustainedMinutes: Math.round(minutes),
        detail: `Daily cap of ${quota.requestsPerDay} requests lasts ~${Math.round(minutes)} min of continuous speech; a sermon needs ${LIVE_WORKLOAD.sermonMinutes}.`,
      };
    }
    return {
      viable: true,
      sustainedMinutes: Math.round(minutes),
      detail: `~${Math.round(minutes)} min/day of continuous interpretation (~${(minutes / LIVE_WORKLOAD.sermonMinutes).toFixed(1)} sermons).`,
    };
  }

  return { viable: true, detail: "Within documented free-tier limits." };
}
