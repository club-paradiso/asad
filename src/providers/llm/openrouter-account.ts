import { LIVE_WORKLOAD } from "./capabilities";

/** OpenRouter's documented free-model request ceilings as of 2026-09-10. */
export const OPENROUTER_FREE_MODEL_RPD = {
  unfunded: 50,
  funded10: 1000,
} as const;

export const OPENROUTER_FUNDING_THRESHOLD_USD = 10;

export interface OpenRouterAccountStatus {
  ok: boolean;
  /** True means OpenRouter reports this key as belonging to the free tier. */
  isFreeTier?: boolean;
  /** Calls the measured ASAD workload needs for one 45-minute service. */
  estimatedCallsPerService: number;
  /** Daily free-model cap for an account that has not purchased >= $10 credits. */
  unfundedMinutes: number;
  /** Daily free-model cap after >= $10 credits have been purchased. */
  fundedMinutes: number;
  /**
   * The documented free-model daily allowance implied by the reported tier.
   * This is intentionally derived from current OpenRouter documentation, not
   * from data.rate_limit: that API field is deprecated and explicitly safe to
   * ignore.
   */
  documentedDailyAllowance?: number;
  /** Approximate continuous ASAD minutes available at that documented floor. */
  documentedMinutesAvailable?: number;
  /** Whether that documented allowance covers one measured 45-minute service. */
  canSustainOneService?: boolean;
  error?: string;
}

interface CurrentKeyResponse {
  data?: {
    is_free_tier?: boolean;
  };
}

const baseStatus = (): Pick<
  OpenRouterAccountStatus,
  "estimatedCallsPerService" | "unfundedMinutes" | "fundedMinutes"
> => ({
  estimatedCallsPerService: Math.ceil(LIVE_WORKLOAD.callsPerMinute * LIVE_WORKLOAD.sermonMinutes),
  unfundedMinutes: Math.round(OPENROUTER_FREE_MODEL_RPD.unfunded / LIVE_WORKLOAD.callsPerMinute),
  fundedMinutes: Math.round(OPENROUTER_FREE_MODEL_RPD.funded10 / LIVE_WORKLOAD.callsPerMinute),
});

/**
 * Read only non-secret account metadata for diagnostics.
 *
 * The API key never leaves the Authorization header and no label, creator id,
 * spend amount or key fingerprint is returned to callers. OpenRouter's
 * `data.rate_limit` object is deliberately ignored: the current API reference
 * marks it deprecated and safe to ignore, so values such as requests=-1 must
 * never be presented as real account capacity.
 *
 * Failure is soft: health can still probe inference even if this metadata
 * endpoint is down.
 */
export async function inspectOpenRouterAccount(
  apiKey: string,
  options: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<OpenRouterAccountStatus> {
  const common = baseStatus();
  try {
    const response = await fetch(
      `${(options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/key`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: options.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return { ...common, ok: false, error: `OpenRouter account check failed (${response.status}).` };
    }

    const json = (await response.json()) as CurrentKeyResponse;
    const data = json.data;
    if (!data || typeof data.is_free_tier !== "boolean") {
      return { ...common, ok: false, error: "OpenRouter account response was missing tier metadata." };
    }

    const documentedDailyAllowance = data.is_free_tier
      ? OPENROUTER_FREE_MODEL_RPD.unfunded
      : OPENROUTER_FREE_MODEL_RPD.funded10;
    const documentedMinutesAvailable = Math.round(
      documentedDailyAllowance / LIVE_WORKLOAD.callsPerMinute,
    );

    return {
      ...common,
      ok: true,
      isFreeTier: data.is_free_tier,
      documentedDailyAllowance,
      documentedMinutesAvailable,
      canSustainOneService: documentedMinutesAvailable >= LIVE_WORKLOAD.sermonMinutes,
    };
  } catch {
    return { ...common, ok: false, error: "OpenRouter account check could not be reached." };
  }
}
