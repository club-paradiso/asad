import { toLlmError, type LlmFailureKind } from "./errors";
import { capabilitiesForModel, type ModelCapabilities } from "./models";
import {
  OpenRouterLlmProvider,
  type OpenRouterConfig,
  type OpenRouterTurnDetail,
} from "./openrouter";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

/**
 * Known-zero-cost recovery floor for an explicitly free OpenRouter primary.
 *
 * The first fallback is a concrete open-weight model so terminology stays as
 * stable as possible. The final fallback is OpenRouter's zero-cost free-model
 * router, which filters its pool to models that can satisfy the request.
 *
 * Never attach this chain to a paid-capable primary. The public-deployment
 * security exception depends on the guarantee that an outage cannot turn into
 * a bill.
 */
export const OPENROUTER_FREE_MODEL_FALLBACKS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openrouter/free",
] as const;

/** Return only zero-cost fallbacks, and never repeat the configured primary. */
export function freeOpenRouterFallbackModels(primaryModel: string): readonly string[] {
  if (!primaryModel.endsWith(":free") && primaryModel !== "openrouter/free") return [];
  return OPENROUTER_FREE_MODEL_FALLBACKS.filter((model) => model !== primaryModel);
}

/**
 * Failures for which another model can legitimately help.
 *
 * Authentication and account-wide quota exhaustion are deliberately excluded:
 * another model uses the same key and cannot repair either. A caller-aborted
 * timeout is also excluded in `complete()` because the answer is already late.
 */
const MODEL_RECOVERABLE: ReadonlySet<LlmFailureKind> = new Set([
  "rate_limited",
  "server_error",
  "network",
  "bad_request",
  "request_rejected",
  "malformed_output",
  "unknown",
]);

export class FailoverOpenRouterLlmProvider implements LlmProvider {
  readonly id = "openrouter" as const;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  lastTurn?: OpenRouterTurnDetail;
  /** Configured/requested model that ultimately answered this turn. */
  lastModel?: string;

  private readonly models: readonly string[];

  constructor(
    private readonly config: OpenRouterConfig,
    fallbackModels: readonly string[] = [],
  ) {
    this.model = config.model;
    this.capabilities = capabilitiesForModel(config.model);
    this.models = [
      config.model,
      ...fallbackModels.filter((model, index, all) =>
        model !== config.model && all.indexOf(model) === index),
    ];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let lastError: unknown;

    for (let index = 0; index < this.models.length; index += 1) {
      const model = this.models[index]!;
      const provider = new OpenRouterLlmProvider({ ...this.config, model });

      try {
        const response = await provider.complete(request);
        this.lastTurn = provider.lastTurn;
        this.lastModel = model;
        return response;
      } catch (error) {
        lastError = error;
        const failure = toLlmError(error);
        const hasNext = index + 1 < this.models.length;

        if (
          !hasNext ||
          request.signal?.aborted ||
          !MODEL_RECOVERABLE.has(failure.kind)
        ) {
          throw error;
        }
      }
    }

    // The loop always either returns or throws, but keep the contract explicit
    // if the model list is ever refactored into something dynamic.
    throw lastError ?? new Error("OpenRouter model failover exhausted without an attempt.");
  }
}
