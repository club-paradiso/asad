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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { phasePermitsStart, resolvePhase } from "./useCloudConsent";
import { StartScreen } from "./StartScreen";
import type { DisclosureProvider } from "./PrivacyDisclosure";
import { WebSpeechProvider } from "@/providers/stt";

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
/* The launcher                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The gate lives on the LAUNCHER, not the console, and that placement is the
 * fix rather than an implementation detail.
 *
 * Two constraints meet here. `start()` has to run inside a click handler or
 * Safari's recogniser silently never begins — deferring it to a mounted effect
 * loses the tap's transient user activation. And nothing may reach a cloud
 * provider before the disclosure is acknowledged.
 *
 * Resolving consent before the tap satisfies both: when a disclosure is
 * outstanding, the interpreter's "I understand" is itself the user gesture
 * that starts the session.
 */
/** Requests the launcher made, so an assertion can name the offending one. */
let calls: string[] = [];

/** Anything that would put transcript-derived content on the network. */
const cloudCalls = () =>
  calls.filter((url) => url.includes("/api/interpret") || url.includes("/api/stt/token"));

/** A deployment with a cloud recogniser and a training-capable model. */
const stubFetch = (
  disclosure: DisclosureProvider[],
  configBehaviour: "ok" | "hang" | "fail" | "non-ok" = "ok",
) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/config")) {
        if (configBehaviour === "hang") return new Promise<Response>(() => {});
        if (configBehaviour === "fail") throw new Error("offline");
        if (configBehaviour === "non-ok") return new Response("unavailable", { status: 503 });
        return json({
          stt: { configured: "deepgram", cloudAvailable: true },
          llm: {
            configured: "Google Gemini",
            modelAvailable: true,
            routingMode: "auto-free",
            sustainsLiveSermon: true,
            freeTierDisclosure: disclosure,
          },
          bible: { configured: "reference-only", textAvailable: false, translation: "WEB" },
          counter: { provider: null, mayTrain: false, note: "", openWeightModel: false },
        });
      }
      if (url.includes("/api/session")) return json({ gated: false, authorised: true });
      return json({ provider: "demo" });
    }),
  );

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the launcher", () => {
  it("sends nothing from load until the disclosure is acknowledged", async () => {
    stubFetch(PROVIDER);
    render(<StartScreen />);

    // The disclosure is showing…
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    // …and nothing derived from the microphone has been sent. `/api/config`
    // and `/api/session` are fine: they carry no transcript and are what
    // decide whether to proceed.
    expect(cloudCalls()).toEqual([]);
  });

  it("refuses to start while the disclosure is outstanding", async () => {
    stubFetch(PROVIDER);
    render(<StartScreen />);

    const start = await screen.findByRole("button", { name: /개인정보 확인하고 시작/ });
    expect(start.hasAttribute("disabled")).toBe(true);
    // Even forced, it must not start. The button being disabled is the
    // affordance; the guard inside beginSession is the guarantee.
    fireEvent.click(start);
    expect(cloudCalls()).toEqual([]);
  });

  it("sends nothing while the config request is still open", async () => {
    // The original race lived in exactly this window. With no answer yet the
    // launcher has no cloud recogniser to offer, so it stays on demo — which
    // is safe precisely because demo reaches nothing.
    stubFetch(PROVIDER, "hang");
    render(<StartScreen />);

    const start = await screen.findByRole("button", { name: /데모 실행/ });
    fireEvent.click(start);
    expect(cloudCalls()).toEqual([]);
  });

  it("treats an unreachable config as needing disclosure, not as permission", async () => {
    // The case that matters: a live recogniser is available on-device, so the
    // launcher is NOT on demo, and the transcript would still reach
    // /api/interpret. Failing open here would start a cloud session under an
    // unknown privacy posture — exactly what the gate exists to prevent.
    vi.spyOn(WebSpeechProvider, "isSupported").mockReturnValue(true);
    stubFetch(PROVIDER, "fail");
    render(<StartScreen />);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByRole("dialog").textContent).toMatch(/could not be loaded/i);
    expect(cloudCalls()).toEqual([]);
  });

  it("also fails closed when the config endpoint returns a non-OK response", async () => {
    vi.spyOn(WebSpeechProvider, "isSupported").mockReturnValue(true);
    stubFetch([], "non-ok");
    render(<StartScreen />);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByRole("dialog").textContent).toMatch(/could not be loaded/i);
    expect(cloudCalls()).toEqual([]);
  });

  it("starts on the interpreter's acknowledgement, which is itself the gesture", async () => {
    stubFetch(PROVIDER);
    render(<StartScreen />);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(cloudCalls()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /i understand/i }));

    // The gate must OPEN as well as close: a permanently shut gate passes
    // every test above and ships a launcher that never listens.
    await waitFor(() => expect(calls.some((url) => url.includes("/api/stt/token"))).toBe(true));
  });

  it("follows the audio source when it resolves asynchronously", async () => {
    // The regression this locks down: the launcher renders as `demo` until
    // /api/config answers, and the gate used to seed itself from that first
    // value. It latched "demo, nothing to disclose" and never revisited it
    // when the source became a cloud recogniser — reporting "clear" for a
    // session about to stream a sermon to a third party.
    stubFetch(PROVIDER);
    render(<StartScreen />);

    // Starts on demo…
    expect(screen.getByRole("button", { name: /데모 실행/ })).toBeTruthy();
    // …and once the real source arrives, the gate has followed it.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(cloudCalls()).toEqual([]);
  });

  it("discloses microphone-audio processing even when the LLM does not train", async () => {
    stubFetch([]);
    render(<StartScreen />);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByRole("dialog").textContent).toMatch(/microphone audio/i);
    fireEvent.click(screen.getByRole("button", { name: /i understand/i }));
    await waitFor(() => expect(calls.some((url) => url.includes("/api/stt/token"))).toBe(true));
  });
});
