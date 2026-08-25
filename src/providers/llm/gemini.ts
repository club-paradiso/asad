/**
 * Google Gemini adapter, using the native generateContent API.
 *
 * Deliberately NOT routed through the OpenAI compatibility shim: the native API
 * gives us `responseJsonSchema` (real schema enforcement rather than "please
 * emit JSON"), `thinkingConfig` (which matters enormously for live latency) and
 * `usageMetadata` including cached-token counts. Those are exactly the three
 * things this product needs from a provider.
 */
import { LlmError } from "./errors";
import { postJson } from "./http";
import type { LlmProvider, LlmRequest, LlmResponse, LlmUsage } from "./types";

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  error?: { message?: string };
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiLlmProvider implements LlmProvider {
  readonly id = "gemini" as const;
  readonly model: string;

  constructor(private readonly config: GeminiConfig) {
    this.model = config.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature ?? 0.2,
      maxOutputTokens: request.maxOutputTokens ?? 700,
      responseMimeType: "application/json",
    };

    if (request.jsonSchema) {
      // Native schema enforcement. Zod still validates the result — a provider
      // claiming schema support is not the same as honouring it.
      generationConfig.responseJsonSchema = request.jsonSchema;
    }

    // The single most important latency lever on Flash-class models: without
    // this the model may spend seconds thinking before emitting a word, which
    // is unusable when the interpreter is already speaking.
    if (request.thinking === "none") {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (request.thinking === "low") {
      generationConfig.thinkingConfig = { thinkingBudget: 512 };
    }

    const base = (this.config.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    const { json, rateLimit, latencyMs } = await postJson({
      url: `${base}/models/${encodeURIComponent(this.config.model)}:generateContent`,
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig,
      },
      // Gemini takes the key as a header rather than a query parameter, which
      // keeps it out of URLs and therefore out of logs.
      headers: { "x-goog-api-key": this.config.apiKey },
      timeoutMs: request.signal ? 30_000 : 10_000,
      signal: request.signal,
      label: "Gemini",
    });

    const data = json as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    if (!text.trim()) {
      const reason = data.candidates?.[0]?.finishReason;
      throw new LlmError(
        `Gemini returned no content${reason ? ` (finishReason: ${reason})` : ""}${
          data.error?.message ? `: ${data.error.message}` : ""
        }.`,
        // A safety block is a bad_request-shaped problem: retrying identical
        // input will fail identically.
        reason === "SAFETY" || reason === "PROHIBITED_CONTENT" ? "bad_request" : "malformed_output",
      );
    }

    return {
      text,
      model: data.modelVersion ?? this.config.model,
      usage: mapUsage(data.usageMetadata),
      rateLimit,
      latencyMs,
    };
  }
}

const mapUsage = (usage: GeminiResponse["usageMetadata"]): LlmUsage | undefined =>
  usage
    ? {
        inputTokens: usage.promptTokenCount,
        outputTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
        cachedInputTokens: usage.cachedContentTokenCount,
      }
    : undefined;
