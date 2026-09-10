from pathlib import Path

Path("src/lib/shared-telemetry.ts").write_text(r'''import "server-only";

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
''')

Path("src/lib/shared-telemetry.test.ts").write_text(r'''import { afterEach, describe, expect, it, vi } from "vitest";
import {
  persistSharedLatencyWithConfig,
  readSharedLatencySnapshotWithConfig,
  SHARED_TELEMETRY_MAX_SAMPLES,
} from "./shared-telemetry";

const config = {
  url: "https://redis.example.test",
  token: "test-token",
  source: "upstash" as const,
};

afterEach(() => vi.unstubAllGlobals());

describe("shared live latency telemetry", () => {
  it("stores a bounded transcript-free batch in one Redis round trip", async () => {
    let init: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, next?: RequestInit) => {
      init = next;
      return new Response(JSON.stringify({ result: 3 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const count = await persistSharedLatencyWithConfig(
      config,
      [
        {
          id: "c1-1",
          stage: "stable_to_render",
          ms: 2100,
          provider: "openrouter",
          model: "nex-agi/nex-n2.5-mini:free",
        },
        {
          id: "c1-2",
          stage: "stable_to_safe",
          ms: 2000,
          provider: "설교 원문은 저장되면 안 됩니다",
          model: "model with spaces",
        },
        {
          id: "c1-1",
          stage: "stable_to_render",
          ms: 2100,
          provider: "openrouter",
          model: "nex-agi/nex-n2.5-mini:free",
        },
      ],
      1_800_000_000_000,
    );

    expect(count).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(init?.body ?? "");
    expect(body).toContain("EVAL");
    expect(body).toContain(String(SHARED_TELEMETRY_MAX_SAMPLES));
    expect(body).toContain("stable_to_render");
    expect(body).toContain("nex-agi/nex-n2.5-mini:free");
    expect(body).not.toContain("설교 원문");
    expect(body).not.toContain("model with spaces");
    expect(body.match(/c1-1/g)).toHaveLength(1);
  });

  it("aggregates shared samples into exact diagnostics percentiles and SLOs", async () => {
    const members = [
      { id: "a-1", stage: "stable_to_render", ms: 1800, provider: "openrouter" },
      { id: "a-2", stage: "stable_to_render", ms: 2600, provider: "openrouter" },
      { id: "a-3", stage: "provider_response", ms: 1200, provider: "openrouter" },
      { id: "a-4", stage: "provider_response", ms: 1700, provider: "openrouter" },
      { nonsense: true },
    ].map((value) => JSON.stringify(value));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: members }), { status: 200 })),
    );

    const snapshot = await readSharedLatencySnapshotWithConfig(config, 1_800_000_000_000);
    expect(snapshot.sampleCount).toBe(4);
    expect(snapshot.latency.stable_to_render).toMatchObject({ count: 2, p50: 1800, p95: 2600 });
    expect(snapshot.latency.provider_response).toMatchObject({ count: 2, p50: 1200, p95: 1700 });
    expect(snapshot.latency.server_to_safe.count).toBe(0);
    expect(snapshot.slo.find((item) => item.stage === "stable_to_render")).toMatchObject({
      p50Met: true,
      p95Met: true,
    });
  });
});
''')

p = Path("src/app/api/interpret/route.ts")
s = p.read_text()
s = s.replace('import { NextResponse } from "next/server";', 'import { after, NextResponse } from "next/server";', 1)
needle = 'import { estimateTokens, telemetry } from "@/lib/telemetry";\n'
replacement = needle + 'import {\n  persistSharedLatency,\n  serverLatencySample,\n  type SharedLatencySample,\n} from "@/lib/shared-telemetry";\n'
assert needle in s
s = s.replace(needle, replacement, 1)
needle = '''  const input = parsed.data;\n  for (const sample of input.clientTelemetry ?? []) telemetry.recordClientLatency(sample);\n  const router = llmRouter();'''
replacement = '''  const input = parsed.data;\n  const sharedLatency: SharedLatencySample[] = [...(input.clientTelemetry ?? [])];\n  for (const sample of input.clientTelemetry ?? []) telemetry.recordClientLatency(sample);\n\n  const respond = (body: unknown, init?: ResponseInit) => {\n    const batch = [...sharedLatency];\n    if (batch.length > 0) {\n      after(async () => {\n        await persistSharedLatency(batch);\n      });\n    }\n    return NextResponse.json(body, init);\n  };\n\n  const recordLiveLatency = (sample: Omit<SharedLatencySample, "id">) => {\n    telemetry.recordLatency(sample);\n    sharedLatency.push(serverLatencySample(sample));\n  };\n\n  const router = llmRouter();'''
assert needle in s
s = s.replace(needle, replacement, 1)

