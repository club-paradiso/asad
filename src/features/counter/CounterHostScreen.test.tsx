/**
 * The desk device's behaviour when a consultation ends.
 *
 * Covers the wiring rather than the mechanism: the visitor hanging up must take
 * the staff screen back to the app on its own, while "다음 손님" — which ends the
 * same session — must leave the staff member exactly where they are.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

vi.mock("@/providers/stt", () => ({
  prefetchSttCredentials: vi.fn(async () => {}),
  getMicrophonePermissionState: vi.fn(async () => "prompt"),
  ensureMicrophonePermission: vi.fn(async () => "granted"),
}));

vi.mock("./useVoiceInput", () => ({
  useVoiceInput: () => ({
    supported: false,
    phase: "unavailable",
    listening: false,
    partial: "",
    failure: null,
    usedFallback: false,
    start: vi.fn(),
    stop: vi.fn(),
    dismissError: vi.fn(),
  }),
}));

import { CounterHostScreen } from "./CounterHostScreen";

const originalFetch = globalThis.fetch;

const sessionView = (overrides: Record<string, unknown> = {}) => ({
  code: "AC34",
  state: "active",
  hostLang: "ko-KR",
  guestLang: null,
  guestPresent: false,
  messages: [],
  seq: 0,
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** POST creates a session; GET polls it; the poll body is swappable per test. */
function mockCounterApi(poll: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/config")) return json({ counter: { provider: "Test" } });
    if (init?.method === "POST") {
      return json({ session: sessionView(), participantToken: "host-token" });
    }
    if (init?.method === "DELETE") return json({ ended: true });
    return poll();
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const openSession = async () => {
  render(<CounterHostScreen />);
  await act(async () => {
    // The label depends on whether this browser has been set up before.
    fireEvent.click(screen.getByRole("button", { name: /QR 코드 띄우기|새 민원 시작/ }));
  });
};

beforeEach(() => {
  replace.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Counter Mode, staff side, when the conversation ends", () => {
  it("returns to the app by itself once the visitor has hung up", async () => {
    mockCounterApi(() => json({ error: "Session not found or expired." }, 404));

    await openSession();

    await screen.findByText("민원인과의 대화가 종료되었습니다");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("stays put when the staff member ends the session to take the next visitor", async () => {
    mockCounterApi(() => json({ session: sessionView() }));

    await openSession();
    await screen.findByText("QR 코드를 스캔해 주세요");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다음 손님" }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(replace).not.toHaveBeenCalled();
  });
});
