import { describe, expect, it, vi } from "vitest";
import {
  captureAudioConstraints,
  observeAudioInputEnd,
  pcm16ToWav,
  Pcm16UtteranceBuffer,
} from "./audio";

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

describe("Counter batch WAV encoding", () => {
  it("writes a canonical 16 kHz mono PCM WAV header", () => {
    const pcm = new Uint8Array([0, 0, 255, 127]).buffer;
    const wav = new DataView(pcm16ToWav(pcm));
    expect(new TextDecoder().decode(new Uint8Array(wav.buffer, 0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(new Uint8Array(wav.buffer, 8, 4))).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(4);
  });

  it("keeps the utterance buffer bounded and disposable", () => {
    const buffer = new Pcm16UtteranceBuffer();
    expect(buffer.append(new Uint8Array([1, 2]).buffer)).toBe(true);
    expect(new Uint8Array(buffer.toArrayBuffer())).toEqual(new Uint8Array([1, 2]));
    buffer.clear();
    expect(buffer.byteLength).toBe(0);
  });
});