# All response paths after successful request validation must schedule the same collected batch.
needle = '''    return NextResponse.json({\n      output: localOutput(),\n      provider: "local",\n      model: "deterministic",\n      degraded: true,\n      reason: "No cloud interpretation provider is available — using the local interpreter.",'''
replacement = needle.replace("return NextResponse.json", "return respond")
assert needle in s
s = s.replace(needle, replacement, 1)

needle = '''      return NextResponse.json({\n        output: localOutput(),\n        provider: "local",\n        model: "deterministic",\n        degraded: true,\n        reason: "The interpretation model returned output that did not match the schema.",'''
replacement = needle.replace("return NextResponse.json", "return respond")
assert needle in s
s = s.replace(needle, replacement, 1)

needle = '''    return NextResponse.json({\n      output: finalOutput,'''
replacement = '''    return respond({\n      output: finalOutput,'''
assert needle in s
s = s.replace(needle, replacement, 1)

needle = '''    return NextResponse.json({\n      output: localOutput(),\n      provider: "local",\n      model: "deterministic",\n      degraded: true,\n      reason:\n        error instanceof Error'''
replacement = needle.replace("return NextResponse.json", "return respond")
assert needle in s
s = s.replace(needle, replacement, 1)

needle = '''  telemetry.recordLatency({\n    stage: "trigger_to_dispatch",'''
replacement = '''  recordLiveLatency({\n    stage: "trigger_to_dispatch",'''
assert needle in s
s = s.replace(needle, replacement, 1)

needle = '''    telemetry.recordLatency({\n      stage: "provider_response",\n      ms: result.response.latencyMs,'''
replacement = '''    recordLiveLatency({\n      stage: "provider_response",\n      ms: result.response.latencyMs,'''
assert needle in s
s = s.replace(needle, replacement, 1)

needle = '''    telemetry.recordLatency({\n      stage: "server_to_safe",'''
replacement = '''    recordLiveLatency({\n      stage: "server_to_safe",'''
assert needle in s
s = s.replace(needle, replacement, 1)
p.write_text(s)

p = Path("src/app/api/telemetry/live/route.ts")
s = p.read_text()
s = s.replace('import { NextResponse } from "next/server";', 'import { after, NextResponse } from "next/server";', 1)
needle = 'import { telemetry } from "@/lib/telemetry";\n'
replacement = needle + 'import { persistSharedLatency } from "@/lib/shared-telemetry";\n'
assert needle in s
s = s.replace(needle, replacement, 1)
needle = '''  for (const sample of parsed.data.samples) telemetry.recordClientLatency(sample);\n  return new NextResponse(null, { status: 204 });'''
replacement = '''  for (const sample of parsed.data.samples) telemetry.recordClientLatency(sample);\n  const batch = [...parsed.data.samples];\n  after(async () => {\n    await persistSharedLatency(batch);\n  });\n  return new NextResponse(null, { status: 204 });'''
assert needle in s
p.write_text(s.replace(needle, replacement, 1))

