/**
 * LLM failure classification.
 *
 * The router has to make a different decision for each kind of failure, and
 * "it threw" is not enough information. A 429 means back off and try someone
 * else; a 401 means stop trying forever until a human fixes the config;
 * malformed JSON means the provider is technically up but useless to us.
 *
 * Getting this wrong is expensive in a specific way: retrying a bad API key
 * on every phrase of a sermon adds seconds of latency to every line and never
 * succeeds.
 */
export type LlmFailureKind =
  /** Request exceeded the live deadline. Provider may be fine, just slow. */
  | "timeout"
  /** HTTP 429. Back off; quota may reset. */
  | "rate_limited"
  /** Free/paid quota exhausted for the period. Longer cooldown than a 429. */
  | "quota_exhausted"
  /** HTTP 5xx. Provider-side fault, retryable. */
  | "server_error"
  /** Network failure, DNS, TLS, egress blocked. */
  | "network"
  /** Provider answered but the payload failed schema validation. */
  | "malformed_output"
  /** 401/403. Permanent until configuration changes — never retry. */
  | "auth"
  /** Bad endpoint/model/configuration. Permanent for this process config. */
  | "bad_request"
  /** Request-specific 400/422 (shape/capability/safety). Recoverable. */
  | "request_rejected"
  /** Anything unclassified. */
  | "unknown";

/** Failures that must never be retried against the same provider config. */
const PERMANENT: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  "auth",
  "bad_request",
]);

/** Failures that should open the circuit quickly rather than after N strikes. */
const HARD_STOP: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  "auth",
  "bad_request",
  "quota_exhausted",
]);

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmFailureKind,
    readonly status?: number,
    /** Seconds the provider asked us to wait, from Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }

  /** True when trying the SAME provider again could plausibly work. */
  get retryable(): boolean {
    return !PERMANENT.has(this.kind);
  }

  /** True when the circuit should open immediately rather than on a streak. */
  get fatal(): boolean {
    return HARD_STOP.has(this.kind);
  }
}

/**
 * Providers unfortunately use HTTP 400 for two different classes of problem:
 * a deployment-level configuration error (for example a removed model id) and
 * a request-level incompatibility (for example a newly rejected generation
 * option). Only the former deserves a permanent circuit break.
 */
function looksLikePermanentModelError(body?: string): boolean {
  const text = (body ?? "").toLowerCase();
  return (
    text.includes("no such model") ||
    text.includes("model not found") ||
    text.includes("unknown model") ||
    text.includes("invalid model") ||
    text.includes("unsupported model") ||
    text.includes("model does not exist") ||
    text.includes("model doesn't exist") ||
    (text.includes("model") && text.includes("not found"))
  );
}

/** Map an HTTP status (plus body hints) onto a failure kind. */
export function classifyHttpStatus(status: number, body?: string): LlmFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) {
    // Providers distinguish "too fast" from "you are out" only in the body.
    const text = (body ?? "").toLowerCase();
    const exhausted =
      text.includes("quota") ||
      text.includes("exhausted") ||
      text.includes("insufficient") ||
      text.includes("billing") ||
      text.includes("credits");
    return exhausted ? "quota_exhausted" : "rate_limited";
  }

  // A missing route/model is deployment configuration, not an individual turn.
  if (status === 404) return "bad_request";
  if (status === 400 || status === 422) {
    return looksLikePermanentModelError(body) ? "bad_request" : "request_rejected";
  }
  if (status >= 500) return "server_error";
  return "unknown";
}

/** Normalise a thrown value into an LlmError. */
export function toLlmError(error: unknown, fallback: LlmFailureKind = "unknown"): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return new LlmError("Request exceeded the live deadline.", "timeout");
    }
    // fetch() surfaces DNS/TLS/egress failures as a bare TypeError.
    if (error.name === "TypeError" || /fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
      return new LlmError(error.message, "network");
    }
    return new LlmError(error.message, fallback);
  }
  return new LlmError(String(error), fallback);
}

/** Parse Retry-After, which may be seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}
