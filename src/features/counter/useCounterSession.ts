"use client";

/**
 * Counter session client.
 *
 * Short polling with a sequence cursor. Turn-taking at a counter does not need
 * sub-second delivery, and polling works everywhere — including serverless,
 * where a long-lived SSE connection does not survive. The cadence adapts to
 * the conversation (see `polling.ts`): fast while people are exchanging turns,
 * relaxed once the desk goes quiet.
 *
 * Message sends are queued rather than UI-locked. The user can type, tap the
 * microphone, and submit the next turn while the previous translation is still
 * running; network requests are still executed in order so conversational
 * context and server sequence numbers remain deterministic. Each send is shown
 * immediately as a local, still-translating message and replaced by the
 * server's copy when it answers — or kept on screen as failed, text intact,
 * when every retry is exhausted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { guardedFetch } from "@/lib/session-client";
import { COUNTER_TOKEN_HEADER } from "@/counter/access-shared";
import type { CounterMessage, CounterMessageAction, Participant, SessionView } from "@/counter/types";
import {
  LOCAL_SEQ_BASE,
  localMessageId,
  type ClientCounterMessage,
  type LocalMessageState,
} from "./client-message";
import { pollIntervalFor } from "./polling";

const SEND_RETRY_DELAYS_MS = [0, 400, 1100] as const;
/**
 * Longer than the server's whole-turn translation budget plus a generous
 * network allowance. A request that has not answered by then is stuck in the
 * network, not the model, and the idempotency key makes retrying it safe.
 */
export const SEND_TIMEOUT_MS = 20_000;

export interface SendInput {
  text: string;
  source: "voice" | "text" | "quick-phrase" | "confirm";
  rephraseOf?: string;
  action?: CounterMessageAction;
  actionOf?: string;
}

export interface EndOptions {
  /** Leave Counter Mode after the server session has been discarded. */
  leave?: boolean;
}

export interface CounterSessionOptions {
  /**
   * Which participant this device is. Lets a sent message be shown locally,
   * as the sender's own, before the server has stored it.
   */
  role?: Participant;
}

/**
 * Who hung up.
 *
 * `"self"` is this device's own End button; `"remote"` is the session being
 * gone from the server — the other participant ended it, or it expired.
 * `"unauthorised"` is the server refusing this device's capability, which
 * happens when a stored token outlives its session. The surfaces need the
 * difference: an automatic exit is right when the conversation was taken away,
 * and wrong when this device ended it in order to stay and start the next one.
 */
export type CounterEndReason = "self" | "remote" | "unauthorised";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const newMessageRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
};

const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

export function retryAfterMs(response: Response, now = Date.now()): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(raw) - now;
  if (!Number.isFinite(delay)) return null;
  return Math.min(60_000, Math.max(0, Math.ceil(delay)));
}

/** Whether two polls describe the same session, so React is not asked to re-render for nothing. */
const sameView = (a: SessionView | null, b: SessionView): boolean =>
  !!a &&
  a.seq === b.seq &&
  a.state === b.state &&
  a.guestLang === b.guestLang &&
  a.guestPresent === b.guestPresent &&
  a.profileId === b.profileId &&
  a.deskLabel === b.deskLabel &&
  b.messages.length === 0;