p = Path("src/app/api/diagnostics/route.ts")
s = p.read_text()
needle = 'import { telemetry } from "@/lib/telemetry";\n'
replacement = needle + 'import { readSharedLatencySnapshot, sharedTelemetryInfo } from "@/lib/shared-telemetry";\n'
assert needle in s
s = s.replace(needle, replacement, 1)
needle = '''  let counterSessions: CounterStoreStats | null = null;\n  let storageHealth: "ok" | "unavailable" = "ok";'''
replacement = '''  let counterSessions: CounterStoreStats | null = null;\n  let storageHealth: "ok" | "unavailable" = "ok";\n  const telemetryStore = sharedTelemetryInfo();\n  const localTelemetry = telemetry.snapshot();\n  let telemetryHealth: "ok" | "local" | "unavailable" = telemetryStore.shared ? "ok" : "local";\n  let sharedLatency: Awaited<ReturnType<typeof readSharedLatencySnapshot>> = null;'''
assert needle in s
s = s.replace(needle, replacement, 1)
needle = '''  try {\n    counterSessions = await store.stats();\n  } catch {\n    // Diagnostics must remain available precisely when shared storage is the\n    // failing dependency. Counts are optional health data, never a reason to\n    // hide configuration and provider status.\n    storageHealth = "unavailable";\n  }\n'''
replacement = needle + '''\n  if (telemetryStore.shared) {\n    try {\n      sharedLatency = await readSharedLatencySnapshot();\n      if (!sharedLatency) telemetryHealth = "unavailable";\n    } catch {\n      // Redis is an observability dependency, never a reason to hide the rest\n      // of diagnostics. Fall back to this warm instance and label it honestly.\n      telemetryHealth = "unavailable";\n    }\n  }\n\n  const telemetrySnapshot = {\n    ...localTelemetry,\n    ...(sharedLatency ? { latency: sharedLatency.latency, slo: sharedLatency.slo } : {}),\n    storage: {\n      ...telemetryStore,\n      health: telemetryHealth,\n      sampleCount: sharedLatency?.sampleCount ?? null,\n      latencyScope: sharedLatency\n        ? "shared-redis"\n        : telemetryStore.shared\n          ? "process-fallback"\n          : "process-local",\n      otherMetricsScope: "process-local" as const,\n    },\n  };\n'''
assert needle in s
s = s.replace(needle, replacement, 1)
needle = '    telemetry: telemetry.snapshot(),'
assert needle in s
s = s.replace(needle, '    telemetry: telemetrySnapshot,', 1)
p.write_text(s)

p = Path("src/features/diagnostics/DiagnosticsScreen.tsx")
s = p.read_text()
needle = '''  telemetry: {\n    latency: Record<string, { count: number; p50: number; p90: number; p95: number; max: number }>;'''
replacement = '''  telemetry: {\n    storage: {\n      kind: "redis" | "memory";\n      shared: boolean;\n      source: "upstash" | "vercel-kv" | null;\n      health: "ok" | "local" | "unavailable";\n      retentionDays: number | null;\n      maxSamples: number | null;\n      sampleCount: number | null;\n      latencyScope: "shared-redis" | "process-fallback" | "process-local";\n      otherMetricsScope: "process-local";\n      transcriptStored: false;\n    };\n    latency: Record<string, { count: number; p50: number; p90: number; p95: number; max: number }>;'''
assert needle in s
s = s.replace(needle, replacement, 1)
needle = '''      <Section title="Measured latency">\n        {data.telemetry.slo.map((s) => ('''
replacement = '''      <Section title="Measured latency">\n        <Row\n          k="Latency aggregation"\n          v={\n            data.telemetry.storage.latencyScope === "shared-redis"\n              ? `shared Redis · ${data.telemetry.storage.retentionDays}d · n=${data.telemetry.storage.sampleCount ?? 0}`\n              : data.telemetry.storage.latencyScope === "process-fallback"\n                ? "process fallback (Redis unavailable)"\n                : "process local"\n          }\n          tone={\n            data.telemetry.storage.latencyScope === "shared-redis"\n              ? "ok"\n              : data.telemetry.storage.health === "unavailable"\n                ? "bad"\n                : "warn"\n          }\n        />\n        <Row k="Transcript stored in telemetry" v="no" tone="ok" />\n        {data.telemetry.slo.map((s) => ('''
assert needle in s
p.write_text(s.replace(needle, replacement, 1))
