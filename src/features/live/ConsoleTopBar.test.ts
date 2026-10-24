import { describe, expect, it } from "vitest";
import type { ConnectionState, SubsystemHealth } from "@/types";
import type { AiState } from "./AiStatus";
import { consoleStatus, formatElapsed } from "./ConsoleTopBar";

const healthy: SubsystemHealth = { stt: "ok", llm: "ok", bible: "ok" };

const status = (
  connection: ConnectionState,
  health: Partial<SubsystemHealth> = {},
  ai: AiState = "live",
) => consoleStatus({ connection, health: { ...healthy, ...health }, ai });

describe("consoleStatus", () => {
  /**
   * The product rule this file exists to hold: the strip is silent while the
   * session is working. Provider name, mode, lag profile and "the model
   * answered normally" were all on screen at every glance, and an interpreter
   * mid-sentence can act on none of them.
   */
  it("says one word and nothing else while everything works", () => {
    const result = status("live");
    expect(result).toEqual({ state: "live", label: "Live", problem: false });
    expect(result.detail).toBeUndefined();
  });

  it("stays quiet while connecting", () => {
    expect(status("connecting")).toMatchObject({ label: "Connecting", problem: false });
  });

  it.each([
    ["offline", status("offline")],
    ["stt down", status("live", { stt: "down" })],
    ["error", status("error")],
    ["reconnecting", status("reconnecting")],
    ["stt degraded", status("live", { stt: "degraded" })],
    ["llm down", status("live", { llm: "down" })],
    ["llm degraded", status("live", { llm: "degraded" })],
    ["rule-based fallback", status("live", {}, "local")],
  ])("flags %s as a problem with an explanation in plain language", (_name, result) => {
    expect(result.problem).toBe(true);
    expect(result.detail).toBeTruthy();
    // Never a provider name, a status code or a stack: the interpreter is
    // reading this while speaking.
    expect(result.detail).not.toMatch(/error|failed|\d{3}|undefined|null/i);
  });

  it("reports the worst problem first", () => {
    // Losing the recogniser matters more than the model being reduced.
    expect(status("live", { stt: "down", llm: "degraded" })).toMatchObject({
      state: "error",
      label: "Not listening",
    });
    // And losing the network matters more than either.
    expect(status("offline", { stt: "down", llm: "down" })).toMatchObject({
      state: "offline",
    });
  });

  it("does not raise the rule-based warning before the session is live", () => {
    expect(status("connecting", {}, "local").problem).toBe(false);
  });

  /**
   * Demo mode has no model by arrangement, and the demo ribbon already says so.
   * Flying a warning for the whole scripted session is the console crying wolf.
   */
  it("stays quiet about the missing model during a scripted demo", () => {
    const scripted = (health: Partial<SubsystemHealth>, ai: AiState) =>
      consoleStatus({ connection: "live", health: { ...healthy, ...health }, ai, scripted: true });

    expect(scripted({}, "local")).toMatchObject({ label: "Live", problem: false });
    expect(scripted({ llm: "down" }, "local")).toMatchObject({ label: "Live", problem: false });
  });

  it("still reports a lost recogniser during a demo", () => {
    expect(
      consoleStatus({ connection: "live", health: { ...healthy, stt: "down" }, ai: "live", scripted: true }),
    ).toMatchObject({ problem: true });
  });

  it("keeps every problem visibly distinct from a healthy session", () => {
    expect(status("live", { llm: "down" }).state).not.toBe("live");
    expect(status("live", {}, "local").state).not.toBe("live");
  });
});

describe("formatElapsed", () => {
  it("counts a service in minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(61_000)).toBe("1:01");
    expect(formatElapsed(45 * 60_000)).toBe("45:00");
  });

  it("never renders a negative clock", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

describe("a session that stopped listening", () => {
  const base = {
    connection: "idle" as const,
    health: { stt: "ok", llm: "ok", bible: "ok" } as const,
    ai: "live" as const,
  };

  it("outranks a recogniser's late 'closed' event", () => {
    // The recogniser reports its terminal error and then, a beat later,
    // reports that it closed. The close arrives last and reads as `idle`, so
    // the strip used to settle on the one word that means nothing is wrong.
    const status = consoleStatus({
      ...base,
      fault: {
        kind: "permission",
        message: "Microphone access was refused.",
        recovering: false,
        attempts: 0,
      },
    });
    expect(status.label).toBe("No microphone");
    expect(status.problem).toBe(true);
    expect(status.detail).toMatch(/Resume/);
  });

  it("says a dropped transport is coming back and nothing is lost", () => {
    const status = consoleStatus({
      ...base,
      connection: "reconnecting",
      fault: { kind: "transport", message: "socket closed", recovering: true, attempts: 1 },
    });
    expect(status.label).toBe("Reconnecting");
    expect(status.detail).toMatch(/Nothing on screen is lost/);
  });

  it("names the input rather than the network when the device went", () => {
    const status = consoleStatus({
      ...base,
      fault: { kind: "device", message: "gone", recovering: false, attempts: 0 },
    });
    expect(status.label).toBe("Input lost");
    expect(status.detail).not.toMatch(/connection/i);
  });

  it("stays quiet when there is no fault", () => {
    expect(consoleStatus({ ...base, connection: "live", fault: null }).problem).toBe(false);
  });
});

describe("consoleStatus and the input", () => {
  const input = (state: "ok" | "silent" | "clipping" | "unknown") => ({
    source: "raw" as const,
    state,
    level: state === "ok" ? ("good" as const) : ("silent" as const),
    silentForMs: 0,
    clippedFramesRecently: 0,
  });

  it("stays quiet while the input carries signal", () => {
    expect(
      consoleStatus({ connection: "live", health: healthy, ai: "live", input: input("ok") }),
    ).toEqual({ state: "live", label: "Live", problem: false });
  });

  it("says so when the recogniser has heard only silence for a while", () => {
    const result = consoleStatus({ connection: "live", health: healthy, ai: "live", input: input("silent") });
    expect(result).toMatchObject({ state: "degraded", label: "No signal", problem: true });
    expect(result.detail).not.toMatch(/error|failed|\d{3}|undefined|null/i);
  });

  it("says so when the input is distorting", () => {
    const result = consoleStatus({ connection: "live", health: healthy, ai: "live", input: input("clipping") });
    expect(result).toMatchObject({ state: "degraded", label: "Input too loud", problem: true });
  });

  it("ranks a lost recogniser above a silent input", () => {
    expect(
      consoleStatus({ connection: "live", health: { ...healthy, stt: "down" }, ai: "live", input: input("silent") }),
    ).toMatchObject({ label: "Not listening" });
  });

  it("ranks a silent input above a reduced model — no Korean means no English", () => {
    expect(
      consoleStatus({ connection: "live", health: { ...healthy, llm: "degraded" }, ai: "degraded", input: input("silent") }),
    ).toMatchObject({ label: "No signal" });
  });

  it("says nothing about an input it cannot measure", () => {
    expect(
      consoleStatus({
        connection: "live",
        health: healthy,
        ai: "live",
        input: { source: "browser-managed", state: "unknown", level: "silent", silentForMs: 0, clippedFramesRecently: 0 },
      }),
    ).toMatchObject({ label: "Live", problem: false });
  });
});
