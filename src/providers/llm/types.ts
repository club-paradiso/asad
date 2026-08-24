/**
 * Interpretation LLM provider contract.
 *
 * Providers take a system prompt and a user turn and return raw text. Parsing
 * and validation happen once, above this layer, in `src/lib/schema.ts` — so a
 * new vendor never gets to invent its own idea of the output shape.
 */
export type LlmProviderId = "mock" | "openai" | "anthropic";

export interface LlmRequest {
  system: string;
  user: string;
  /** Upper bound on output length; the live path keeps this small. */
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  complete(request: LlmRequest): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
