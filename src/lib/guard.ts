/**
 * Route protection for endpoints that spend money.
 *
 * The scenario this exists for is concrete: tong-yuck is deployed with a billed
 * `OPENROUTER_API_KEY`, someone finds the URL, and `POST /api/interpret` is an
 * open endpoint that turns their curl loop into the owner's invoice. Before
 * this module there was nothing between those two facts.
 *
 * Four layers, cheapest first, because the point is to reject abuse before it
 * reaches a provider:
 *
 *   1. **Access gate** — optional shared secret for a private deployment.
 *      When `APP_ACCESS_KEY` is set, nothing paid answers without it.
 *   2. **Same-origin** — a browser cannot forge `Origin`, so this stops
 *      drive-by scripts from other sites outright. It does not stop a
 *      determined attacker with curl, and is not claimed to.
 *   3. **Body size** — bounds what one accepted request can cost in tokens.
 *   4. **Rate limit** — per session first, then per source address, bounding
 *      what an accepted client can spend over time.
 *
 * What this is NOT: an identity system. There are no users, no accounts and no
 * sessions that outlive a browser tab, because none of those would make the
 * bill smaller and all of them would make the product worse.
 */
import "server-only";
import { NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appEnv } from "./env";
import { RequestRateLimiter, type RateLimitRule } from "./rate-limit";

/* -------------------------------------------------------------------------- */
/* Session tokens                                                              */
/* -------------------------------------------------------------------------- */

export const SESSION_COOKIE = "tong-yuck-session";
export const ACCESS_COOKIE = "tong-yuck-access";

/** How long a browser session token stays valid. One long service. */
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Signing secret, and what its absence costs.
 *
 * Derived from `SESSION_SECRET` (or `APP_ACCESS_KEY`, which doubles as one)
 * when either is set. Otherwise it is random per process.
 *
 * THAT DISTINCTION IS LOAD-BEARING ON SERVERLESS. A per-process secret is fine
 * on a single server. On Vercel — the deployment target this project
 * documents — requests are spread across instances, so a token minted by one
 * instance fails verification on the next. Enforcing sessions under those
 * conditions does not make the deployment stricter; it breaks it, continuously
 * and invisibly, with the console re-minting a token that the following
 * request rejects again.
 *
 * So enforcement is conditional. With a stable secret, a valid session is
 * REQUIRED on the paid routes. Without one, sessions are still issued and
 * still used to key rate limits per browser — which is strictly better than
 * keying on an address shared by everyone behind one NAT — but a verification
 * failure does not refuse the request. Same-origin and per-address limits
 * still apply, and `/diagnostics` says which mode is in force rather than
 * letting a deployer assume the stronger one.
 */
let signingSecret: Buffer | null = null;
function secret(): Buffer {
  if (signingSecret) return signingSecret;
  const configured = appEnv().access.sessionSecret;
  signingSecret = configured
    ? createHmac("sha256", "tong-yuck/session").update(configured).digest()
    : randomBytes(32);
  return signingSecret;
}

export type SessionEnforcement =
  /** A stable secret exists; an invalid session token is refused. */
  | "enforced"
  /** No stable secret; tokens key rate limits but cannot gate a request. */
  | "best-effort";

/** Whether session tokens can be trusted across instances. */
export const sessionEnforcement = (): SessionEnforcement =>
  appEnv().access.sessionSecret ? "enforced" : "best-effort";

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

