/**
 * The consent-before-cloud invariant.
 *
 * ONE RULE, asserted here so it cannot regress: while a privacy disclosure is
 * outstanding, nothing may leave the machine. Not the microphone, not the
 * transcript, not a request for recogniser credentials.
 *
 * The regression this guards against was real and subtle. The console started
 * itself on mount in one effect while a second effect fetched the disclosure,
 * so the two raced and the microphone usually won. Nothing looked broken — the
 * dialog still appeared — it simply appeared after the first Korean had
 * already been sent to a provider whose free tier may train on it.
 *
 * Two layers: the pure state machine, exhaustively; and the rendered console,
 * because a correct state machine wired up wrongly is the same bug again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { phasePermitsStart, resolvePhase } from "./useCloudConsent";
import { LiveConsole } from "./LiveConsole";
import { emptyPrepSheet, type SessionSettings } from "@/types";

const PROVIDER = [{ label: "Google Gemini", note: "Free tier may train." }];

describe("the consent state machine", () => {
  it("never permits a start while a disclosure is outstanding", () => {
    // Exhaustive over every input combination: no arrangement of source,
    // acknowledgement and disclosure may produce a start when a disclosure is
    // pending or still unknown.
    for (const source of ["demo", "webspeech", "deepgram", "openai"] as const) {
      for (const acknowledged of [true, false]) {
        for (const disclosure of [undefined, [], PROVIDER]) {
          const phase = resolvePhase({ source, acknowledged, disclosure });
          if (phase === "needed" || phase === "checking") {
            expect(phasePermitsStart(phase)).toBe(false);
          }
        }
      }
    }
  });

  it("holds at `checking` until the config answers", () => {
    expect(
      resolvePhase({ source: "deepgram", acknowledged: false, disclosure: undefined }),
    ).toBe("checking");
    expect(phasePermitsStart("checking")).toBe(false);
  });

  it("requires disclosure when a provider may train on the transcript", () => {
    expect(
      resolvePhase({ source: "deepgram", acknowledged: false, disclosure: PROVIDER }),
    ).toBe("needed");
  });

  it("clears when nothing needs disclosing", () => {
    expect(resolvePhase({ source: "deepgram", acknowledged: false, disclosure: [] })).toBe(
      "clear",
    );
  });

  it("clears immediately for demo, which touches nothing", () => {
    // Demo mode must not pay a round trip for a check that cannot apply to it.
    expect(
      resolvePhase({ source: "demo", acknowledged: false, disclosure: undefined }),
    ).toBe("clear");
  });

  it("clears for a browser that has already acknowledged", () => {
    expect(
      resolvePhase({ source: "deepgram", acknowledged: true, disclosure: undefined }),
    ).toBe("clear");
  });
});

/* -------------------------------------------------------------------------- */
/* The console itself                                                          */
/* -------------------------------------------------------------------------- */

const settings: SessionSettings = {
  mode: "sermon",
  lag: "balanced",
  view: "console",
  fontScale: 1,
  showKorean: true,
  showGlossary: true,
  showScripture: true,
  saveHistory: false,
};

/** Requests the console made, so the assertion can name the offending one. */
let calls: string[] = [];

const renderConsole = () =>
  render(
    <LiveConsole
      settings={settings}
      onSettingsChange={() => {}}
      prep={emptyPrepSheet()}
      source="deepgram"
      onEnd={() => {}}
    />,
  );

/** Anything that would put transcript-derived content on the network. */
const cloudCalls = () =>
  calls.filter((url) => url.includes("/api/interpret") || url.includes("/api/stt/token"));

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the live console", () => {
  it("sends nothing while the disclosure is outstanding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).includes("/api/config")) {
          return new Response(JSON.stringify({ llm: { freeTierDisclosure: PROVIDER } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    renderConsole();

    // The disclosure is showing…
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );

    // …and NOTHING derived from the microphone has been sent. This is the
    // whole test. `/api/config` and `/api/session` are fine — they carry no
    // transcript and are what decide whether to proceed.
    expect(cloudCalls()).toEqual([]);
  });

  it("holds even before the config answers, not just after", async () => {
    // The original race lived in this window: a start that fires while the
    // disclosure request is still open has already leaked by the time the
    // answer arrives.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        // Never resolves — the config request stays in flight.
        return new Promise<Response>(() => {});
      }),
    );

    renderConsole();
    await waitFor(() => expect(screen.getByText(/checking privacy settings/i)).toBeTruthy());
    expect(cloudCalls()).toEqual([]);
  });

  it("treats an unreachable config as needing disclosure, not as permission", async () => {
    // Failing open here would start a cloud session under an unknown privacy
    // posture, which is exactly what this gate exists to prevent.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).includes("/api/config")) throw new Error("offline");
        return new Response("{}", { status: 200 });
      }),
    );

    renderConsole();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeTruthy(),
    );
    expect(cloudCalls()).toEqual([]);
  });

  it("starts once nothing needs disclosing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).includes("/api/config")) {
          return new Response(JSON.stringify({ llm: { freeTierDisclosure: [] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ provider: "demo" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    renderConsole();

    // The gate must OPEN as well as close: a permanently shut gate passes
    // every test above and ships a console that never listens.
    await waitFor(() => expect(calls.some((url) => url.includes("/api/stt/token"))).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
