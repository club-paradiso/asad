import "server-only";

import { randomUUID } from "node:crypto";
import { resolveCounterRedisConfig, type RedisConfig } from "@/counter/store";
import {
  LATENCY_SLO,
  summarise,
  type LatencyStage,
  type Percentiles,
  type SloVerdict,
} from "@/lib/telemetry";

const REDIS_KEY = "asad:telemetry:live:v1:latency";
const REDIS_TIMEOUT_MS = 1_500;
export const SHARED_TELEMETRY_RETENTION_DAYS = 7;
export const SHARED_TELEMETRY_RETENTION_MS =
  SHARED_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const SHARED_TELEMETRY_MAX_SAMPLES = 8_000;
const REDIS_KEY_TTL_MS = SHARED_TELEMETRY_RETENTION_MS + 24 * 60 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,80}$/;
const SAFE_LABEL = /^[A-Za-z0-9._:/@+-]{1,160}$/;

export const LIVE_LATENCY_STAGES = [
  "stable_to_client_dispatch",
  "trigger_to_dispatch",
  "provider_response",
  "server_to_safe",
  "stable_to_safe",
  "stable_to_anticipated",
  "stable_to_render",
  "stable_to_provisional",
  "stable_to_provisional_render",
  "provisional_to_refinement",
  "refinement_discarded_committed",
  "contextual_result_stale",
  "provisional_failed",
] as const satisfies readonly LatencyStage[];

const LIVE_LATENCY_STAGE_SET = new Set<string>(LIVE_LATENCY_STAGES);

export interface SharedLatencySample {
  id: string;
  stage: LatencyStage;
  ms: number;
  provider?: string;
  model?: string;
}

const STORE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
for i = 5, #ARGV do
  redis.call('ZADD', KEYS[1], ARGV[4], ARGV[i])
end
local count = redis.call('ZCARD', KEYS[1])
local max = tonumber(ARGV[2])
if count > max then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - max - 1)
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return redis.call('ZCARD', KEYS[1])
`;

const READ_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
local max = tonumber(ARGV[2])
if count > max then
  redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - max - 1)
  count = redis.call('ZCARD', KEYS[1])
end
if count == 0 then
  redis.call('DEL', KEYS[1])
  return {}
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return redis.call('ZRANGE', KEYS[1], 0, -1)
`;

interface RedisResponse<T> {
  result?: T;
  error?: string;
}

export interface SharedLatencySnapshot {
  latency: Record<LatencyStage, Percentiles>;
  slo: SloVerdict[];
  sampleCount: number;
}

function safeLabel(value: string | undefined): string | undefined {
  if (!value || !SAFE_LABEL.test(value)) return undefined;
  return value;
}

function sanitiseSample(sample: SharedLatencySample): SharedLatencySample | null {
  if (!SAFE_ID.test(sample.id)) return null;
  if (!LIVE_LATENCY_STAGE_SET.has(sample.stage)) return null;
  if (!Number.isFinite(sample.ms) || sample.ms < 0) return null;
  return {
    id: sample.id,
    stage: sample.stage,
    ms: Math.min(120_000, Math.round(sample.ms)),
    ...(safeLabel(sample.provider) ? { provider: safeLabel(sample.provider) } : {}),
    ...(safeLabel(sample.model) ? { model: safeLabel(sample.model) } : {}),
  };
}

function serialiseSample(sample: SharedLatencySample): string | null {
  const safe = sanitiseSample(sample);
  return safe ? JSON.stringify(safe) : null;
}

function uniqueMembers(samples: SharedLatencySample[]): string[] {
  const seenIds = new Set<string>();
  const members: string[] = [];
  for (const sample of samples) {
    if (seenIds.has(sample.id)) continue;
    const member = serialiseSample(sample);
    if (!member) continue;
    seenIds.add(sample.id);
    members.push(member);
  }
  return members;
}

