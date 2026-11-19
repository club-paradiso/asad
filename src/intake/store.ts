import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveCounterRedisConfig } from "@/counter/store";

export const INTAKE_TTL_MS = 2 * 60 * 60 * 1000;
export const INTAKE_MAX_ENTRIES = 60;
const PREFIX = "asad:intake:session:v1:";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;
const EVAL_RETRIES = 6;

export const LANGUAGES = ["KO","EN","ZH-CN","ID","HI","VI","JA","TH","RU","UZ","MN","NE"] as const;
export type IntakeLanguage = typeof LANGUAGES[number];
export type Booking = "yes" | "no" | "unsure";
export type Verification = "unchecked" | "confirmed" | "unclear" | "exempt";
export type Ticket = "pending" | "held" | "issued";

export type IntakeEntry = {
  seq: number;
  requestId: string;
  language: IntakeLanguage;
  serviceIndex: number;
  booking: Booking;
  receivedAt: number;
  verification: Verification;
  ticket: Ticket;
};

/** What the visitor screen shows right now, mirrored to the staff desk. Indices only, no free text. */
export const LIVE_STEPS = ["language", "services", "review", "sent"] as const;
export type LiveStep = typeof LIVE_STEPS[number];
export type IntakeLive = {
  step: LiveStep;
  language?: IntakeLanguage;
  serviceIndex?: number;
  booking?: Booking;
  seq?: number;
  updatedAt: number;
};

export type IntakeSession = {
  live?: IntakeLive;
  code: string;
  staffHash: string;
  createdAt: number;
  expiresAt: number;
  entries: IntakeEntry[];
  nextSeq: number;
};

export type PublicEntry = Omit<IntakeEntry, "requestId">;

export const validCode = (input: string): boolean => CODE_PATTERN.test(input);
export const validLanguage = (input: unknown): input is IntakeLanguage =>
  typeof input === "string" && (LANGUAGES as readonly string[]).includes(input);

const makeCode = () => Array.from(randomBytes(10), n => ALPHABET[n & 31]).join("");
export const createStaffToken = () => randomBytes(32).toString("base64url");
export const staffHash = (token: string) =>
  createHash("sha256").update("asad/intake/desk/v1:" + token).digest("hex");

export function isStaff(session: IntakeSession, token: string | null): boolean {
  if (!token || token.length > 128) return false;
  const expected = Buffer.from(session.staffHash, "hex");
  const actual = Buffer.from(staffHash(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const clone = (s: IntakeSession): IntakeSession => JSON.parse(JSON.stringify(s)) as IntakeSession;
export const publicEntries = (s: IntakeSession): PublicEntry[] =>
  s.entries.map(({ requestId: _discard, ...entry }) => entry);

export type Mutation = (session: IntakeSession) => void | false;
export interface IntakeStore {
  readonly shared: boolean;
  create(): Promise<{ session: IntakeSession; staffToken: string }>;
  read(code: string): Promise<IntakeSession | undefined>;
  modify(code: string, mutation: Mutation): Promise<IntakeSession | undefined>;
  remove(code: string): Promise<boolean>;
}

export function createMemoryIntakeStore(now: () => number = Date.now): IntakeStore {
  const sessions = new Map<string, IntakeSession>();
  const read = (code: string): IntakeSession | undefined => {
    const s = sessions.get(code);
    if (!s) return undefined;
    if (s.expiresAt <= now()) { sessions.delete(code); return undefined; }
    return clone(s);
  };
  return {
    shared: false,
    async create() {
      for (let i = 0; i < 10; i++) {
        const code = makeCode();
        if (read(code)) continue;
        const staffToken = createStaffToken(), at = now();
        const session: IntakeSession = {
          code, staffHash: staffHash(staffToken), createdAt: at,
          expiresAt: at + INTAKE_TTL_MS, entries: [], nextSeq: 1,
        };
        sessions.set(code, clone(session));
        return { session, staffToken };
      }
      throw new Error("Session code allocation failed");
    },
    async read(code) { return read(code); },
    async modify(code, mutation) {
      const found = read(code);
      if (!found) return undefined;
      if (mutation(found) === false) return found;
      sessions.set(code, clone(found));
      return clone(found);
    },
    async remove(code) { return sessions.delete(code); },
  };
}

type RedisResponse<T> = { result?: T; error?: string };
const CAS = [
  "local raw=redis.call('GET',KEYS[1])",
  "if not raw then return 0 end",
  "local doc=cjson.decode(raw)",
  "if tonumber(doc.rev) ~= tonumber(ARGV[1]) then return -1 end",
  "redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL')",
  "return 1",
].join("\n");

function createRedisIntakeStore(config: { url: string; token: string }): IntakeStore {
  const command = async <T,>(args: Array<string | number>): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          authorization: "Bearer " + config.token,
          "content-type": "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error("Intake store unavailable");
      const payload = await response.json() as RedisResponse<T>;
      if (payload.error) throw new Error("Intake store error");
      return payload.result as T;
    } finally { clearTimeout(timeout); }
  };
  const key = (code: string) => PREFIX + code;
  const parse = (text: string): { rev: number; session: IntakeSession } => {
    const v = JSON.parse(text) as { rev: number; session: IntakeSession };
    if (!Number.isSafeInteger(v.rev) || !v.session || !Array.isArray(v.session.entries)) {
      throw new Error("Invalid intake store record");
    }
    return v;
  };
  return {
    shared: true,
    async create() {
      for (let i = 0; i < 10; i++) {
        const code = makeCode(), staffToken = createStaffToken(), at = Date.now();
        const session: IntakeSession = {
          code, staffHash: staffHash(staffToken), createdAt: at,
          expiresAt: at + INTAKE_TTL_MS, entries: [], nextSeq: 1,
        };
        const ok = await command<string | null>([
          "SET", key(code), JSON.stringify({ rev: 1, session }), "NX", "PX", INTAKE_TTL_MS,
        ]);
        if (ok === "OK") return { session, staffToken };
      }
      throw new Error("Session code allocation failed");
    },
    async read(code) {
      const raw = await command<string | null>(["GET", key(code)]);
      return raw ? parse(raw).session : undefined;
    },
    async modify(code, mutation) {
      for (let i = 0; i < EVAL_RETRIES; i++) {
        const raw = await command<string | null>(["GET", key(code)]);
        if (!raw) return undefined;
        const current = parse(raw), next = clone(current.session);
        if (mutation(next) === false) return current.session;
        const ok = await command<number>([
          "EVAL", CAS, 1, key(code), current.rev,
          JSON.stringify({ rev: current.rev + 1, session: next }),
        ]);
        if (ok === 1) return next;
        if (ok === 0) return undefined;
        if (ok !== -1) throw new Error("Store compare-and-swap failure");
      }
      throw new Error("Concurrent intake modification");
    },
    async remove(code) { return (await command<number>(["DEL", key(code)])) > 0; },
  };
}

let activeStore: IntakeStore | null = null;
export function intakeStore(): IntakeStore | null {
  if (activeStore) return activeStore;
  const redis = resolveCounterRedisConfig();
  if (redis) { activeStore = createRedisIntakeStore(redis); return activeStore; }
  // A serverless deployment without shared state MUST NOT pretend to offer cross-device delivery.
  if (process.env.NODE_ENV === "production") return null;
  activeStore = createMemoryIntakeStore();
  return activeStore;
}

/** Test seam; never call from a production request. */
export function __setIntakeStore(store: IntakeStore | null) { activeStore = store; }
