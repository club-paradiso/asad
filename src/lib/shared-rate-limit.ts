import "server-only";
import { createHash } from "node:crypto";
import { resolveCounterRedisConfig, type RedisConfig } from "@/counter/store";
import type { RateLimitRule, RateLimitVerdict } from "./rate-limit";

const KEY_PREFIX = "asad:request-rate:v1:";
const SHARED_LIMIT_TIMEOUT_MS = 1_200;

const RATE_LIMIT_SCRIPT = `
local result = {}
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[i], ARGV[i])
  end
  local ttl = redis.call('PTTL', KEYS[i])
  table.insert(result, count)
  table.insert(result, ttl)
end
return result
`;

export interface SharedRateLimitCheck {
  name: string;
  key: string;
  rule: RateLimitRule;
}

interface RedisResponse<T> {
  result?: T;
  error?: string;
}

const redisKey = (name: string, key: string): string => {
  const digest = createHash("sha256")
    .update(`${name}:${key}`)
    .digest("base64url");
  return `${KEY_PREFIX}${name}:${digest}`;
};

/**
 * Enforce several request limits in one Redis round trip.
 *
 * The raw session token / IP address is hashed before it becomes a Redis key.
 * That keeps the shared store useful for counters without turning it into an
 * accidental log of visitors or session credentials.
 */
export async function checkSharedRateLimitsWithConfig(
  config: RedisConfig,
  checks: SharedRateLimitCheck[],
): Promise<RateLimitVerdict[]> {
  if (checks.length === 0) return [];

  const keys = checks.map((check) => redisKey(check.name, check.key));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHARED_LIMIT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        RATE_LIMIT_SCRIPT,
        checks.length,
        ...keys,
        ...checks.map((check) => check.rule.windowMs),
      ]),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Shared rate-limit Redis request failed (${response.status}).`);
  }

  const body = (await response.json()) as RedisResponse<Array<number | string>>;
  if (body.error) throw new Error(`Shared rate-limit Redis error: ${body.error}`);
  const values = body.result ?? [];

  return checks.map((check, index) => {
    const count = Number(values[index * 2] ?? 0);
    const ttlMs = Number(values[index * 2 + 1] ?? check.rule.windowMs);
    return {
      allowed: count <= check.rule.limit,
      remaining: Math.max(0, check.rule.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000)),
      limit: check.rule.limit,
    };
  });
}

/**
 * Use the deployment's existing Upstash / Vercel KV REST credentials when
 * available. A Redis outage never removes the old in-process limiter: callers
 * keep that limiter as the floor and treat null here as "shared check skipped".
 */
export async function checkSharedRateLimits(
  checks: SharedRateLimitCheck[],
): Promise<RateLimitVerdict[] | null> {
  const config = resolveCounterRedisConfig();
  if (!config || checks.length === 0) return null;
  try {
    return await checkSharedRateLimitsWithConfig(config, checks);
  } catch {
    return null;
  }
}
