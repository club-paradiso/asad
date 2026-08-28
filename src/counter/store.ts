/**
 * Counter session store.
 *
 * Production can use a shared Upstash Redis REST database so a session survives
 * Vercel function cold starts and requests landing on different instances.
 * Local development and tests keep the in-memory implementation.
 *
 * No Redis SDK is required: Upstash exposes Redis commands over HTTPS, which is
 * a particularly good fit for serverless runtimes. Updates use an atomic Lua
 * compare-and-set so two writers never silently overwrite one another.
 */
import { generateCode } from "./codes";
import type { CounterMessage, CounterSession, Participant } from "./types";

/** A counter session is not a document. Idle sessions are discarded. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
/** Bound per-session memory/storage; a counter conversation is not a transcript archive. */
export const MAX_MESSAGES = 500;
const UPDATE_RETRIES = 8;
const REDIS_KEY_PREFIX = "tong-yuck:counter:session:v1:";

type Awaitable<T> = T | Promise<T>;

export interface CounterStoreStats {
  active: number;
  waiting: number;
  totalMessages: number;
}

export interface CounterStore {
  readonly kind: "memory" | "redis";
  readonly shared: boolean;
  create(input: { hostLang: string; deskLabel?: string }): Awaitable<CounterSession>;
  get(code: string): Awaitable<CounterSession | undefined>;
  update(
    code: string,
    mutate: (session: CounterSession) => void,
  ): Awaitable<CounterSession | undefined>;
  end(code: string): Awaitable<boolean>;
  /** Diagnostics only — counts, never content. */
  stats(): Awaitable<CounterStoreStats>;
}

class MemoryCounterStore implements CounterStore {
  readonly kind = "memory" as const;
  readonly shared = false;
  private readonly sessions = new Map<string, CounterSession>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Drop anything past its TTL. Called on every access; there is no timer to leak. */
  private sweep(): void {
    const cutoff = this.now() - SESSION_TTL_MS;
    for (const [code, session] of this.sessions) {
      if (session.lastActivityAt < cutoff) this.sessions.delete(code);
    }
  }

  create(input: { hostLang: string; deskLabel?: string }): CounterSession {
    this.sweep();
    let code = generateCode();
    for (let attempt = 0; attempt < UPDATE_RETRIES && this.sessions.has(code); attempt += 1) {
      code = generateCode();
    }

    const at = this.now();
    const session: CounterSession = {
      code,
      createdAt: at,
      lastActivityAt: at,
      state: "waiting",
      hostLang: input.hostLang,
      guestLang: null,
      deskLabel: input.deskLabel,
      messages: [],
      nextSeq: 1,
    };
    this.sessions.set(code, session);
    return cloneSession(session);
  }

  get(code: string): CounterSession | undefined {
    this.sweep();
    const session = this.sessions.get(code);
    return session ? cloneSession(session) : undefined;
  }

  update(
    code: string,
    mutate: (session: CounterSession) => void,
  ): CounterSession | undefined {
    this.sweep();
    const current = this.sessions.get(code);
    if (!current) return undefined;

    const session = cloneSession(current);
    mutate(session);
    session.lastActivityAt = this.now();
    boundMessages(session);
    this.sessions.set(code, session);
    return cloneSession(session);
  }

  end(code: string): boolean {
    return this.sessions.delete(code);
  }

  stats(): CounterStoreStats {
    this.sweep();
    return countSessions(this.sessions.values());
  }
}

export interface RedisConfig {
  url: string;
  token: string;
  source: "upstash" | "vercel-kv";
}

const REDIS_CREDENTIAL_PAIRS = [
  {
    urlSuffix: "UPSTASH_REDIS_REST_URL",
    tokenSuffix: "UPSTASH_REDIS_REST_TOKEN",
    source: "upstash" as const,
  },
  {
    urlSuffix: "KV_REST_API_URL",
    tokenSuffix: "KV_REST_API_TOKEN",
    source: "vercel-kv" as const,
  },
] as const;

const redisConfigFromKeys = (
  env: NodeJS.ProcessEnv,
  urlKey: string,
  tokenKey: string,
  source: RedisConfig["source"],
): RedisConfig | null => {
  const url = env[urlKey]?.trim() ?? "";
  const token = env[tokenKey]?.trim() ?? "";
  return url && token ? { url, token, source } : null;
};

