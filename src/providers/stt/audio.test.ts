import { describe, expect, it, vi } from "vitest";
import { captureAudioConstraints, observeAudioInputEnd } from "./audio";

describe("captureAudioConstraints", () => {
  it("requires an explicitly selected booth device exactly", () => {
    expect(captureAudioConstraints("opaque-device-id")).toMatchObject({
      deviceId: { exact: "opaque-device-id" },
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    });
  });

  it("leaves device selection to the browser for System default", () => {
    const constraints = captureAudioConstraints();
    expect("deviceId" in constraints).toBe(false);
    expect(constraints.channelCount).toBe(1);
  });
});

describe("observeAudioInputEnd", () => {
  const streamWith = (track: EventTarget) =>
    ({ getAudioTracks: () => [track as MediaStreamTrack] }) as MediaStream;

  it("reports an unexpected ended track once", () => {
    const track = new EventTarget();
    const onEnded = vi.fn();
    const cleanup = observeAudioInputEnd(streamWith(track), onEnded);

    track.dispatchEvent(new Event("ended"));
    track.dispatchEvent(new Event("ended"));

    expect(onEnded).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not report tracks that end after normal teardown cleanup", () => {
    const track = new EventTarget();
    const onEnded = vi.fn();
    const cleanup = observeAudioInputEnd(streamWith(track), onEnded);

    cleanup();
    track.dispatchEvent(new Event("ended"));

    expect(onEnded).not.toHaveBeenCalled();
  });
});
