/**
 * Request handling shared by the Remote Microphone routes.
 *
 * These routes are NOT inference routes and deliberately do not accept the
 * app's session cookie as authority for anything but creating a pairing. Every
 * other request is authorised by a pairing-scoped capability token in a custom
 * header, which:
 *
 *  - cannot be sent cross-site by a form or an <img>, so CSRF does not apply;
 *  - grants exactly one role in exactly one pairing, never general ASAD access;
 *  - is verified against a hash, in constant time.
 *
 * Same-origin checks, bounded bodies and two-layer rate limits (process-local
 * floor plus shared Redis counters when available) still run first.
 */
import "server-only";
import { NextResponse } from "next/server";
import {
  RATE_RULES,
  clientAddress,
  isSameOrigin,
  limiterFor,
  readJsonBody,
} from "@/lib/guard";
import { checkSharedRateLimits, type SharedRateLimitCheck } from "@/lib/shared-rate-limit";
import { REMOTE_MIC_TOKEN_HEADER, type RemoteMicErrorCode } from "./protocol";
import { remoteMicStore, type RemoteMicStore } from "./store";

const NO_STORE = { "cache-control": "no-store" } as const;

export function remoteMicError(
  status: number,
  code: RemoteMicErrorCode,
  error: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json({ error, code }, { status, headers: { ...NO_STORE, ...headers } });
}

export function remoteMicJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function tokenFrom(request: Request): string | undefined {
  const value = request.headers.get(REMOTE_MIC_TOKEN_HEADER)?.trim();
  return value && value.length <= 128 ? value : undefined;
}

type RemoteMicRule =
  | "remoteMicCreate"
  | "remoteMicClaim"
  | "remoteMicSignal"
  | "remoteMicSignalAddress"
  | "remoteMicRelay"
  | "remoteMicRelayAddress";

/** Same-origin, then rate limits (local floor + shared), then an optional bounded body. */
export async function guardRemoteMic(
  request: Request,
  options: {
    limits: Array<{ rule: RemoteMicRule; key: string }>;
    maxBodyBytes?: number;
    /** Also check the shared (store-backed) counters. Off for relay audio frames. */
    shared?: boolean;
  },
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  if (!isSameOrigin(request)) {
    return { ok: false, response: remoteMicError(403, "CROSS_ORIGIN", "Cross-origin requests are not accepted.") };
  }

  const shared: SharedRateLimitCheck[] = [];
  for (const limit of options.limits) {
    const verdict = limiterFor(limit.rule).check(`${limit.rule}:${limit.key}`);
    if (!verdict.allowed) {
      return {
        ok: false,
        response: remoteMicError(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.", {
          "retry-after": String(verdict.retryAfterSeconds),
        }),
      };
    }
    shared.push({ name: limit.rule, key: limit.key, rule: RATE_RULES[limit.rule] });
  }
  const verdicts = options.shared === false ? null : await checkSharedRateLimits(shared);
  const refused = verdicts?.find((verdict) => !verdict.allowed);
  if (refused) {
    return {
      ok: false,
      response: remoteMicError(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again.", {
        "retry-after": String(refused.retryAfterSeconds),
      }),
    };
  }

  if (options.maxBodyBytes === undefined) return { ok: true, body: undefined };
  const body = await readJsonBody(request, options.maxBodyBytes);
  if (!body.ok) return { ok: false, response: remoteMicError(body.status, "INVALID_REQUEST", body.error) };
  return { ok: true, body: body.value };
}

/** Rate-limit keys: the token is hashed by the shared limiter before storage. */
export const signalLimits = (request: Request, token: string | undefined) => [
  { rule: "remoteMicSignal" as const, key: token ?? `addr:${clientAddress(request)}` },
  { rule: "remoteMicSignalAddress" as const, key: clientAddress(request) },
];

export const relayLimits = (request: Request, token: string | undefined) => [
  { rule: "remoteMicRelay" as const, key: token ?? `addr:${clientAddress(request)}` },
  { rule: "remoteMicRelayAddress" as const, key: clientAddress(request) },
];

/**
 * The store, or an explicit configuration error.
 *
 * On Vercel, a pairing in one function instance's memory is invisible to the
 * next request — the phone would "join" a session that does not exist. Never
 * pretend: refuse with a code the launcher turns into setup guidance.
 */
export function availableStore():
  | { ok: true; store: RemoteMicStore }
  | { ok: false; response: NextResponse } {
  const store = remoteMicStore();
  if (process.env.VERCEL === "1" && !store.shared) {
    return {
      ok: false,
      response: remoteMicError(
        503,
        "SHARED_STORE_REQUIRED",
        "Remote microphone pairing needs shared storage on this deployment. Connect Upstash Redis (or Vercel KV) to the project and redeploy.",
      ),
    };
  }
  return { ok: true, store };
}

/** Store failures are reported as unavailability, never with the store's own message. */
export function storeUnavailable() {
  return remoteMicError(503, "STORE_UNAVAILABLE", "Remote microphone signalling is temporarily unavailable.");
}