function parseMember(raw: string): SharedLatencySample | null {
  try {
    const value = JSON.parse(raw) as Partial<SharedLatencySample>;
    if (
      typeof value.id !== "string" ||
      typeof value.stage !== "string" ||
      typeof value.ms !== "number"
    ) {
      return null;
    }
    return sanitiseSample(value as SharedLatencySample);
  } catch {
    return null;
  }
}

async function redisCommand<T>(config: RedisConfig, args: Array<string | number>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Shared telemetry Redis request failed (${response.status}).`);
  const body = (await response.json()) as RedisResponse<T>;
  if (body.error) throw new Error(`Shared telemetry Redis error: ${body.error}`);
  return body.result as T;
}

export function serverLatencySample(
  sample: Omit<SharedLatencySample, "id">,
): SharedLatencySample {
  return { ...sample, id: `s-${randomUUID()}` };
}

export async function persistSharedLatencyWithConfig(
  config: RedisConfig,
  samples: SharedLatencySample[],
  now: number = Date.now(),
): Promise<number> {
  const members = uniqueMembers(samples);
  if (members.length === 0) return 0;
  return Number(
    await redisCommand<number | string>(config, [
      "EVAL",
      STORE_SCRIPT,
      1,
      REDIS_KEY,
      now - SHARED_TELEMETRY_RETENTION_MS,
      SHARED_TELEMETRY_MAX_SAMPLES,
      REDIS_KEY_TTL_MS,
      now,
      ...members,
    ]),
  );
}

/** Best-effort shared persistence. Telemetry must never break interpretation. */
export async function persistSharedLatency(samples: SharedLatencySample[]): Promise<boolean> {
  const config = resolveCounterRedisConfig();
  if (!config || samples.length === 0) return false;
  try {
    await persistSharedLatencyWithConfig(config, samples);
    return true;
  } catch {
    return false;
  }
}

export async function readSharedLatencySnapshotWithConfig(
  config: RedisConfig,
  now: number = Date.now(),
): Promise<SharedLatencySnapshot> {
  const raw = await redisCommand<string[]>(config, [
    "EVAL",
    READ_SCRIPT,
    1,
    REDIS_KEY,
    now - SHARED_TELEMETRY_RETENTION_MS,
    SHARED_TELEMETRY_MAX_SAMPLES,
    REDIS_KEY_TTL_MS,
  ]);

  const samples = (raw ?? [])
    .map(parseMember)
    .filter((sample): sample is SharedLatencySample => sample !== null);

  const latency = Object.fromEntries(
    LIVE_LATENCY_STAGES.map((stage) => [
      stage,
      summarise(samples.filter((sample) => sample.stage === stage).map((sample) => sample.ms)),
    ]),
  ) as Record<LatencyStage, Percentiles>;

  const slo = (Object.keys(LATENCY_SLO) as Array<keyof typeof LATENCY_SLO>).map((stage) => {
    const actual = latency[stage];
    const target = LATENCY_SLO[stage];
    return {
      stage,
      target,
      actual,
      p50Met: actual.count > 0 && actual.p50 <= target.p50,
      p95Met: actual.count > 0 && actual.p95 <= target.p95,
    };
  });

  return { latency, slo, sampleCount: samples.length };
}

export async function readSharedLatencySnapshot(): Promise<SharedLatencySnapshot | null> {
  const config = resolveCounterRedisConfig();
  if (!config) return null;
  return readSharedLatencySnapshotWithConfig(config);
}

export function sharedTelemetryInfo(env: NodeJS.ProcessEnv = process.env) {
  const redis = resolveCounterRedisConfig(env);
  return {
    kind: redis ? ("redis" as const) : ("memory" as const),
    shared: !!redis,
    source: redis?.source ?? null,
    retentionDays: redis ? SHARED_TELEMETRY_RETENTION_DAYS : null,
    maxSamples: redis ? SHARED_TELEMETRY_MAX_SAMPLES : null,
    transcriptStored: false as const,
  };
}
