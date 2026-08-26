"use client";

/**
 * Browser side of the session gate.
 *
 * The paid routes require a server-issued session token, held in an HttpOnly
 * cookie this file never sees. All it does is ask for one, and notice when the
 * server says the one we have is no longer good.
 *
 * The retry matters more than it looks. A token lasts four hours and a service
 * can run longer, and a serverless instance can restart under a live session
 * and lose its signing secret. Without a single silent re-mint, either of those
 * ends interpretation mid-sentence with a 401. With it, the interpreter never
 * finds out.
 */

export interface SessionState {
  /** Whether this deployment requires an access key. */
  gated: boolean;
  /** Whether this browser is through the gate. */
  authorised: boolean;
}

/** Ask whether a key is needed before showing anyone a key prompt. */
export async function readSessionState(): Promise<SessionState> {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) return { gated: false, authorised: true };
    return (await response.json()) as SessionState;
  } catch {
    // Offline. Demo mode needs no session at all, so claiming the gate is shut
    // would block the one thing that still works.
    return { gated: false, authorised: true };
  }
}

/**
 * Mint a session token, optionally presenting the access key.
 *
 * Returns false when the deployment is gated and the key was refused.
 */
export async function openSession(accessKey?: string): Promise<boolean> {
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(accessKey ? { accessKey } : {}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * `fetch` for the paid routes: mint on demand, retry a 401 exactly once.
 *
 * Exactly once, deliberately. A retry loop against an access-gated deployment
 * is how a forgotten key turns into a hammering client.
 */
export async function guardedFetch(input: string, init: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401) return first;

  // The body has already been consumed by the first attempt if it was a
  // stream; the callers here all pass a string, which is replayable.
  if (!(await openSession())) return first;
  return fetch(input, init);
}
