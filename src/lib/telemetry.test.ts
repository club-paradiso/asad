import { describe, expect, it } from "vitest";
import { TelemetryRecorder } from "./telemetry";

describe("client latency telemetry", () => {
  it("de-duplicates retried client samples", () => {
    const recorder = new TelemetryRecorder();
    const sample = { id: "turn-1-render", stage: "stable_to_render" as const, ms: 2100, provider: "openrouter" };
    expect(recorder.recordClientLatency(sample)).toBe(true);
    expect(recorder.recordClientLatency(sample)).toBe(false);
    expect(recorder.stage("stable_to_render").count).toBe(1);
  });
  it("judges the user-visible SLO from React render latency", () => {
    const recorder = new TelemetryRecorder();
    recorder.recordClientLatency({ id: "r1", stage: "stable_to_render", ms: 2000 });
    recorder.recordClientLatency({ id: "r2", stage: "stable_to_render", ms: 2400 });
    const verdict = recorder.sloVerdicts().find((item) => item.stage === "stable_to_render");
    expect(verdict?.p50Met).toBe(true);
    expect(verdict?.p95Met).toBe(true);
  });
});
