import { describe, expect, it } from "vitest";
import { pcm16ToWav, testToneWav } from "./audio-routing";
describe("earbud audio media", () => {
  it("prepares a valid, self-contained PCM16 WAV header", () => {
    const wav = pcm16ToWav(new Uint8Array([0, 0, 255, 127]));
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(40, true)).toBe(4);
    expect(wav.slice(44)).toEqual(new Uint8Array([0, 0, 255, 127]));
  });
  it("rejects invalid PCM payloads", () => {
    expect(() => pcm16ToWav(new Uint8Array([1]))).toThrow();
  });
  it("creates a local tone without calling external services", () => {
    expect(testToneWav().type).toBe("audio/wav");
    expect(testToneWav().size).toBe(44 + 48_000);
  });
});
