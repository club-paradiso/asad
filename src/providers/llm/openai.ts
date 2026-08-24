/**
 * OpenAI interpretation provider.
 *
 * `response_format: json_object` plus the schema spelled out in the prompt.
 * Output is still validated with Zod above this layer — a provider claiming
 * JSON mode is not the same as a provider honouring it.
 */
import { LlmError, type LlmProvider, type LlmRequest, type LlmProviderId } from "./types";

interface OpenAiChoice {
  message?: { content?: string };
}
interface OpenAiResponse {
  choices?: OpenAiChoice[];
  error?: { message?: string };
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-4.1-mini",
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async complete(request: LlmRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxOutputTokens ?? 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new LlmError(
        `OpenAI request failed (${response.status}): ${detail}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const data = (await response.json()) as OpenAiResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new LlmError("OpenAI returned no content");
    return content;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return response.statusText;
  }
}
