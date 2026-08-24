/**
 * One adapter for every OpenAI-compatible chat-completions API.
 *
 * Groq, OpenRouter and OpenAI itself all speak the same wire format, so they
 * share this implementation and differ only by configuration. Writing three
 * near-identical clients would mean fixing every bug three times.
 */
import { LlmError } from "./errors";
import { postJson } from "./http";
import type {
  LlmProvider,
  LlmProviderId,
  LlmRequest,
  LlmResponse,
  LlmUsage,
} from "./types";

/** How this vendor wants structured output requested. */
export type StructuredOutputMode =
  /** `response_format: { type: "json_schema", json_schema: {...} }` */
  | "json_schema"
  /** `response_format: { type: "json_object" }` — JSON, but unconstrained. */
  | "json_object"
  /** Nothing supported; rely on the prompt alone. */
  | "none";

export interface OpenAiCompatibleConfig {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  structuredOutput: StructuredOutputMode;
  /** Extra headers, e.g. OpenRouter's attribution pair. */
  headers?: Record<string, string>;
  /**
   * Field used to turn reasoning down. `gpt-oss` models on Groq accept
   * `reasoning_effort`; most others accept nothing.
   */
  reasoningField?: "reasoning_effort";
}

interface ChatChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface ChatResponse {
  choices?: ChatChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly id: LlmProviderId;
  readonly model: string;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.id = config.id;
    this.model = config.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens ?? 700,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    };

    if (request.jsonSchema && this.config.structuredOutput === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "interpreter_output",
          strict: true,
          schema: request.jsonSchema,
        },
      };
    } else if (this.config.structuredOutput !== "none") {
      body.response_format = { type: "json_object" };
    }

    // Live interpretation does not want a model pondering for four seconds.
    if (this.config.reasoningField && request.thinking) {
      body[this.config.reasoningField] = request.thinking === "none" ? "low" : request.thinking;
    }

    const { json, rateLimit, latencyMs } = await postJson({
      url: `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      body,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
      },
      timeoutMs: deadlineFor(request),
      signal: request.signal,
      label: this.config.label,
    });

    const data = json as ChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new LlmError(
        `${this.config.label} returned no content${data.error?.message ? `: ${data.error.message}` : ""}.`,
        "malformed_output",
      );
    }

    return {
      text: content,
      model: data.model ?? this.config.model,
      usage: mapUsage(data.usage),
      rateLimit,
      latencyMs,
    };
  }
}

const mapUsage = (usage: ChatResponse["usage"]): LlmUsage | undefined =>
  usage
    ? {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      }
    : undefined;

/**
 * The deadline is carried on the AbortSignal by the caller; this is the
 * belt-and-braces ceiling so a hung socket cannot outlive the turn.
 */
const deadlineFor = (request: LlmRequest): number =>
  request.signal ? 30_000 : 10_000;
