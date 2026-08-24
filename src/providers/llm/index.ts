/**
 * LLM provider factory. Server-side only — API keys never reach the browser.
 */
import "server-only";
import { AnthropicLlmProvider } from "./anthropic";
import { MockLlmProvider } from "./mock";
import { OpenAiLlmProvider } from "./openai";
import type { LlmProvider, LlmProviderId } from "./types";

export * from "./types";

const isProviderId = (value: string): value is LlmProviderId =>
  value === "mock" || value === "openai" || value === "anthropic";

/**
 * Resolve the configured provider.
 *
 * Falls back to the deterministic local interpreter whenever the requested
 * vendor has no key — a misconfigured deployment degrades to Korean-transcript
 * plus rule-based assistance, it does not 500 in the middle of a service.
 */
export function resolveLlmProvider(): { provider: LlmProvider; degraded: boolean; reason?: string } {
  const requested = (process.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  const key = process.env.LLM_API_KEY?.trim();

  if (!isProviderId(requested)) {
    return {
      provider: new MockLlmProvider(),
      degraded: true,
      reason: `Unknown LLM_PROVIDER "${requested}" — using the local interpreter.`,
    };
  }

  if (requested === "mock") return { provider: new MockLlmProvider(), degraded: false };

  if (!key) {
    return {
      provider: new MockLlmProvider(),
      degraded: true,
      reason: `LLM_PROVIDER is "${requested}" but LLM_API_KEY is not set — using the local interpreter.`,
    };
  }

  if (requested === "openai") {
    return {
      provider: new OpenAiLlmProvider(key, process.env.OPENAI_LLM_MODEL || undefined),
      degraded: false,
    };
  }

  return {
    provider: new AnthropicLlmProvider(key, process.env.ANTHROPIC_LLM_MODEL || undefined),
    degraded: false,
  };
}
