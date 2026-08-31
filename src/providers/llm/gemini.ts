/**
 * Google Gemini adapter, using the native generateContent API.
 *
 * Deliberately NOT routed through the OpenAI compatibility shim: the native API
 * gives us `responseJsonSchema` (real schema enforcement rather than "please
 * emit JSON"), thinking controls (which matter enormously for live latency)
 * and `usageMetadata` including cached-token counts. Those are exactly the
 * three things this product needs from a provider.
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

/**
 * Current Gemini 3+ and Gemma 4 models use discrete thinking levels rather
 * than the legacy numeric thinking budget. Sending thinkingBudget: 0 to them
 * can be rejected with HTTP 400 and wrongly trip the provider circuit breaker.
 */
function usesThinkingLevel(model: string): boolean {
  const geminiMajor = /^gemini-(\d+)/i.exec(model)?.[1];
  if (geminiMajor && Number(geminiMajor) >= 3) return true;

  const gemmaMajor = /^gemma-(\d+)/i.exec(model)?.[1];
  return !!gemmaMajor && Number(gemmaMajor) >= 4;
}

function applyThinkingConfig(
  generationConfig: Record<string, unknown>,
  model: string,
  thinking: LlmRequest["thinking"],
): void {
  if (!thinking) return;

  if (usesThinkingLevel(model)) {
    generationConfig.thinkingConfig = {
      // Gemma 4 supports only minimal/high. Gemini 3+ also accepts these
      // values, so map the generic router's low setting to the low-latency
      // minimal mode rather than sending an unsupported literal "low".
      thinkingLevel: thinking === "high" ? "high" : "minimal",
    };
    return;
  }

  if (thinking === "none") {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  } else if (thinking === "low") {
    generationConfig.thinkingConfig = { thinkingBudget: 512 };
  }
}

export class GeminiLlmProvider implements LlmProvider {
  readonly id = "gemini" as const;
  readonly model: string;

  constructor(private readonly config: GeminiConfig) {
    this.model = config.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxOutputTokens ?? 700,
      responseMimeType: "application/json",
    };

    // Gemini 3.x docs recommend leaving temperature at the model default. It is
    // still useful for older Gemini models and Gemma, so only omit it on
    // Gemini 3+.
    const major = /^gemini-(\d+)/i.exec(this.config.model)?.[1];
    const isGemini3OrNewer = major ? Number(major) >= 3 : false;
    if (!isGemini3OrNewer) {
      generationConfig.temperature = request.temperature ?? 0.2;
    }

    if (request.jsonSchema) {
      // Native schema enforcement. Zod still validates the result — a provider
      // claiming schema support is not the same as honouring it.
      generationConfig.responseJsonSchema = request.jsonSchema;
    }

    applyThinkingConfig(generationConfig, this.config.model, request.thinking);

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
        // A safety/content rejection belongs to this utterance, not the provider
        // configuration. It must never permanently bench Gemini for everyone.
        reason === "SAFETY" || reason === "PROHIBITED_CONTENT"
          ? "request_rejected"
          : "malformed_output",
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
