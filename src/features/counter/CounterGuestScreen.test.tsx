/**
 * The visitor correcting a mis-tapped language.
 *
 * The server lets the holder of the existing capability change language until
 * the first message, and refuses a token-less re-join as a second person. So
 * "Change language" has to keep the capability while the picker is showing —
 * it briefly did not, and every correction came back as 409.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/providers/stt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/stt")>()),
  prefetchSttCredentials: vi.fn(async () => {}),
  getMicrophonePermissionState: vi.fn(async () => "prompt"),
  ensureMicrophonePermission: vi.fn(async () => "granted"),
}));
vi.mock("./useVoiceInput", () => ({
  useVoiceInput: () => ({
    supported: false,
    languageUnsupported: false,
    phase: "unavailable",
    listening: false,
    active: false,
    partial: "",
    failure: null,
    usedFallback: false,
    start: vi.fn(),
    stop: vi.fn(),
    dismissError: vi.fn(),
  }),
}));

import { CounterGuestScreen } from "./CounterGuestScreen";
import { stringsFor } from "@/counter/ui-strings";
import { readGuestResume } from "./resume";

const originalFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const view = (guestLang: string) => ({
  code: "AC34",
  state: "active",
  hostLang: "ko-KR",
  guestLang,
  guestPresent: true,
  messages: [],
  seq: 0,
});

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Counter Mode, visitor side, changing language before speaking", () => {
  it("re-joins with the capability it already holds", async () => {
    const patches: Array<{ token: string | undefined; guestLang: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/config")) return json({ counter: { provider: "Test" } });
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { guestLang: string };
        const token = (init.headers as Record<string, string>)["x-asad-counter-token"];
        patches.push({ token, guestLang: body.guestLang });
        // The real route: a second claim without the capability is a second person.
        if (patches.length > 1 && token !== "guest-token") {
          return json({ error: "This session already has a visitor." }, 409);
        }
        return json({ session: view(body.guestLang), participantToken: "guest-token" });
      }
      return json({ session: view(patches.at(-1)?.guestLang ?? "vi-VN") });
    }) as unknown as typeof fetch;

    render(<CounterGuestScreen code="AC34" />);
    const vi_ = stringsFor("vi-VN");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: vi_.start }));
    });
    await screen.findByPlaceholderText(vi_.typeHere);
    expect(patches).toEqual([{ token: undefined, guestLang: "vi-VN" }]);
    expect(readGuestResume("AC34")).toMatchObject({ token: "guest-token", lang: "vi-VN" });

    // Mis-tapped: back to the picker, then Thai.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: vi_.changeLanguage }));
    });
    const th = stringsFor("th-TH");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ไทย" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: th.start }));
    });
    await screen.findByPlaceholderText(th.typeHere);

    expect(patches[1]).toEqual({ token: "guest-token", guestLang: "th-TH" });
    await waitFor(() =>
      expect(readGuestResume("AC34")).toMatchObject({ token: "guest-token", lang: "th-TH" }),
    );
  });
});
