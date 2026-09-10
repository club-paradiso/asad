import { LIVE_WORKLOAD } from "./capabilities";

/** OpenRouter's documented free-model request ceilings as of 2026-09-10. */
export const OPENROUTER_FREE_MODEL_RPD = {
  unfunded: 50,
  funded10: 1000,
} as const;

export const OPENROUTER_FUNDING_THRESHOLD_USD = 10;

export interface OpenRouterAccountStatus {
  ok: boolean;
  /** True means the account is definitely on OpenRouter's free tier. */
  isFreeTier?: boolean;
  /** Deprecated provider-reported request limit. Diagnostic only, never routing authority. */
  reportedRequestLimit?: number;
  reportedInterval?: string;
  /** Calls the measured ASAD workload needs for one 45-minute service. */
  estimatedCallsPerService: number;
  /** Fresh daily free-model cap for an unfunded account. */
  unfundedMinutes: number;
  /** Fresh daily free-model cap after >= $10 credits have been purchased. */
  fundedMinutes: number;
  error?: string;
}

interface CurrentKeyResponse {
  data?: {
    is_free_tier?: boolean;
    rate_limit?: {
      requests?: number;
      interval?: string;
    };
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
 * spend amount or key fingerprint is returned to callers. Failure is soft:
 * health can still probe inference even if this metadata endpoint is down.
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

    return {
      ...common,
      ok: true,
      isFreeTier: data.is_free_tier,
      reportedRequestLimit:
        typeof data.rate_limit?.requests === "number" ? data.rate_limit.requests : undefined,
      reportedInterval:
        typeof data.rate_limit?.interval === "string" ? data.rate_limit.interval : undefined,
    };
  } catch {
    return { ...common, ok: false, error: "OpenRouter account check could not be reached." };
  }
}
