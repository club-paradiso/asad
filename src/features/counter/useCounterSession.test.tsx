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
    rerender({ code: "BD57" });
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
