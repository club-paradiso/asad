import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ replace }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/session-client", () => ({
  guardedFetch: vi.fn(),
  useSessionToken: vi.fn(),
}));

import { guardedFetch } from "@/lib/session-client";
import { retryAfterMs, useCounterSession } from "./useCounterSession";

const originalFetch = globalThis.fetch;

const activeSession = {
  code: "AC34",
  state: "active",
  hostLang: "ko-KR",
  guestLang: "en-US",
  guestPresent: true,
  messages: [],
  seq: 0,
};

beforeEach(() => {
  replace.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useCounterSession end lifecycle", () => {
  it("raises an ended state without choosing UI navigation for the caller", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Session not found or expired." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const { result } = renderHook(() => useCounterSession("AC34", "guest"));

    await waitFor(() => expect(result.current.ended).toBe(true));
    // The surfaces exit automatically on a remote end, so they have to be able
    // to tell it apart from this device's own End button.
    expect(result.current.endedBy).toBe("remote");
    expect(result.current.connected).toBe(false);
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it("can end locally and leave without affecting the next-visitor flow", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ ended: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ session: activeSession }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useCounterSession("AC34", "host"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.end({ leave: true });
    });

    expect(result.current.ended).toBe(true);
    expect(result.current.endedBy).toBe("self");
    expect(replace).toHaveBeenCalledWith("/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/counter/session?code=AC34",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("marks a locally ended visitor session immediately for its soft-close surface", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ ended: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ session: activeSession }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useCounterSession("AC34", "guest"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.end();
    });

    expect(result.current.ended).toBe(true);
    expect(result.current.endedBy).toBe("self");
    expect(result.current.connected).toBe(false);
    expect(replace).not.toHaveBeenCalled();

    // A poll already in flight when End was tapped must not report the session
    // as live again: that would cancel the exit the surface has scheduled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(result.current.endedBy).toBe("self");
  });

  it("does not mistake a mobile page lifecycle event for an explicit hang-up", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ ended: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ session: activeSession }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useCounterSession("AC34", "guest"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE"),
    ).toBe(false);
  });
});

describe("useCounterSession across consultations", () => {
  /** One finished exchange, as the desk's previous visitor would leave it. */
  const previous = {
    ...activeSession,
    messages: [
      {
        id: "m1",
        seq: 1,
        from: "guest",
        source: "text",
        originalText: "I have an appointment at three.",
        originalLang: "en-US",
        translatedText: "3시에 예약이 있습니다.",
        targetLang: "ko-KR",
        at: 0,
        status: "done",
      },
    ],
    seq: 1,
  };

  it("starts the next visitor from a clean cursor and an empty screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          session: String(input).includes("AC34")
            ? previous
            : { ...activeSession, code: "BD57", messages: [], seq: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { result, rerender } = renderHook(
      ({ code }) => useCounterSession(code, "token"),
      { initialProps: { code: "AC34" } },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    // "다음 손님" swaps the room code on a screen that never unmounts. Anything
    // still scoped to the last visitor belongs to them, not to the person now
    // standing at the counter.
    rerender({ code: "BD57" });

    // Cleared in the same render as the code change: the new visitor never sees
    // a frame of the last one's conversation.
    expect(result.current.messages).toEqual([]);
    expect(result.current.session).toBeNull();

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("BD57"))).toBe(true),
    );

    const next = fetchMock.mock.calls.find(([url]) => String(url).includes("BD57"));
    // Sequence numbers restart at 1 for every session, so a carried-over cursor
    // filters the new visitor's opening turns out of the poll entirely.
    expect(String(next?.[0])).toContain("since=0");
    expect(result.current.messages).toEqual([]);
  });

  it("does not carry a hang-up into the next consultation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ ended: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ session: activeSession }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { result, rerender } = renderHook(
      ({ code }) => useCounterSession(code, "token"),
      { initialProps: { code: "AC34" } },
    );
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.end();
    });
    expect(result.current.endedBy).toBe("self");

    // The desk ends one conversation to open the next; the new one must not
    // start on the previous one's terminal state.
    await act(async () => {
      rerender({ code: "BD57" });
    });
    expect(result.current.ended).toBe(false);
    expect(result.current.endedBy).toBeNull();
  });
});

