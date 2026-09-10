"use client";

/**
 * How long a Live session should stop paying cloud latency after a failure we
 * already know cannot improve on the next sentence.
 *
 * Generic network/server failures are deliberately NOT classified here. They
 * may recover immediately and should keep using the normal retry/fallback path.
 */
export const TEMPORARY_RATE_LIMIT_BYPASS_MS = 60_000;
export const SESSION_QUOTA_BYPASS_MS = 90 * 60_000;

const DAILY_QUOTA =
  /quota\s*(?:is\s*)?(?:exhausted|exceeded)|daily.{0,40}(?:limit|cap|quota)|free[-_\s]?models?[-_\s]?per[-_\s]?day|requests?\s*(?:per|\/)\s*day|insufficient.{0,20}(?:credit|quota)/i;
const RATE_LIMIT = /\b429\b|rate[-\s]?limit(?:ed|ing)?|too many requests/i;

export function cloudBypassMsForFailure(input: {
  status?: number;
  reason?: string;
}): number {
  const reason = input.reason?.trim() ?? "";
  if (DAILY_QUOTA.test(reason)) return SESSION_QUOTA_BYPASS_MS;
  if (input.status === 429 || RATE_LIMIT.test(reason)) return TEMPORARY_RATE_LIMIT_BYPASS_MS;
  return 0;
}