const isRedisCredentialKey = (key: string): boolean =>
  REDIS_CREDENTIAL_PAIRS.some(
    ({ urlSuffix, tokenSuffix }) => key.endsWith(urlSuffix) || key.endsWith(tokenSuffix),
  );

interface RedisEnvelope {
  rev: number;
  session: CounterSession;
}

interface RedisResponse<T> {
  result?: T;
  error?: string;
}

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if tostring(decoded.rev) ~= ARGV[1] then return -1 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

class RedisCounterStore implements CounterStore {
  readonly kind = "redis" as const;
  readonly shared = true;

  constructor(
    private readonly config: RedisConfig,
    private readonly now: () => number = Date.now,
  ) {}

  private key(code: string): string {
    return `${REDIS_KEY_PREFIX}${code}`;
  }

  private async command<T>(args: Array<string | number>): Promise<T> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Counter Redis request failed (${response.status}).`);
    }

    const body = (await response.json()) as RedisResponse<T>;
    if (body.error) throw new Error(`Counter Redis error: ${body.error}`);
    return body.result as T;
  }

  async create(input: { hostLang: string; deskLabel?: string }): Promise<CounterSession> {
    for (let attempt = 0; attempt < UPDATE_RETRIES; attempt += 1) {
      const code = generateCode();
      const at = this.now();
      const session: CounterSession = {
        code,
        createdAt: at,
        lastActivityAt: at,
        state: "waiting",
        hostLang: input.hostLang,
        guestLang: null,
        deskLabel: input.deskLabel,
        messages: [],
        nextSeq: 1,
      };
      const envelope: RedisEnvelope = { rev: 1, session };
      const result = await this.command<string | null>([
        "SET",
        this.key(code),
        JSON.stringify(envelope),
        "NX",
        "PX",
        SESSION_TTL_MS,
      ]);
      if (result === "OK") return session;
    }

    throw new Error("Could not allocate a unique counter session code.");
  }

  async get(code: string): Promise<CounterSession | undefined> {
    const raw = await this.command<string | null>(["GET", this.key(code)]);
    if (!raw) return undefined;
    return parseEnvelope(raw).session;
  }

  async update(
    code: string,
    mutate: (session: CounterSession) => void,
  ): Promise<CounterSession | undefined> {
    const key = this.key(code);

    for (let attempt = 0; attempt < UPDATE_RETRIES; attempt += 1) {
      const raw = await this.command<string | null>(["GET", key]);
      if (!raw) return undefined;

      const current = parseEnvelope(raw);
      const session = cloneSession(current.session);
      mutate(session);
      session.lastActivityAt = this.now();
      boundMessages(session);

      const next: RedisEnvelope = { rev: current.rev + 1, session };
      const result = await this.command<number>([
        "EVAL",
        CAS_SCRIPT,
        1,
        key,
        current.rev,
        JSON.stringify(next),
        SESSION_TTL_MS,
      ]);

      if (result === 1) return session;
      if (result === 0) return undefined;
      // -1 means another request won the race. Read the new value and retry the
      // same mutation so no message or language update is lost.
      if (result !== -1) throw new Error("Counter Redis compare-and-set failed.");
    }

    throw new Error("Counter session was too busy to update safely.");
  }

  async end(code: string): Promise<boolean> {
    return (await this.command<number>(["DEL", this.key(code)])) > 0;
  }

  async stats(): Promise<CounterStoreStats> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const result = await this.command<[string | number, string[]]>([
        "SCAN",
        cursor,
        "MATCH",
        `${REDIS_KEY_PREFIX}*`,
        "COUNT",
        100,
      ]);
      cursor = String(result?.[0] ?? "0");
      for (const key of result?.[1] ?? []) keys.push(key);
    } while (cursor !== "0" && keys.length < 1000);

    if (keys.length === 0) return { active: 0, waiting: 0, totalMessages: 0 };

    const sessions = await Promise.all(
      keys.map(async (key) => {
        const raw = await this.command<string | null>(["GET", key]);
        if (!raw) return undefined;
        try {
          return parseEnvelope(raw).session;
        } catch {
          return undefined;
        }
      }),
    );

    return countSessions(sessions.filter((session): session is CounterSession => !!session));
  }
}

const cloneSession = (session: CounterSession): CounterSession =>
  JSON.parse(JSON.stringify(session)) as CounterSession;

const boundMessages = (session: CounterSession) => {
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }
};

const countSessions = (sessions: Iterable<CounterSession>): CounterStoreStats => {
  let active = 0;
  let waiting = 0;
  let totalMessages = 0;
  for (const session of sessions) {
    if (session.state === "active") active += 1;
    if (session.state === "waiting") waiting += 1;
    totalMessages += session.messages.length;
  }
  return { active, waiting, totalMessages };
};

const parseEnvelope = (raw: string): RedisEnvelope => {
  const parsed = JSON.parse(raw) as Partial<RedisEnvelope>;
  if (
    typeof parsed.rev !== "number" ||
    !parsed.session ||
    typeof parsed.session.code !== "string" ||
    !Array.isArray(parsed.session.messages)
  ) {
    throw new Error("Counter Redis session payload is malformed.");
  }
  return parsed as RedisEnvelope;
};

export function resolveCounterRedisConfig(
  env: NodeJS.ProcessEnv = process.env,
): RedisConfig | null {
  // First honour the canonical names. This keeps existing deployments stable
  // and makes the intended configuration unambiguous.
  for (const { urlSuffix, tokenSuffix, source } of REDIS_CREDENTIAL_PAIRS) {
    const exact = redisConfigFromKeys(env, urlSuffix, tokenSuffix, source);
    if (exact) return exact;
  }

  // Vercel Marketplace resources may be connected with a custom environment
  // variable prefix. For example, COUNTER_UPSTASH_REDIS_REST_URL is the same
  // credential as UPSTASH_REDIS_REST_URL. Match URL/token pairs by their shared
  // prefix so a perfectly valid linked resource does not silently fall back to
  // per-instance memory.
  const keys = Object.keys(env).sort();
  for (const { urlSuffix, tokenSuffix, source } of REDIS_CREDENTIAL_PAIRS) {
    for (const urlKey of keys) {
      if (urlKey === urlSuffix || !urlKey.endsWith(urlSuffix)) continue;
      const prefix = urlKey.slice(0, -urlSuffix.length);
      const prefixed = redisConfigFromKeys(env, urlKey, `${prefix}${tokenSuffix}`, source);
      if (prefixed) return prefixed;
    }
  }

  return null;
}

export function counterStoreInfo(env: NodeJS.ProcessEnv = process.env) {
  const redis = resolveCounterRedisConfig(env);
  const hasPartialRedisConfig = Object.keys(env).some(isRedisCredentialKey);
  return {
    kind: redis ? ("redis" as const) : ("memory" as const),
    shared: !!redis,
    configured: !!redis,
    source: redis?.source ?? null,
    warning:
      redis || !hasPartialRedisConfig
        ? null
        : "Redis session storage is only partially configured; matching URL and token credentials are required.",
  };
}

/** Append a message and assign its sequence number. */
export function appendMessage(
  session: CounterSession,
  message: Omit<CounterMessage, "seq">,
): CounterMessage {
  const seq = session.nextSeq;
  session.nextSeq += 1;
  const stored: CounterMessage = { ...message, seq };
  session.messages.push(stored);
  return stored;
}

/** Replace a message in place, e.g. when a pending translation completes. */
export function replaceMessage(session: CounterSession, message: CounterMessage): void {
  const at = session.messages.findIndex((m) => m.id === message.id);
  if (at !== -1) session.messages[at] = message;
}

/** The language a message from `from` should be translated INTO. */
export const targetLangFor = (session: CounterSession, from: Participant): string =>
  from === "host" ? (session.guestLang ?? "en-US") : session.hostLang;

export const sourceLangFor = (session: CounterSession, from: Participant): string =>
  from === "host" ? session.hostLang : (session.guestLang ?? "en-US");

let store: CounterStore | null = null;
export const counterStore = (): CounterStore => {
  if (store) return store;
  const redis = resolveCounterRedisConfig();
  store = redis ? new RedisCounterStore(redis) : new MemoryCounterStore();
  return store;
};

/** Test seam. */
export const __setCounterStore = (next: CounterStore | null) => {
  store = next;
};
export const createMemoryStore = (now?: () => number) => new MemoryCounterStore(now);
export const createRedisStore = (config: RedisConfig, now?: () => number) =>
  new RedisCounterStore(config, now);
