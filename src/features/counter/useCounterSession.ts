"use client";

/**
 * Counter session client.
 *
 * Short polling with a sequence cursor. Turn-taking at a counter does not need
 * sub-second delivery, and polling works everywhere — including serverless,
 * where a long-lived SSE connection does not survive.
 *
 * Message sends are queued rather than UI-locked. The user can type, tap the
 * microphone, and submit the next turn while the previous translation is still
 * running; network requests are still executed in order so conversational
 * context and server sequence numbers remain deterministic.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { guardedFetch } from "@/lib/session-client";
import { COUNTER_TOKEN_HEADER } from "@/counter/access-shared";
import type {
  CounterMessage,
  CounterMessageAction,
  SessionView,
} from "@/counter/types";

const POLL_ACTIVE_MS = 1200;
const POLL_HIDDEN_MS = 8000;
const SEND_RETRY_DELAYS_MS = [0, 400, 1100] as const;

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

/**
 * Who hung up.
 *
 * `"self"` is this device's own End button; `"remote"` is the session being
 * gone from the server — the other participant ended it, or it expired. The
 * surfaces need the difference: an automatic exit is right when the
 * conversation was taken away, and wrong when this device ended it in order to
 * stay and start the next one.
 */
export type CounterEndReason = "self" | "remote";

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

export function useCounterSession(
  code: string | null,
  participantToken: string | null,
) {
  const router = useRouter();

  const [session, setSession] = useState<SessionView | null>(null);
  const [messages, setMessages] = useState<CounterMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  /** Null while the session is live; otherwise how it finished. */
  const [endedBy, setEndedBy] = useState<CounterEndReason | null>(null);

  const cursor = useRef(0);
  const stopped = useRef(false);
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSends = useRef(0);

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

  /** Merge a batch, replacing by id so a resend does not duplicate. */
  const merge = useCallback((incoming: CounterMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]));
      for (const message of incoming) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
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
      if (!response.ok) throw new Error(`Poll failed (${response.status})`);

      const data = (await response.json()) as { session: SessionView };
      // A poll already in flight when this device hung up must not resurrect
      // the conversation: the exit the surfaces schedule keys off this state.
      if (stopped.current) return;
      setSession(data.session);
      merge(data.session.messages);
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
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await poll();
      if (stopped.current) return;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      timer = setTimeout(tick, hidden ? POLL_HIDDEN_MS : POLL_ACTIVE_MS);
    };
    void tick();

    // Coming back to the tab should feel instant, not up to eight seconds late.
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      // Do not DELETE on pagehide/unmount. Mobile Safari and Chrome can fire
      // lifecycle events while switching apps, opening the camera, or reclaiming
      // memory. Treating that as an explicit hang-up was terminating healthy
      // conversations. Explicit End still deletes immediately; Redis TTL cleans
      // up abandoned sessions.
      stopped.current = true;
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
      const requestId = newMessageRequestId();

      let resolveResult: (message: CounterMessage | null) => void = () => {};
      const result = new Promise<CounterMessage | null>((resolve) => {
        resolveResult = resolve;
      });

      const run = async () => {
        let lastError = "Network problem — check the connection and try again.";
        let serverRetryDelay: number | null = null;

        try {
          for (let attempt = 0; attempt < SEND_RETRY_DELAYS_MS.length; attempt += 1) {
            const delay = serverRetryDelay ?? SEND_RETRY_DELAYS_MS[attempt];
            serverRetryDelay = null;
            if (delay > 0) await sleep(delay);

            if (stopped.current) {
              resolveResult(null);
              return;
            }

            try {
              const response = await guardedFetch("/api/counter/message", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-asad-message-id": requestId,
                  [COUNTER_TOKEN_HEADER]: participantToken,
                },
                body: JSON.stringify({ code, ...input, text }),
              });
              const data = (await response.json().catch(() => ({}))) as {
                message?: CounterMessage;
                error?: string;
              };

              if (response.ok && data.message) {
                merge([data.message]);
                cursor.current = Math.max(cursor.current, data.message.seq);
                resolveResult(data.message);
                return;
              }

              lastError = data.error ?? `Could not send that (${response.status}).`;
              const mayRetry = retryableStatus(response.status);
              if (response.status === 429) serverRetryDelay = retryAfterMs(response);
              if (!mayRetry || attempt === SEND_RETRY_DELAYS_MS.length - 1) {
                setError(lastError);
                resolveResult(null);
                return;
              }
            } catch {
              if (attempt === SEND_RETRY_DELAYS_MS.length - 1) {
                setError(lastError);
                resolveResult(null);
                return;
              }
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
          setError("Network problem — check the connection and try again.");
          resolveResult(null);
        });

      return result;
    },
    [code, participantToken, merge],
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
    end,
    refresh: poll,
    dismissError: useCallback(() => setError(null), []),
  };
}