/** Mint a token this server will accept for `SESSION_TTL_MS`. */
export function issueSessionToken(now: number = Date.now()): string {
  const payload = `${now + SESSION_TTL_MS}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

/** Whether a token was minted by this server and has not expired. */
export function verifySessionToken(token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const payload = token.slice(0, lastDot);
  const provided = token.slice(lastDot + 1);
  const expected = sign(payload);

  // Length-checked before the constant-time compare: timingSafeEqual throws on
  // a length mismatch, and the length is not the secret.
  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return false;

  const expiresAt = Number(payload.split(".")[0]);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/* -------------------------------------------------------------------------- */
/* Access gate                                                                 */
/* -------------------------------------------------------------------------- */

/** Constant-time comparison of two secrets of any length. */
export function secretsMatch(a: string, b: string): boolean {
  // Hashing first makes the comparison length-independent without leaking the
  // length through an early return.
  const ha = createHmac("sha256", "tong-yuck/compare").update(a).digest();
  const hb = createHmac("sha256", "tong-yuck/compare").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Whether this request carries the configured access key. */
export function hasAccess(request: Request): boolean {
  const configured = appEnv().access.key;
  if (!configured) return true; // No gate configured.
  const cookie = readCookie(request, ACCESS_COOKIE);
  return !!cookie && secretsMatch(cookie, configured);
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Origin                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether this request came from a page this deployment served.
 *
 * Deliberately permissive about MISSING origin headers on same-origin fetches
 * from older browsers, and strict about PRESENT ones that disagree. A browser
 * cannot forge `Origin`; that is the whole security value, and it is
 * meaningful precisely against the case this defends — someone else's page
 * spending our credits.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = expectedHost(request);
  if (!host) return false;

  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // No Origin and no Referer: a same-origin `fetch` in some browsers, and also
  // plain curl. Allowed here, and bounded by the rate limiter rather than by
  // pretending this check can tell them apart.
  return true;
}

/**
 * The host this request was actually addressed to.
 *
 * Three sources, in descending trustworthiness, because no single one is
 * always present: `Host` is absent behind some proxies and is a forbidden
 * header the Fetch API strips outright; `X-Forwarded-Host` is what a proxy
 * substitutes; and the request URL is what the server itself resolved. Reading
 * only `Host` meant the origin check silently failed closed wherever it was
 * missing, which is a denial of service dressed up as security.
 */
function expectedHost(request: Request): string | null {
  const direct = request.headers.get("host") ?? request.headers.get("x-forwarded-host");
  if (direct) return direct.split(",")[0].trim();
  try {
    return new URL(request.url).host || null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Body                                                                        */
/* -------------------------------------------------------------------------- */

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Read a JSON body with a hard byte ceiling.
 *
 * `Content-Length` is checked first because rejecting before reading is free,
 * and the stream is measured as it arrives because `Content-Length` is a claim
 * rather than a fact.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: "Request body is too large." };
  }

  let text: string;
  try {
    text = await readCapped(request, maxBytes);
  } catch {
    return { ok: false, status: 413, error: "Request body is too large." };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body." };
  }
}

async function readCapped(request: Request, maxBytes: number): Promise<string> {
  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("body too large");
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/* -------------------------------------------------------------------------- */
/* Limiters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Per-route budgets.
 *
 * Sized from the measured live workload — ~11 interpretation calls a minute —
 * with headroom for the burst at the start of a segment. A real interpreter
 * never approaches these; a script does so immediately.
 */
export const RATE_RULES = {
  /** Per browser session. */
  interpretSession: { limit: 60, windowMs: 60_000 },
  /** Per source address, which may legitimately carry a few interpreters. */
  interpretAddress: { limit: 180, windowMs: 60_000 },
  /** Prep is a considered action, not a stream. */
  prep: { limit: 6, windowMs: 60_000 },
  /** A counter exchange is turn-taking at human speed. */
  counter: { limit: 30, windowMs: 60_000 },
  /** Minting recogniser credentials. One per session start. */
  sttToken: { limit: 10, windowMs: 60_000 },
  /** Batch fallback is intentionally scarce: one short Counter utterance. */
  sttHf: { limit: 6, windowMs: 60_000 },
  /** The health check calls a provider; it is not a page-load endpoint. */
  health: { limit: 4, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

const limiters = new Map<string, RequestRateLimiter>();

export function limiterFor(name: keyof typeof RATE_RULES): RequestRateLimiter {
  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = new RequestRateLimiter(RATE_RULES[name]);
    limiters.set(name, limiter);
  }
  return limiter;
}

/** Test seam. */
export const __resetGuards = () => {
  for (const limiter of limiters.values()) limiter.reset();
  limiters.clear();
  signingSecret = null;
};

/**
 * Best-effort client address.
 *
 * Trusts `x-forwarded-for` because on Vercel the platform sets it and a client
 * cannot override it. On a deployment where that is not true this degrades to
 * a shared bucket, which fails toward throttling rather than toward spending.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/* -------------------------------------------------------------------------- */
/* The guard                                                                   */
/* -------------------------------------------------------------------------- */

export interface GuardOptions {
  /** Which limiters to apply, in order. */
  limits: Array<{ rule: keyof typeof RATE_RULES; by: "session" | "address" }>;
  maxBodyBytes: number;
  /** Whether a valid session token is required. Paid routes: yes. */
  requireSession?: boolean;
}

export type GuardResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Run every check, in cost order, and return the parsed body or the refusal.
 *
 * Refusals never explain more than they must. "Rate limited" is useful to a
 * legitimate client and useless to someone probing; the distinction between
 * "no access key" and "wrong access key" is the opposite.
 */
export async function guardInferenceRoute(
  request: Request,
  options: GuardOptions,
): Promise<GuardResult> {
  const deny = (status: number, error: string, headers?: Record<string, string>): GuardResult => ({
    ok: false,
    response: NextResponse.json({ error }, { status, headers }),
  });

  if (!hasAccess(request)) {
    return deny(401, "This deployment is private. Enter the access key to continue.");
  }

  if (!isSameOrigin(request)) {
    return deny(403, "Cross-origin requests are not accepted.");
  }

  const session = readCookie(request, SESSION_COOKIE);
  if (
    options.requireSession &&
    sessionEnforcement() === "enforced" &&
    !verifySessionToken(session)
  ) {
    // 401 rather than 403: the client's correct response is to mint a token
    // and retry once, which the console does automatically.
    return deny(401, "Session authorisation required.");
  }

  const address = clientAddress(request);
  for (const limit of options.limits) {
    const key = limit.by === "session" ? (session ?? `addr:${address}`) : address;
    const verdict = limiterFor(limit.rule).check(`${limit.rule}:${key}`);
    if (!verdict.allowed) {
      return deny(429, "Too many requests. Slow down and try again shortly.", {
        "retry-after": String(verdict.retryAfterSeconds),
        "x-ratelimit-limit": String(verdict.limit),
        "x-ratelimit-remaining": "0",
      });
    }
  }

  const body = await readJsonBody(request, options.maxBodyBytes);
  if (!body.ok) return deny(body.status, body.error);

  return { ok: true, body: body.value };
}
