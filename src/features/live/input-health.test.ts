import { describe, expect, it } from "vitest";
import {
  BROWSER_MANAGED_INPUT_HEALTH,
  CLIP_FRAMES_FOR_WARNING,
  CLIP_WINDOW_MS,
  InputHealthMonitor,
  NO_INPUT_HEALTH,
  SILENCE_WARNING_MS,
  sameInputHealth,
} from "./input-health";

const monitorAt = (start = 1_000) => {
  let now = start;
  const monitor = new InputHealthMonitor(() => now);
  monitor.start();
  return {
    monitor,
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
  };
};

const SILENT = { rms: 0.001, peak: 0.002 };
const SPEECH = { rms: 0.08, peak: 0.4 };
const CLIPPED = { rms: 0.5, peak: 0.999 };

describe("InputHealthMonitor", () => {
  it("reports no input before a capture starts", () => {
    expect(new InputHealthMonitor().snapshot()).toEqual(NO_INPUT_HEALTH);
  });

  it("is ok while speech-like frames arrive", () => {
    const { monitor, advance } = monitorAt();
    for (let i = 0; i < 40; i += 1) {
      monitor.observe(SPEECH);
      advance(50);
    }
    expect(monitor.snapshot()).toMatchObject({ source: "raw", state: "ok", level: "good" });
  });

  it("does not call a short pause silence", () => {
    const { monitor, advance } = monitorAt();
    monitor.observe(SPEECH);
    advance(SILENCE_WARNING_MS - 500);
    monitor.observe(SILENT);
    expect(monitor.snapshot().state).toBe("ok");
  });

  it("calls a long silence silence, and counts it from the last audible frame", () => {
    const { monitor, advance } = monitorAt();
    monitor.observe(SPEECH);
    advance(SILENCE_WARNING_MS + 100);
    monitor.observe(SILENT);
    const reading = monitor.snapshot();
    expect(reading.state).toBe("silent");
    expect(reading.silentForMs).toBe(SILENCE_WARNING_MS + 100);
  });

  it("counts silence from the start when nothing was ever audible", () => {
    const { monitor, advance } = monitorAt();
    advance(SILENCE_WARNING_MS);
    monitor.observe(SILENT);
    expect(monitor.snapshot().state).toBe("silent");
  });

  it("recovers the moment speech returns", () => {
    const { monitor, advance } = monitorAt();
    advance(SILENCE_WARNING_MS + 1);
    monitor.observe(SILENT);
    expect(monitor.snapshot().state).toBe("silent");
    monitor.observe(SPEECH);
    expect(monitor.snapshot().state).toBe("ok");
  });

  it("flags clipping only after several clipped frames in the window", () => {
    const { monitor, advance } = monitorAt();
    for (let i = 0; i < CLIP_FRAMES_FOR_WARNING - 1; i += 1) {
      monitor.observe(CLIPPED);
      advance(50);
    }
    expect(monitor.snapshot().state).toBe("ok");
    monitor.observe(CLIPPED);
    expect(monitor.snapshot()).toMatchObject({ state: "clipping", clippedFramesRecently: CLIP_FRAMES_FOR_WARNING });
  });

  it("forgets clipped frames that fall out of the window", () => {
    const { monitor, advance } = monitorAt();
    for (let i = 0; i < CLIP_FRAMES_FOR_WARNING; i += 1) monitor.observe(CLIPPED);
    expect(monitor.snapshot().state).toBe("clipping");
    advance(CLIP_WINDOW_MS + 1);
    monitor.observe(SPEECH);
    expect(monitor.snapshot().state).toBe("ok");
  });

  it("ranks clipping above silence", () => {
    // Clipped frames are not silent frames, but the state machine must still
    // prefer the actionable, louder problem if both were somehow true.
    const { monitor, advance } = monitorAt();
    advance(SILENCE_WARNING_MS + 1);
    for (let i = 0; i < CLIP_FRAMES_FOR_WARNING; i += 1) monitor.observe({ rms: 0.001, peak: 0.999 });
    expect(monitor.snapshot().state).toBe("clipping");
  });

  it("returns to no input after reset", () => {
    const { monitor } = monitorAt();
    monitor.observe(SPEECH);
    monitor.reset();
    expect(monitor.snapshot()).toEqual(NO_INPUT_HEALTH);
  });
});

describe("sameInputHealth", () => {
  it("ignores the counters that change every frame", () => {
    expect(
      sameInputHealth(
        { source: "raw", state: "ok", level: "good", silentForMs: 10, clippedFramesRecently: 0 },
        { source: "raw", state: "ok", level: "good", silentForMs: 900, clippedFramesRecently: 1 },
      ),
    ).toBe(true);
    expect(sameInputHealth(NO_INPUT_HEALTH, BROWSER_MANAGED_INPUT_HEALTH)).toBe(false);
  });
});
