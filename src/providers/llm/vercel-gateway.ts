import "server-only";

import { LlmError } from "./errors";
import { postJson } from "./http";
import type { LlmRequest, LlmResponse, LlmUsage } from "./types";

/**
 * Emergency cloud recovery for Vercel deployments.
 *
 * ASAD's public OpenRouter account is intentionally constrained to free models,
 * and the unfunded free-model allowance cannot carry a full live service. Vercel
 * already supplies a project-scoped OIDC token at runtime, so AI Gateway gives
 * us a second cloud path without shipping another long-lived provider secret.
 *
 * Privacy is a hard requirement here: every request asks Gateway to route only
 * through providers with Zero Data Retention and no prompt training. If the
 * team's plan/provider combination cannot satisfy that policy, the request
 * fails closed and the existing local/browser fallback remains in charge.
 */
export const VERCEL_GATEWAY_MODEL =
  process.env.VERCEL_AI_GATEWAY_MODEL?.trim() || "google/gemini-2.5-flash-lite";

const VERCEL_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

interface GatewayChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

export function vercelGatewayToken(): string | null {
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  return token || null;
}

export function vercelGatewayAvailable(): boolean {
  return vercelGatewayToken() !== null;
}

export async function completeViaVercelGateway(
  request: LlmRequest,
  options: { timeoutMs?: number; model?: string } = {},
): Promise<LlmResponse> {
  const token = vercelGatewayToken();
  if (!token) {
    throw new LlmError("Vercel AI Gateway authentication is unavailable.", "auth");
  }

  // Counter and Live have different budgets, so each names its own model and
  // the shared default covers anything that does not care.
  const model = options.model?.trim() || VERCEL_GATEWAY_MODEL;

  const body: Record<string, unknown> = {
    model,
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxOutputTokens ?? 700,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    providerOptions: {
      gateway: {
        // ASAD handles public-facing administrative and immigration speech.
        // A recovery path is not permission to weaken the privacy contract.
        zeroDataRetention: true,
        disallowPromptTraining: true,
        sort: "ttft",
      },
    },
  };

  if (request.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "asad_output",
        strict: true,
        schema: request.jsonSchema,
      },
    };
  } else {
    body.response_format = { type: "json_object" };
  }

  const { json, rateLimit, latencyMs } = await postJson({
    url: `${VERCEL_GATEWAY_BASE_URL}/chat/completions`,
    body,
    headers: { authorization: `Bearer ${token}` },
    timeoutMs: options.timeoutMs ?? 6_000,
    signal: request.signal,
    label: "Vercel AI Gateway",
  });

  const data = json as GatewayChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError(
      `Vercel AI Gateway returned no content${data.error?.message ? `: ${data.error.message}` : ""}.`,
      "malformed_output",
    );
  }

  return {
    text: content,
    model: data.model ?? model,
    usage: mapUsage(data.usage),
    rateLimit,
    latencyMs,
  };
}

const mapUsage = (usage: GatewayChatResponse["usage"]): LlmUsage | undefined =>
  usage
    ? {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      }
    : undefined;
