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
import { guardedFetch, useSessionToken } from "@/lib/session-client";
import type { CounterMessage, Participant, SessionView } from "@/counter/types";

const POLL_ACTIVE_MS = 1200;
const POLL_HIDDEN_MS = 8000;

export interface SendInput {
  text: string;
  source: "voice" | "text" | "quick-phrase" | "confirm";
  rephraseOf?: string;
}

export function useCounterSession(code: string | null, role: Participant) {
  // Both sides reach a model, so both need authorising before they type.
  useSessionToken();

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

  const poll = useCallback(async () => {
    if (!code || stopped.current) return;
    try {
      const response = await fetch(
        `/api/counter/session?code=${encodeURIComponent(code)}&since=${cursor.current}`,
        { cache: "no-store" },
      );
      if (response.status === 404) {
        // Reported as a state, not an error string: each screen says it in the
        // language its own reader speaks.
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
  }, [code, merge]);

  useEffect(() => {
    if (!code) return;
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
      stopped.current = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, poll]);

  const send = useCallback(
    (input: SendInput): Promise<CounterMessage | null> => {
      const text = input.text.trim();
      if (!code || !text) return Promise.resolve(null);

      pendingSends.current += 1;
      setSending(true);
      setError(null);

      let resolveResult: (message: CounterMessage | null) => void = () => {};
      const result = new Promise<CounterMessage | null>((resolve) => {
        resolveResult = resolve;
      });

      const run = async () => {
        try {
          const response = await guardedFetch("/api/counter/message", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code, from: role, ...input, text }),
          });
          const data = (await response.json()) as {
            message?: CounterMessage;
            error?: string;
          };
          if (!response.ok || !data.message) {
            setError(data.error ?? "Could not send that.");
            resolveResult(null);
            return;
          }
          merge([data.message]);
          cursor.current = Math.max(cursor.current, data.message.seq);
          resolveResult(data.message);
        } catch {
          setError("Network problem — check the connection and try again.");
          resolveResult(null);
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
        .catch(() => {});

      return result;
    },
    [code, role, merge],
  );

  const end = useCallback(async () => {
    if (!code) return;
    stopped.current = true;
    await fetch(`/api/counter/session?code=${encodeURIComponent(code)}`, {
      method: "DELETE",
    }).catch(() => {});
  }, [code]);

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
