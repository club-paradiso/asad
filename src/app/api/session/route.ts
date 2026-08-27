/**
 * Session authorisation for the paid routes.
 *
 *   GET  /api/session   — is this deployment gated, and am I already through?
 *   POST /api/session   — mint a session token, supplying the access key if gated
 *
 * The session token is not an identity. It is a cheap, server-issued proof that
 * this browser loaded the application, which is what turns "anyone with the URL
 * can spend the owner's OpenRouter balance" into "anyone who loaded the app can,
 * at the configured rate, until the access key stops them".
 *
 * Both cookies are HttpOnly. No secret this route handles is ever readable by
 * script, echoed in a response body, or included in a log line.
 */
import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";
import {
  ACCESS_COOKIE,
  SESSION_COOKIE,
  clientAddress,
  guardInferenceRoute,
  hasAccess,
  issueSessionToken,
  limiterFor,
  secretsMatch,
} from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One long service, matching the token's own lifetime. */
const COOKIE_MAX_AGE = 4 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
  secure: process.env.NODE_ENV === "production",
} as const;

export async function GET(request: Request) {
  const env = appEnv();
  return NextResponse.json(
    { gated: env.access.enabled, authorised: hasAccess(request) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // Minting is itself rate-limited by address: without this, the access gate
  // becomes an oracle to brute-force at line speed.
  const verdict = limiterFor("sttToken").check(`session:${clientAddress(request)}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  const env = appEnv();
  const body = await request.json().catch(() => ({}));
  const supplied = typeof (body as { accessKey?: unknown })?.accessKey === "string"
    ? (body as { accessKey: string }).accessKey
    : undefined;

  const alreadyThrough = hasAccess(request);
  const keyMatches = !!env.access.key && !!supplied && secretsMatch(supplied, env.access.key);

  if (env.access.enabled && !alreadyThrough && !keyMatches) {
    return NextResponse.json(
      { error: "That access key was not accepted.", gated: true },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true, gated: env.access.enabled });
  response.cookies.set(SESSION_COOKIE, issueSessionToken(), cookieOptions);
  if (env.access.enabled && keyMatches) {
    response.cookies.set(ACCESS_COOKIE, env.access.key!, cookieOptions);
  }
  return response;
}

/** Re-exported so route tests exercise the same guard the paid routes use. */
export { guardInferenceRoute };