describe("Counter send retry timing", () => {
  it("honours both Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMs(new Response(null, { headers: { "retry-after": "7" } }), 0)).toBe(7_000);
    expect(
      retryAfterMs(
        new Response(null, { headers: { "retry-after": "Thu, 01 Jan 1970 00:00:09 GMT" } }),
        2_000,
      ),
    ).toBe(7_000);
  });

  it("caps maliciously large retry advice", () => {
    expect(retryAfterMs(new Response(null, { headers: { "retry-after": "999999" } }))).toBe(60_000);
  });
});

describe("useCounterSession local messages", () => {
  const livePolls = () =>
    vi.fn(async () =>
      new Response(JSON.stringify({ session: activeSession }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

  const serverMessage = (requestId: string, text: string) => ({
    id: "m9",
    seq: 9,
    from: "host",
    source: "text",
    clientRequestId: requestId,
    originalText: text,
    originalLang: "ko-KR",
    translatedText: "Please wait.",
    targetLang: "en-US",
    at: 1,
    status: "done",
  });

  it("shows the sender's words at once, then replaces them with the stored message", async () => {
    globalThis.fetch = livePolls();
    let release!: (response: Response) => void;
    let requestId = "";
    vi.mocked(guardedFetch).mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          requestId = String((init?.headers as Record<string, string>)["x-asad-message-id"]);
          release = resolve;
        }),
    );

    const { result } = renderHook(() => useCounterSession("AC34", "token", { role: "host" }));
    await waitFor(() => expect(result.current.connected).toBe(true));

    let sent!: Promise<unknown>;
    act(() => {
      sent = result.current.send({ text: "잠시만 기다려 주세요.", source: "text" });
    });

    // Visible immediately, marked as still translating, attributed to this device.
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({
      status: "pending",
      from: "host",
      originalText: "잠시만 기다려 주세요.",
      originalLang: "ko-KR",
      targetLang: "en-US",
    });
    expect(result.current.messages[0].local?.requestId).toBe(requestId);

    release(
      new Response(JSON.stringify({ message: serverMessage(requestId, "잠시만 기다려 주세요.") }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await act(async () => {
      await sent;
    });
    // One message, the server's; the local placeholder is gone.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: "m9", status: "done", seq: 9 });
    expect(result.current.messages[0].local).toBeUndefined();
  });

  it("keeps a message whose every retry failed on screen as failed, and can resend it", async () => {
    globalThis.fetch = livePolls();
    vi.mocked(guardedFetch).mockImplementation(async () =>
      new Response(JSON.stringify({ error: "Provider outage." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useCounterSession("AC34", "token", { role: "guest" }));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.send({ text: "I need help", source: "text" });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      status: "failed",
      from: "guest",
      originalText: "I need help",
      error: "Provider outage.",
    });

    vi.mocked(guardedFetch).mockImplementation(async (_input, init) => {
      const requestId = String((init?.headers as Record<string, string>)["x-asad-message-id"]);
      return new Response(
        JSON.stringify({ message: { ...serverMessage(requestId, "I need help"), from: "guest" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await act(async () => {
      await result.current.resend(result.current.messages[0]);
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: "m9", status: "done" });
  });

  it("times out a request stuck in the network and retries it under the same idempotency key", async () => {
    globalThis.fetch = livePolls();
    const ids: string[] = [];
    vi.mocked(guardedFetch).mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const requestId = String((init?.headers as Record<string, string>)["x-asad-message-id"]);
          ids.push(requestId);
          if (ids.length === 1) {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            return;
          }
          resolve(
            new Response(JSON.stringify({ message: serverMessage(requestId, "x") }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }),
    );

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(() => useCounterSession("AC34", "token", { role: "host" }));
      await waitFor(() => expect(result.current.connected).toBe(true));
      let sent!: Promise<unknown>;
      act(() => {
        sent = result.current.send({ text: "x", source: "text" });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21_000);
      });
      await act(async () => {
        await sent;
      });
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(result.current.messages[0]).toMatchObject({ id: "m9", status: "done" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a refused capability as its own terminal state", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Session authorisation required." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const { result } = renderHook(() => useCounterSession("AC34", "stale-token"));
    await waitFor(() => expect(result.current.ended).toBe(true));
    expect(result.current.endedBy).toBe("unauthorised");
  });

  it("does not re-render the session for a poll that changed nothing", async () => {
    globalThis.fetch = livePolls();
    const views: unknown[] = [];
    const { result } = renderHook(() => {
      const value = useCounterSession("AC34", "token");
      views.push(value.session);
      return value;
    });
    await waitFor(() => expect(result.current.connected).toBe(true));
    const first = result.current.session;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.session).toBe(first);
  });
});
