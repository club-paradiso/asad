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
import {
  RELAY_MAX_STORED_FRAMES,
  RELAY_TTL_MS,
  type RelayFrame,
} from "./protocol";
import { hashSecret, isExpired, retentionMs, roleForToken, type RemoteMicRecord } from "./session";

const KEY_PREFIX = "asad:remote-mic:v1:";
const REDIS_TIMEOUT_MS = 2_500;
const UPDATE_RETRIES = 8;

/** A mutation decides whether its changes should be written. */
export type Mutation<T> = (record: RemoteMicRecord) => { write: boolean; result: T };

/**
 * Relay outcomes. Authorisation and state are checked in the same atomic step
 * as the read or write, so a relay request costs one store round trip.
 */
export type RelayAppendResult = "ok" | "not-found" | "unauthorized" | "not-relay";
export type RelayReadResult =
  | { kind: "ok"; frames: RelayFrame[] }
  | { kind: "not-found" | "unauthorized" | "not-relay" };

export interface RemoteMicStore {
  readonly kind: "memory" | "redis";
  readonly shared: boolean;
  create(record: RemoteMicRecord): Promise<void>;
  get(id: string): Promise<RemoteMicRecord | undefined>;
  update<T>(id: string, mutate: Mutation<T>): Promise<{ found: false } | { found: true; result: T }>;
  delete(id: string): Promise<void>;
  /** Phone → store. Only the sender token, only an approved pairing in relay mode. */
  relayAppend(id: string, senderToken: string, frames: Array<{ n: number; a: string }>): Promise<RelayAppendResult>;
  /** Store → computer. Frames strictly after `after` ("" = everything kept). */
  relayRead(id: string, receiverToken: string, after: string, count: number): Promise<RelayReadResult>;
  /** Drop relay audio now (pairing ended). */
  relayClear(id: string): Promise<void>;
}

/** "ms-seq" stream ids compare numerically, part by part. */
export function compareRelayIds(a: string, b: string): number {
  const [am, as] = a.split("-").map(Number);
  const [bm, bs] = b.split("-").map(Number);
  return am !== bm ? am - bm : as - bs;
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
      if (isExpired(record, now)) {
        this.records.delete(id);
        this.relays.delete(id);
      }
    }
    for (const [id, relay] of this.relays) {
      if (relay.expiresAt <= now) this.relays.delete(id);
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
    this.relays.delete(id);
  }

  private readonly relays = new Map<string, { frames: RelayFrame[]; expiresAt: number; last: number; seq: number }>();

  private relayGate(id: string, role: "sender" | "receiver", token: string) {
    this.sweep();
    const record = this.records.get(id);
    if (!record) return "not-found" as const;
    if (roleForToken(record, token) !== role) return "unauthorized" as const;
    if (record.state !== "approved" || record.relay !== true) return "not-relay" as const;
    return "ok" as const;
  }

  async relayAppend(id: string, senderToken: string, frames: Array<{ n: number; a: string }>) {
    const gate = this.relayGate(id, "sender", senderToken);
    if (gate !== "ok") return gate;
    const now = this.now();
    let relay = this.relays.get(id);
    if (!relay || relay.expiresAt <= now) relay = { frames: [], expiresAt: 0, last: 0, seq: 0 };
    for (const frame of frames) {
      const ms = Math.max(now, relay.last);
      relay.seq = ms === relay.last ? relay.seq + 1 : 0;
      relay.last = ms;
      relay.frames.push({ id: `${ms}-${relay.seq}`, n: frame.n, a: frame.a });
    }
    if (relay.frames.length > RELAY_MAX_STORED_FRAMES) relay.frames.splice(0, relay.frames.length - RELAY_MAX_STORED_FRAMES);
    relay.expiresAt = now + RELAY_TTL_MS;
    this.relays.set(id, relay);
    return "ok" as const;
  }

  async relayRead(id: string, receiverToken: string, after: string, count: number): Promise<RelayReadResult> {
    const gate = this.relayGate(id, "receiver", receiverToken);
    if (gate !== "ok") return { kind: gate };
    const relay = this.relays.get(id);
    if (!relay || relay.expiresAt <= this.now()) return { kind: "ok", frames: [] };
    const frames = relay.frames.filter((frame) => !after || compareRelayIds(frame.id, after) > 0).slice(0, count);
    return { kind: "ok", frames: frames.map((frame) => ({ ...frame })) };
  }

  async relayClear(id: string) {
    this.relays.delete(id);
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

/*
 * Relay scripts. Each request is ONE store command: the record is read, the
 * presented token hash compared to the role's hash, the state checked, and the
 * stream written or read, atomically. Return codes: 0 no record, -1 wrong
 * token, -2 not relaying, 1 ok.
 */
const RELAY_APPEND_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local rec = cjson.decode(raw).record
if rec.senderTokenHash ~= ARGV[1] then return -1 end
if rec.state ~= 'approved' or rec.relay ~= true then return -2 end
for i = 4, #ARGV, 2 do
  redis.call('XADD', KEYS[2], 'MAXLEN', ARGV[3], '*', 'n', ARGV[i], 'a', ARGV[i + 1])
end
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return 1
`;

const RELAY_READ_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {0} end
local rec = cjson.decode(raw).record
if rec.receiverTokenHash ~= ARGV[1] then return {-1} end
if rec.state ~= 'approved' or rec.relay ~= true then return {-2} end
local start = ARGV[2]
if start == '' then start = '-' end
return {1, redis.call('XRANGE', KEYS[2], start, '+', 'COUNT', ARGV[3])}
`;

type StreamEntry = [string, string[]];

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
    await this.command<number>(["DEL", this.key(id), this.relayKey(id)]);
  }

  private relayKey(id: string) {
    return `${KEY_PREFIX}relay:${id}`;
  }

  async relayAppend(id: string, senderToken: string, frames: Array<{ n: number; a: string }>) {
    const args: Array<string | number> = [
      "EVAL",
      RELAY_APPEND_SCRIPT,
      2,
      this.key(id),
      this.relayKey(id),
      hashSecret("sender", senderToken),
      RELAY_TTL_MS,
      RELAY_MAX_STORED_FRAMES,
    ];
    for (const frame of frames) args.push(frame.n, frame.a);
    const code = await this.command<number>(args);
    return code === 1 ? "ok" : code === 0 ? "not-found" : code === -1 ? "unauthorized" : "not-relay";
  }

  async relayRead(id: string, receiverToken: string, after: string, count: number): Promise<RelayReadResult> {
    // XRANGE's start is inclusive; ask for one extra and drop `after` itself.
    const result = await this.command<[number, StreamEntry[]?]>([
      "EVAL",
      RELAY_READ_SCRIPT,
      2,
      this.key(id),
      this.relayKey(id),
      hashSecret("receiver", receiverToken),
      after,
      count + 1,
    ]);
    const code = Array.isArray(result) ? result[0] : 0;
    if (code !== 1) return { kind: code === 0 ? "not-found" : code === -1 ? "unauthorized" : "not-relay" };
    const frames: RelayFrame[] = [];
    for (const entry of result[1] ?? []) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
      if (after && compareRelayIds(entry[0], after) <= 0) continue;
      const fields = entry[1];
      let n = -1;
      let a = "";
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === "n") n = Number(fields[i + 1]);
        else if (fields[i] === "a") a = String(fields[i + 1]);
      }
      if (Number.isSafeInteger(n) && n >= 0 && a) frames.push({ id: entry[0], n, a });
    }
    return { kind: "ok", frames: frames.slice(0, count) };
  }

  async relayClear(id: string) {
    await this.command<number>(["DEL", this.relayKey(id)]);
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
