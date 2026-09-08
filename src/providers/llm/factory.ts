/**
 * One place that knows how to build a provider instance.
 *
 * This used to live in two: the router built providers for live turns, and the
 * benchmark runner built its own copies. They drifted, which is the specific
 * way a benchmark stops being evidence — it measures a request the production
 * path no longer sends. Now both call this.
 */
import { AnthropicLlmProvider } from "./anthropic";
import { GeminiLlmProvider } from "./gemini";
import { LocalLlmProvider } from "./mock";
import { OpenRouterLlmProvider } from "./openrouter";
import {
  FailoverOpenRouterLlmProvider,
  freeOpenRouterFallbackModels,
} from "./openrouter-failover";
import { OPENAI_COMPATIBLE_VENDORS, createOpenAiCompatible } from "./vendors";
import type { LlmProvider, LlmProviderId } from "./types";
import type { AppEnv } from "@/lib/env";

/**
 * Build the provider for `id`, or null when it is not configured.
 *
 * `local` is always available and needs no key.
 */
export function createProvider(id: LlmProviderId, env: AppEnv): LlmProvider | null {
  if (id === "local") return new LocalLlmProvider();

  const config = env.llm.providers[id];
  if (!config.apiKey) return null;

  switch (id) {
    case "gemini":
      return new GeminiLlmProvider({ apiKey: config.apiKey, model: config.model });
    case "anthropic":
      return new AnthropicLlmProvider({ apiKey: config.apiKey, model: config.model });
    case "openrouter": {
      // A concrete :free model can disappear behind a shared upstream 429 even
      // while OpenRouter itself is healthy. Keep the preferred model first,
      // then recover through zero-cost models only. Paid-capable primaries get
      // no implicit model failover here: spending policy remains explicit.
      const fallbackModels = freeOpenRouterFallbackModels(config.model);
      return fallbackModels.length
        ? new FailoverOpenRouterLlmProvider(
            {
              apiKey: config.apiKey,
              model: config.model,
              policy: env.llm.openrouter.policy,
            },
            fallbackModels,
          )
        : new OpenRouterLlmProvider({
            apiKey: config.apiKey,
            model: config.model,
            policy: env.llm.openrouter.policy,
          });
    }
    case "groq":
    case "openai":
      return createOpenAiCompatible(
        OPENAI_COMPATIBLE_VENDORS[id],
        config.apiKey,
        config.model,
      );
  }
}

/**
 * Build the OpenRouter quality-escalation provider, or null.
 *
 * Deliberately separate from `createProvider`: escalation is a different model
 * on the same account, reached only on explicit request, and it must never be
 * something the router can wander into.
 */
export function createQualityProvider(env: AppEnv): OpenRouterLlmProvider | null {
  const { openrouter } = env.llm;
  const config = env.llm.providers.openrouter;
  if (!openrouter.qualityEscalation || !config.apiKey) return null;
  return new OpenRouterLlmProvider({
    apiKey: config.apiKey,
    model: openrouter.qualityModel,
    policy: openrouter.policy,
  });
}
