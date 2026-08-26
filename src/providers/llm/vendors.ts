/**
 * Vendor configuration for the OpenAI-compatible providers.
 *
 * Groq, OpenRouter and OpenAI differ by base URL, default model, structured
 * output support and a couple of headers. That is genuinely all — so it lives
 * here as data rather than as three classes.
 *
 * Model ids are DEFAULTS ONLY and every one is overrideable by environment
 * variable. Models get deprecated on their own schedule; that must never
 * require a code change.
 */
import { OpenAiCompatibleLlmProvider, type StructuredOutputMode } from "./openai-compatible";
import type { LlmProviderId } from "./types";

export interface VendorSpec {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  structuredOutput: StructuredOutputMode;
  reasoningField?: "reasoning_effort";
  /** Extra headers this vendor wants. */
  headers?: Record<string, string>;
}

export const OPENAI_COMPATIBLE_VENDORS: Record<
  "groq" | "openrouter" | "openai",
  VendorSpec
> = {
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    // Verified 2026-08-24. Fast, and Groq does not train on inputs — but the
    // free tier's 6k TPM is the binding constraint, not the model.
    defaultModel: "openai/gpt-oss-120b",
    structuredOutput: "json_schema",
    reasoningField: "reasoning_effort",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    // OpenRouter's free router selects from the currently available free model
    // pool and filters by required capabilities such as structured output. That
    // makes the integration resilient to individual free-model deprecations
    // instead of pinning the app to one model that may disappear underneath it.
    // Deployers can still pin any OpenRouter model with OPENROUTER_LLM_MODEL.
    defaultModel: "openrouter/free",
    structuredOutput: "json_schema",
    headers: {
      "HTTP-Referer": "https://github.com/lucanomics/tong-yuck",
      "X-Title": "tong-yuck",
    },
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    structuredOutput: "json_schema",
  },
};

/** Default model ids for the providers that are not OpenAI-compatible. */
export const NATIVE_DEFAULT_MODELS = {
  // Verified 2026-08-24: GA, low-latency, high-throughput oriented, and the
  // only free tier with enough TPM headroom for continuous interpretation.
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-sonnet-5",
} as const;

export function createOpenAiCompatible(
  vendor: VendorSpec,
  apiKey: string,
  model?: string,
): OpenAiCompatibleLlmProvider {
  return new OpenAiCompatibleLlmProvider({
    id: vendor.id,
    label: vendor.label,
    baseUrl: vendor.baseUrl,
    apiKey,
    model: model?.trim() || vendor.defaultModel,
    structuredOutput: vendor.structuredOutput,
    reasoningField: vendor.reasoningField,
    headers: vendor.headers,
  });
}
