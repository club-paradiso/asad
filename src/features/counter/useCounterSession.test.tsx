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

import { useCounterSession } from "./useCounterSession";

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
  it("leaves Counter Mode when the other participant ends the session", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Session not found or expired." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const { result } = renderHook(() => useCounterSession("AC34", "guest"));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(result.current.ended).toBe(true);
    expect(result.current.connected).toBe(false);
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

    expect(replace).toHaveBeenCalledWith("/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/counter/session?code=AC34",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("best-effort ends the session when the browser page is left", async () => {
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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/counter/session?code=AC34",
        expect.objectContaining({ method: "DELETE", keepalive: true }),
      ),
    );
  });
});
