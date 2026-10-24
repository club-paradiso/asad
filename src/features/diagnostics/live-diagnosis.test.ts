import { describe, expect, it } from "vitest";
import type { InputHealth } from "@/features/live/input-health";
import { diagnoseLive, summariseLiveDiagnosis } from "./live-diagnosis";

const raw = (state: InputHealth["state"], level: InputHealth["level"] = "good"): InputHealth => ({
  source: "raw",
  state,
  level,
  silentForMs: 0,
  clippedFramesRecently: 0,
});

const healthyStt = { provider: "deepgram", credentialsRequired: true, keyConfigured: true };

describe("diagnoseLive", () => {
  it("is empty for a healthy booth", () => {
    expect(
      diagnoseLive({
        permission: "granted",
        deviceCount: 2,
        selectedLabel: "USB Audio Device (0d8c:0014)",
        health: raw("ok"),
        stt: healthyStt,
        llm: { active: "gemini" },
        slo: [{ stage: "stable_to_safe", target: { p50: 2500, p95: 4500 }, actual: { count: 40, p50: 900, p95: 2000 }, p95Met: true }],
      }),
    ).toEqual([]);
  });

  it("tells a denied permission apart from a missing device", () => {
    expect(diagnoseLive({ permission: "denied", deviceCount: 0 }).map((p) => p.kind)).toEqual([
      "permission-denied",
    ]);
    expect(diagnoseLive({ permission: "granted", deviceCount: 0 }).map((p) => p.kind)).toEqual([
      "no-input-device",
    ]);
  });

  it("flags the laptop microphone as the wrong device, not as no device", () => {
    const problems = diagnoseLive({ permission: "granted", deviceCount: 1, selectedLabel: "MacBook Air 마이크" });
    expect(problems.map((p) => p.kind)).toEqual(["wrong-device"]);
    expect(problems[0].severity).toBe("warning");
  });

  it("separates silence, weak signal and clipping", () => {
    expect(diagnoseLive({ health: raw("silent", "silent") })[0]).toMatchObject({
      kind: "insufficient-signal",
      severity: "blocked",
    });
    expect(diagnoseLive({ health: raw("ok", "low") })[0]).toMatchObject({
      kind: "insufficient-signal",
      severity: "warning",
    });
    expect(diagnoseLive({ health: raw("clipping", "hot") })[0]).toMatchObject({ kind: "clipping" });
  });

  it("says nothing about a level it did not measure", () => {
    expect(
      diagnoseLive({
        health: { source: "browser-managed", state: "unknown", level: "silent", silentForMs: 0, clippedFramesRecently: 0 },
      }),
    ).toEqual([]);
  });

  it("tells STT configuration apart from translation configuration", () => {
    expect(
      diagnoseLive({ stt: { provider: "deepgram", credentialsRequired: true, keyConfigured: false } }).map((p) => p.kind),
    ).toEqual(["stt-unavailable"]);
    expect(diagnoseLive({ stt: { provider: "webspeech", credentialsRequired: false, keyConfigured: null } })).toEqual([]);
    expect(diagnoseLive({ llm: { active: null } }).map((p) => p.kind)).toEqual(["translation-unavailable"]);
  });

  it("reports latency only from stages an interpreter feels, with the numbers", () => {
    const problems = diagnoseLive({
      slo: [
        { stage: "stable_to_render", target: { p50: 2500, p95: 4500 }, actual: { count: 30, p50: 3000, p95: 7200 }, p95Met: false },
        { stage: "contextual_result_stale", target: { p50: 1, p95: 1 }, actual: { count: 3, p50: 9, p95: 9 }, p95Met: false },
        { stage: "provider_response", target: { p50: 1500, p95: 3000 }, actual: { count: 0, p50: 0, p95: 0 }, p95Met: false },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "high-latency", severity: "warning" });
    expect(problems[0].detail).toContain("7200");
  });

  it("puts blocking problems first", () => {
    const kinds = diagnoseLive({
      selectedLabel: "iPhone Microphone",
      stt: { provider: "openai", credentialsRequired: true, keyConfigured: false },
    }).map((p) => `${p.severity}:${p.kind}`);
    expect(kinds).toEqual(["blocked:stt-unavailable", "warning:wrong-device"]);
  });

  it("never writes an error code or a stack into a sentence", () => {
    const everything = diagnoseLive({
      permission: "denied",
      deviceCount: 0,
      selectedLabel: "AirPods",
      health: raw("clipping", "hot"),
      stt: { provider: "deepgram", credentialsRequired: true, keyConfigured: false },
      llm: { active: null },
    });
    for (const problem of everything) {
      expect(`${problem.title} ${problem.detail} ${problem.fix}`).not.toMatch(/undefined|null|\[object/);
    }
  });
});

describe("summariseLiveDiagnosis", () => {
  it("rolls the list up into one headline", () => {
    expect(summariseLiveDiagnosis([]).level).toBe("ready");
    expect(summariseLiveDiagnosis(diagnoseLive({ llm: { active: null } })).level).toBe("warning");
    expect(summariseLiveDiagnosis(diagnoseLive({ permission: "denied" })).level).toBe("blocked");
  });
});
