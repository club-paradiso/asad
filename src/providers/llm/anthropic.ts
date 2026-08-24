/**
 * Anthropic interpretation provider.
 *
 * Uses an assistant prefill of `{` — the cheapest reliable way to stop a
 * model prefacing structured output with a sentence of explanation. The
 * leading brace is restored before the response leaves this file.
 */
import { LlmError, type LlmProvider, type LlmRequest, type LlmProviderId } from "./types";

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  error?: { message?: string };
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model = "claude-sonnet-5",
    private readonly baseUrl = "https://api.anthropic.com/v1",
  ) {}

  async complete(request: LlmRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 700,
        temperature: request.temperature ?? 0.2,
        system: request.system,
        messages: [
          { role: "user", content: request.user },
          { role: "assistant", content: "{" },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new LlmError(
        `Anthropic request failed (${response.status}): ${detail}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const data = (await response.json()) as AnthropicResponse;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new LlmError("Anthropic returned no content");
    // Restore the prefilled brace.
    return text.trimStart().startsWith("{") ? text : `{${text}`;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return response.statusText;
  }
}
