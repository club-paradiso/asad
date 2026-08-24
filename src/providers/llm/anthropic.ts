/**
 * Anthropic adapter.
 *
 * The Messages API has no server-side JSON-schema enforcement, so structure is
 * obtained by prefilling the assistant turn with `{`. That is the cheapest
 * reliable way to stop a model prefacing structured output with a sentence of
 * explanation. The leading brace is restored before the response leaves here.
 */
import { LlmError } from "./errors";
import { postJson } from "./http";
import type { LlmProvider, LlmRequest, LlmResponse, LlmUsage } from "./types";

interface AnthropicBlock {
  type?: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicBlock[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly model: string;

  constructor(private readonly config: AnthropicConfig) {
    this.model = config.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: request.maxOutputTokens ?? 700,
      temperature: request.temperature ?? 0.2,
      system: request.system,
      messages: [
        { role: "user", content: request.user },
        { role: "assistant", content: "{" },
      ],
    };

    // Live interpretation never wants extended thinking.
    if (request.thinking && request.thinking !== "none") {
      body.thinking = { type: "enabled", budget_tokens: 1024 };
    }

    const base = (this.config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
    const { json, rateLimit, latencyMs } = await postJson({
      url: `${base}/messages`,
      body,
      headers: {
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      timeoutMs: request.signal ? 30_000 : 10_000,
      signal: request.signal,
      label: "Anthropic",
    });

    const data = json as AnthropicResponse;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      throw new LlmError(
        `Anthropic returned no content${data.error?.message ? `: ${data.error.message}` : ""}.`,
        "malformed_output",
      );
    }

    return {
      // Restore the prefilled brace.
      text: text.trimStart().startsWith("{") ? text : `{${text}`,
      model: data.model ?? this.config.model,
      usage: mapUsage(data.usage),
      rateLimit,
      latencyMs,
    };
  }
}

const mapUsage = (usage: AnthropicResponse["usage"]): LlmUsage | undefined =>
  usage
    ? {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      }
    : undefined;
