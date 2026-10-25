/**
 * Remote Microphone pairing store.
 *
 * Two serverless requests — the MacBook polling and the iPhone posting an
 * offer — can land on different Vercel instances, so a pairing that lives in
 * one instance's memory is a pairing that silently does not exist half the
 * time. Production therefore uses the deployment's existing Upstash / Vercel
 * KV REST database (the same credentials Counter Mode already resolves), with
 * an atomic Lua compare-and-set so two writers never overwrite one another.
 * Local development and tests use the in-memory store.
 *
 * Only signalling lives here, under a TTL: no audio, no transcript, and every
 * credential as a hash.
 */
import { resolveCounterRedisConfig, type RedisConfig } from "@/counter/store";
import { isExpired, retentionMs, type RemoteMicRecord } from "./session";

const KEY_PREFIX = "asad:remote-mic:v1:";
const REDIS_TIMEOUT_MS = 2_500;
const UPDATE_RETRIES = 8;

/** A mutation decides whether its changes should be written. */
export type Mutation<T> = (record: RemoteMicRecord) => { write: boolean; result: T };

export interface RemoteMicStore {
  readonly kind: "memory" | "redis";
  readonly shared: boolean;
  create(record: RemoteMicRecord): Promise<void>;
  get(id: string): Promise<RemoteMicRecord | undefined>;
  update<T>(id: string, mutate: Mutation<T>): Promise<{ found: false } | { found: true; result: T }>;
  delete(id: string): Promise<void>;
}

const clone = (record: RemoteMicRecord): RemoteMicRecord =>
  JSON.parse(JSON.stringify(record)) as RemoteMicRecord;

class MemoryRemoteMicStore implements RemoteMicStore {
  readonly kind = "memory" as const;
  readonly shared = false;
  private readonly records = new Map<string, RemoteMicRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Sweep on access; there is no timer to leak. */
  private sweep() {
    const now = this.now();
    for (const [id, record] of this.records) {
      if (isExpired(record, now)) this.records.delete(id);
    }
  }

  async create(record: RemoteMicRecord) {
    this.sweep();
    if (this.records.has(record.id)) throw new Error("Pairing id collision.");
    this.records.set(record.id, clone(record));
  }

  async get(id: string) {
    this.sweep();
    const record = this.records.get(id);
    return record ? clone(record) : undefined;
  }

  async update<T>(id: string, mutate: Mutation<T>) {
    this.sweep();
    const current = this.records.get(id);
    if (!current) return { found: false as const };
    const draft = clone(current);
    const { write, result } = mutate(draft);
    if (write) this.records.set(id, draft);
    return { found: true as const, result };
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

interface Envelope {
  rev: number;
  record: RemoteMicRecord;
}

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if tostring(decoded.rev) ~= ARGV[1] then return -1 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

class RedisRemoteMicStore implements RemoteMicStore {
  readonly kind = "redis" as const;
  readonly shared = true;

  constructor(
    private readonly config: RedisConfig,
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private key(id: string) {
    return `${KEY_PREFIX}${id}`;
  }

  private async command<T>(args: Array<string | number>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // Never echo the response body: it could quote the command, and the
    // command carries SDP.
    if (!response.ok) throw new Error(`Remote microphone store request failed (${response.status}).`);
    const body = (await response.json()) as { result?: T; error?: string };
    if (body.error) throw new Error("Remote microphone store returned an error.");
    return body.result as T;
  }

  private parse(raw: string): Envelope {
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (typeof parsed.rev !== "number" || !parsed.record || typeof parsed.record.id !== "string") {
      throw new Error("Remote microphone record is malformed.");
    }
    return parsed as Envelope;
  }

  async create(record: RemoteMicRecord) {
    const result = await this.command<string | null>([
      "SET",
      this.key(record.id),
      JSON.stringify({ rev: 1, record } satisfies Envelope),
      "NX",
      "PX",
      retentionMs(record, this.now()),
    ]);
    if (result !== "OK") throw new Error("Pairing id collision.");
  }

  async get(id: string) {
    const raw = await this.command<string | null>(["GET", this.key(id)]);
    return raw ? this.parse(raw).record : undefined;
  }

  async update<T>(id: string, mutate: Mutation<T>) {
    const key = this.key(id);
    for (let attempt = 0; attempt < UPDATE_RETRIES; attempt += 1) {
      const raw = await this.command<string | null>(["GET", key]);
      if (!raw) return { found: false as const };
      const current = this.parse(raw);
      const draft = clone(current.record);
      const { write, result } = mutate(draft);
      if (!write) return { found: true as const, result };

      const outcome = await this.command<number>([
        "EVAL",
        CAS_SCRIPT,
        1,
        key,
        current.rev,
        JSON.stringify({ rev: current.rev + 1, record: draft } satisfies Envelope),
        retentionMs(draft, this.now()),
      ]);
      if (outcome === 1) return { found: true as const, result };
      if (outcome === 0) return { found: false as const };
      // -1: another request won the race. Re-read and re-apply the mutation.
    }
    throw new Error("Remote microphone pairing was too busy to update safely.");
  }

  async delete(id: string) {
    await this.command<number>(["DEL", this.key(id)]);
  }
}

let store: RemoteMicStore | null = null;

export function remoteMicStore(): RemoteMicStore {
  if (store) return store;
  const redis = resolveCounterRedisConfig();
  store = redis ? new RedisRemoteMicStore(redis) : new MemoryRemoteMicStore();
  return store;
}

/** Test seams. */
export const __setRemoteMicStore = (next: RemoteMicStore | null) => {
  store = next;
};
export const createMemoryRemoteMicStore = (now?: () => number) => new MemoryRemoteMicStore(now);
export const createRedisRemoteMicStore = (
  config: RedisConfig,
  now?: () => number,
  fetchImpl?: typeof fetch,
) => new RedisRemoteMicStore(config, now, fetchImpl);
