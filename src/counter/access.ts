/** Ephemeral capability credentials for one Counter session participant. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CounterSession, Participant } from "./types";
import { COUNTER_TOKEN_HEADER } from "./access-shared";

export { COUNTER_TOKEN_HEADER } from "./access-shared";

export interface CounterCapability {
  token: string;
  hash: string;
}

/**
 * The four-character desk code is an address that is easy to type, not a
 * password. Every participant also receives an unguessable capability that is
 * required to poll, send, or end that particular conversation.
 */
export function issueCounterCapability(): CounterCapability {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashCounterToken(token) };
}

export function hashCounterToken(token: string): string {
  return createHash("sha256").update(`asad/counter-capability/v1:${token}`).digest("base64url");
}

export function counterTokenFrom(request: Request): string | undefined {
  const token = request.headers.get(COUNTER_TOKEN_HEADER)?.trim();
  return token || undefined;
}

export function participantForToken(
  session: CounterSession,
  token: string | undefined,
): Participant | null {
  if (!token) return null;
  const actual = hashCounterToken(token);
  if (safeHashEqual(actual, session.hostTokenHash)) return "host";
  if (session.guestTokenHash && safeHashEqual(actual, session.guestTokenHash)) return "guest";
  return null;
}

function safeHashEqual(a: string, b: string | undefined): boolean {
  if (!b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
