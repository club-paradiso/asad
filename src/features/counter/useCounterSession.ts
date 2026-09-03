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
  /** The session is gone from the server: ended, or expired. */
  const [ended, setEnded] = useState(false);

  const cursor = useRef(0);
  const stopped = useRef(false);
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSends = useRef(0);

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
    // Browsers generally refuse to close tabs they did not open themselves.
    // The explicit staff-side "End Counter Mode" action returns to the app.
    // Visitor-side soft-close behavior lives in CounterGuestScreen instead.
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
        // Raise a terminal state only. The host keeps the ASAD shell, while the
        // visitor surface decides how to close/replace its own browser page.
        setEnded(true);
        setConnected(false);
        stopped.current = true;
        return;
      }
      if (!response.ok) throw new Error(`Poll failed (${response.status})`);

      const data = (await response.json()) as { session: SessionView };
      setSession(data.session);
      merge(data.session.messages);
      cursor.current = Math.max(cursor.current, data.session.seq);
      setConnected(true);
      setEnded(false);
      setError(null);
    } catch {
      // A dropped poll is normal on venue wifi; the next one recovers.
      setConnected(false);
    }
  }, [code, participantToken, merge]);

  useEffect(() => {
    if (!code || !participantToken) return;
    stopped.current = false;
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
      setEnded(true);
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
    ended,
    send,
    end,
    refresh: poll,
    dismissError: useCallback(() => setError(null), []),
  };
}
