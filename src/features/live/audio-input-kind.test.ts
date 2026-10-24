import { describe, expect, it } from "vitest";
import { describeAudioInput } from "./audio-input-kind";

describe("describeAudioInput", () => {
  it.each([
    ["MacBook Air 마이크", "builtin-mic", "bad"],
    ["MacBook Pro Microphone (Built-in)", "builtin-mic", "bad"],
    ["External Microphone", "external-jack", "caution"],
    ["외장 마이크", "external-jack", "caution"],
    ["USB Audio Device (0d8c:0014)", "usb", "good"],
    ["Scarlett 2i2 USB", "usb", "good"],
    ["‘좌영춘의 Z Fold8’ 마이크", "phone", "bad"],
    ["iPhone Microphone", "phone", "bad"],
    ["AirPods Pro", "bluetooth", "bad"],
    ["ZoomAudioDevice", "virtual", "caution"],
    ["BlackHole 2ch", "virtual", "caution"],
    ["", "unknown", "caution"],
    ["Audio input 2", "unknown", "caution"],
  ])("classifies %s", (label, kind, suitability) => {
    expect(describeAudioInput(label)).toMatchObject({ kind, suitability });
  });

  it("always offers a plain-language note", () => {
    for (const label of ["MacBook Air 마이크", "USB Audio Device", "mystery"]) {
      expect(describeAudioInput(label).note.length).toBeGreaterThan(10);
    }
  });
});
