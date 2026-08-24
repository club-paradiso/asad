/**
 * Shared HTTP plumbing for LLM adapters.
 *
 * Every adapter needs the same three things and none of them are interesting
 * enough to write four times: a fetch with a hard deadline, consistent error
 * classification, and rate-limit headers scraped off the response.
 */
import { LlmError, classifyHttpStatus, parseRetryAfter, toLlmError } from "./errors";
import type { RateLimitSnapshot } from "./types";

export interface TimedFetchOptions {
  url: string;
  body: unknown;
  headers: Record<string, string>;
  /** Hard deadline. A live answer that arrives late is worthless. */
  timeoutMs: number;
  /** Caller's abort signal, combined with the deadline. */
  signal?: AbortSignal;
  /** Provider name, for error messages. */
  label: string;
}

export interface TimedFetchResult {
  json: unknown;
  rateLimit?: RateLimitSnapshot;
  latencyMs: number;
}

/**
 * POST JSON with a deadline, returning parsed JSON or throwing a classified
 * `LlmError`.
 */
export async function postJson(options: TimedFetchOptions): Promise<TimedFetchResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  // Abort if either the deadline fires or the caller cancels (newer Korean
  // superseded this request).
  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    const rateLimit = readRateLimitHeaders(response.headers);

    if (!response.ok) {
      const text = await safeText(response);
      throw new LlmError(
        `${options.label} request failed (${response.status}): ${text}`,
        classifyHttpStatus(response.status, text),
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new LlmError(`${options.label} returned a non-JSON body.`, "malformed_output");
    }

    return { json, rateLimit, latencyMs: Date.now() - started };
  } catch (error) {
    // A deadline abort and a caller abort look identical to fetch; the caller's
    // signal tells them apart.
    if (options.signal?.aborted) {
      throw new LlmError("Superseded by newer speech.", "timeout");
    }
    throw toLlmError(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Read the de-facto standard rate-limit headers.
 *
 * OpenAI-compatible providers (Groq, OpenRouter, OpenAI) use `x-ratelimit-*`
 * with human durations like "6s" or "2m59.56s" for the reset fields.
 */
export function readRateLimitHeaders(headers: Headers): RateLimitSnapshot | undefined {
  const requests = numberOrUndefined(headers.get("x-ratelimit-remaining-requests"));
  const tokens = numberOrUndefined(headers.get("x-ratelimit-remaining-tokens"));
  const resetRequests = parseDuration(headers.get("x-ratelimit-reset-requests"));
  const resetTokens = parseDuration(headers.get("x-ratelimit-reset-tokens"));

  if (requests === undefined && tokens === undefined && resetRequests === undefined && resetTokens === undefined) {
    return undefined;
  }

  // Whichever window resets later is the one that actually gates us.
  const resetMs = Math.max(resetRequests ?? 0, resetTokens ?? 0);

  return {
    requestsRemaining: requests,
    tokensRemaining: tokens,
    resetAt: resetMs > 0 ? Date.now() + resetMs : undefined,
    observedAt: Date.now(),
  };
}

const numberOrUndefined = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Parse the duration strings these headers use: "6s", "2m59.56s", "1h2m",
 * "500ms". Returns milliseconds.
 */
export function parseDuration(value: string | null): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * 1000; // bare seconds

  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matched = true;
    const amount = Number(match[1]);
    switch (match[2]) {
      case "ms":
        total += amount;
        break;
      case "s":
        total += amount * 1000;
        break;
      case "m":
        total += amount * 60_000;
        break;
      case "h":
        total += amount * 3_600_000;
        break;
    }
  }
  return matched ? total : undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return response.statusText;
  }
}
