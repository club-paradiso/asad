/**
 * Interpretation LLM provider contract.
 *
 * Providers take a system prompt and a user turn and return raw text plus
 * whatever metadata they were willing to tell us. Parsing and validation happen
 * once, above this layer, in `src/lib/schema.ts` — so a new vendor never gets to
 * invent its own idea of the output shape.
 */
import type { LlmFailureKind } from "./errors";

/**
 * Known providers.
 *
 * `local` is the deterministic in-process interpreter. Phase 1 called it
 * `mock`; that spelling is still accepted in configuration for backwards
 * compatibility and is normalised here.
 */
export type LlmProviderId =
  | "local"
  | "gemini"
  | "groq"
  | "openrouter"
  | "openai"
  | "anthropic";

export const LLM_PROVIDER_IDS: readonly LlmProviderId[] = [
  "local",
  "gemini",
  "groq",
  "openrouter",
  "openai",
  "anthropic",
] as const;

export const isLlmProviderId = (value: string): value is LlmProviderId =>
  (LLM_PROVIDER_IDS as readonly string[]).includes(value);

/** Accepts the Phase 1 `mock` spelling. */
export function normaliseProviderId(value: string): LlmProviderId | null {
  const id = value.trim().toLowerCase();
  if (id === "mock") return "local";
  return isLlmProviderId(id) ? id : null;
}

/** How hard the provider should think. Live interpretation wants "none". */
export type ThinkingLevel = "none" | "low" | "medium";

export interface LlmRequest {
  system: string;
  user: string;
  /** Upper bound on output length; the live path keeps this small. */
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * JSON Schema the provider should enforce natively, where it can. Zod still
   * validates the result afterwards — provider JSON mode is not a trust
   * boundary.
   */
  jsonSchema?: Record<string, unknown>;
  /** Extended reasoning control, where the provider exposes it. */
  thinking?: ThinkingLevel;
}

/** What a provider tells us about the call it just made. */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /**
   * Input tokens served from the provider's prompt cache.
   *
   * Worth carrying because of what the workload measurement found: the system
   * prompt is ~70% of every live call and never changes within a session. This
   * is the number that says whether that 70% is being re-billed every turn or
   * served from cache — and without it, "should we implement caching?" cannot
   * be answered with anything but a guess.
   */
  cachedInputTokens?: number;
}

/** Rate-limit state scraped from response headers, where available. */
export interface RateLimitSnapshot {
  requestsRemaining?: number;
  tokensRemaining?: number;
  /** Epoch ms when the window resets. */
  resetAt?: number;
  observedAt: number;
}

export interface LlmResponse {
  /** Raw text. Parsing and validation happen above this layer. */
  text: string;
  usage?: LlmUsage;
  rateLimit?: RateLimitSnapshot;
  /** Model actually used — OpenRouter may route elsewhere than requested. */
  model?: string;
  /** ms from request dispatch to complete response. */
  latencyMs: number;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  /** The model id this instance was configured with. */
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type { LlmFailureKind };
export { LlmError } from "./errors";