export function useCounterSession(
  code: string | null,
  participantToken: string | null,
  options: CounterSessionOptions = {},
) {
  const router = useRouter();
  const { role } = options;

  const [session, setSession] = useState<SessionView | null>(null);
  const [messages, setMessages] = useState<ClientCounterMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  /** Null while the session is live; otherwise how it finished. */
  const [endedBy, setEndedBy] = useState<CounterEndReason | null>(null);

  const cursor = useRef(0);
  const stopped = useRef(false);
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSends = useRef(0);
  const lastChangeAt = useRef(0);
  const lastView = useRef<SessionView | null>(null);
  const localSeq = useRef(0);
  const sessionRef = useRef<SessionView | null>(null);
  /** Re-plan the next poll without waiting for the current timer. */
  const wake = useRef<(() => void) | null>(null);

  // A different room code is a different consultation, and the desk moves
  // between them without ever remounting: "다음 손님" ends one session and opens
  // the next on the same screen. Everything scoped to the old code goes with
  // it, before a frame of the last visitor can be painted into the new one.
  const [activeCode, setActiveCode] = useState(code);
  if (activeCode !== code) {
    setActiveCode(code);
    setSession(null);
    setMessages([]);
    setEndedBy(null);
  }

  /**
   * Merge a batch, replacing by id so a resend does not duplicate, and
   * retiring any local copy the server has now answered for.
   */
  const merge = useCallback((incoming: CounterMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const byId = new Map<string, ClientCounterMessage>(current.map((m) => [m.id, m]));
      for (const message of incoming) {
        if (message.clientRequestId) byId.delete(localMessageId(message.clientRequestId));
        byId.set(message.id, message);
      }
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const patchLocal = useCallback(
    (requestId: string, patch: Partial<ClientCounterMessage>) => {
      const id = localMessageId(requestId);
      setMessages((current) =>
        current.some((m) => m.id === id)
          ? current.map((m) => (m.id === id ? { ...m, ...patch } : m))
          : current,
      );
    },
    [],
  );

  const removeLocal = useCallback((requestId: string) => {
    const id = localMessageId(requestId);
    setMessages((current) => (current.some((m) => m.id === id) ? current.filter((m) => m.id !== id) : current));
  }, []);

  const leaveCounterMode = useCallback(() => {
    // Browsers generally refuse to close tabs they did not open themselves, so
    // leaving Counter Mode means going back to the app. This is the immediate
    // path for an explicit End button; the automatic exit after the other side
    // hangs up is scheduled by the surfaces through `scheduleCounterExit`.
    router.replace("/");
  }, [router]);

  const poll = useCallback(async () => {
    if (!code || !participantToken || stopped.current) return;
    try {
      const response = await fetch(
        `/api/counter/session?code=${encodeURIComponent(code)}&since=${cursor.current}`,
        {
          cache: "no-store",
          headers: { [COUNTER_TOKEN_HEADER]: participantToken },
        },
      );
      if (response.status === 404) {
        // The other participant ended the consultation (or the session expired).
        // Raise a terminal state only; each surface decides how it leaves.
        setEndedBy("remote");
        setConnected(false);
        stopped.current = true;
        return;
      }
      if (response.status === 401) {
        // This device's capability is not good for this session — typically a
        // stored token from a consultation that has since been replaced.
        setEndedBy("unauthorised");
        setConnected(false);
        stopped.current = true;
        return;
      }
      if (!response.ok) throw new Error(`Poll failed (${response.status})`);

      const data = (await response.json()) as { session: SessionView };
      // A poll already in flight when this device hung up must not resurrect
      // the conversation: the exit the surfaces schedule keys off this state.
      if (stopped.current) return;
      const changed = !sameView(lastView.current, data.session);
      if (changed) {
        lastView.current = data.session;
        sessionRef.current = data.session;
        setSession(data.session);
        merge(data.session.messages);
        if (data.session.messages.length > 0 || data.session.seq > cursor.current) {
          lastChangeAt.current = Date.now();
        }
      }
      cursor.current = Math.max(cursor.current, data.session.seq);
      setConnected(true);
      setEndedBy(null);
      setError(null);
    } catch {
      // A dropped poll is normal on venue wifi; the next one recovers.
      setConnected(false);
    }
  }, [code, participantToken, merge]);

  useEffect(() => {
    if (!code || !participantToken) return;
    stopped.current = false;
    // The cursor belongs to the code that produced it. Every session numbers
    // its messages from 1, so carrying one over asks the server for turns
    // "after" seq 7 of a conversation that has not reached seq 7 — silently
    // dropping the new visitor's opening messages.
    cursor.current = 0;
    lastView.current = null;
    sessionRef.current = null;
    lastChangeAt.current = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const schedule = () => {
      if (stopped.current) return;
      clearTimeout(timer);
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      timer = setTimeout(
        tick,
        pollIntervalFor({
          hidden,
          now: Date.now(),
          lastChangeAt: lastChangeAt.current,
          sendPending: pendingSends.current > 0,
        }),
      );
    };
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await poll();
      } finally {
        inFlight = false;
      }
      schedule();
    };
    wake.current = schedule;
    void tick();

    // Coming back to the tab should feel instant, not up to eight seconds late.
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      // Do not DELETE on pagehide/unmount. Mobile Safari and Chrome can fire
      // lifecycle events while switching apps, opening the camera, or reclaiming
      // memory. Treating that as an explicit hang-up was terminating healthy
      // conversations. Explicit End still deletes immediately; Redis TTL cleans
      // up abandoned sessions.
      stopped.current = true;
      wake.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, participantToken, poll]);

  const send = useCallback(
    (input: SendInput): Promise<CounterMessage | null> => {
      const text = input.text.trim();
      if (!code || !participantToken || !text || stopped.current) return Promise.resolve(null);

      pendingSends.current += 1;
      setSending(true);
      setError(null);
      lastChangeAt.current = Date.now();
      wake.current?.();
      const requestId = newMessageRequestId();

      // Show the sender their own words at once. Quick phrases and
      // confirmations are server-side lookups too fast to be worth a
      // placeholder, and the former's text is an id until the server resolves it.
      const view = sessionRef.current;
      const showLocally =
        role !== undefined && view !== null && (input.source === "text" || input.source === "voice");
      if (showLocally) {
        localSeq.current += 1;
        const local: ClientCounterMessage = {
          id: localMessageId(requestId),
          seq: LOCAL_SEQ_BASE + localSeq.current,
          from: role,
          source: input.source,
          clientRequestId: requestId,
          originalText: text,
          originalLang: role === "host" ? view.hostLang : (view.guestLang ?? "en-US"),
          translatedText: "",
          targetLang: role === "host" ? (view.guestLang ?? "en-US") : view.hostLang,
          at: Date.now(),
          status: "pending",
          action: input.action,
          actionOf: input.actionOf,
          local: { requestId, input: { ...input, text } } satisfies LocalMessageState,
        };
        setMessages((current) => [...current, local]);
      }

      let resolveResult: (message: CounterMessage | null) => void = () => {};
      const result = new Promise<CounterMessage | null>((resolve) => {
        resolveResult = resolve;
      });

      const fail = (message: string) => {
        setError(message);
        if (showLocally) patchLocal(requestId, { status: "failed", error: message });
        resolveResult(null);
      };

      const run = async () => {
        let lastError = "Network problem — check the connection and try again.";
        let serverRetryDelay: number | null = null;

        try {
          for (let attempt = 0; attempt < SEND_RETRY_DELAYS_MS.length; attempt += 1) {
            const delay = serverRetryDelay ?? SEND_RETRY_DELAYS_MS[attempt];
            serverRetryDelay = null;
            if (delay > 0) await sleep(delay);

            if (stopped.current) {
              if (showLocally) removeLocal(requestId);
              resolveResult(null);
              return;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
            try {
              const response = await guardedFetch("/api/counter/message", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-asad-message-id": requestId,
                  [COUNTER_TOKEN_HEADER]: participantToken,
                },
                body: JSON.stringify({ code, ...input, text }),
                signal: controller.signal,
              });
              const data = (await response.json().catch(() => ({}))) as {
                message?: CounterMessage;
                error?: string;
              };

              if (response.ok && data.message) {
                merge([data.message]);
                cursor.current = Math.max(cursor.current, data.message.seq);
                lastChangeAt.current = Date.now();
                resolveResult(data.message);
                return;
              }

              lastError = data.error ?? `Could not send that (${response.status}).`;
              const mayRetry = retryableStatus(response.status);
              if (response.status === 429) serverRetryDelay = retryAfterMs(response);
              if (!mayRetry || attempt === SEND_RETRY_DELAYS_MS.length - 1) {
                fail(lastError);
                return;
              }
            } catch {
              if (attempt === SEND_RETRY_DELAYS_MS.length - 1) {
                fail(lastError);
                return;
              }
            } finally {
              clearTimeout(timeout);
            }
          }
        } finally {
          pendingSends.current = Math.max(0, pendingSends.current - 1);
          setSending(pendingSends.current > 0);
        }
      };

      // Keep the server-facing turns strictly ordered, but recover the queue
      // after any unexpected failure so one bad message never jams later ones.
      sendQueue.current = sendQueue.current
        .catch(() => {})
        .then(run)
        .catch(() => {
          pendingSends.current = Math.max(0, pendingSends.current - 1);
          setSending(pendingSends.current > 0);
          fail("Network problem — check the connection and try again.");
        });

      return result;
    },
    [code, participantToken, merge, patchLocal, removeLocal, role],
  );

  /** Send a failed local message again, as a new request. */
  const resend = useCallback(
    (message: ClientCounterMessage): Promise<CounterMessage | null> => {
      if (!message.local) return Promise.resolve(null);
      removeLocal(message.local.requestId);
      return send(message.local.input);
    },
    [removeLocal, send],
  );

  /** Drop a failed local message the user no longer wants to send. */
  const discard = useCallback(
    (message: ClientCounterMessage) => {
      if (message.local) removeLocal(message.local.requestId);
    },
    [removeLocal],
  );

  const end = useCallback(
    async (options: EndOptions = {}) => {
      setEndedBy("self");
      setConnected(false);
      stopped.current = true;

      if (!code || !participantToken) {
        if (options.leave) leaveCounterMode();
        return;
      }
      await fetch(`/api/counter/session?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
        headers: { [COUNTER_TOKEN_HEADER]: participantToken },
      }).catch(() => {});
      if (options.leave) leaveCounterMode();
    },
    [code, participantToken, leaveCounterMode],
  );

  return {
    session,
    messages,
    error,
    sending,
    connected,
    ended: endedBy !== null,
    endedBy,
    send,
    resend,
    discard,
    end,
    refresh: poll,
    dismissError: useCallback(() => setError(null), []),
  };
}
