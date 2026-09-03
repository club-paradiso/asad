import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/app/api/config/route";
import { readinessRows } from "./StartScreen";

const configWithDisclosure = {
  stt: { configured: "webspeech", cloudAvailable: false },
  llm: {
    configured: "Google Gemini",
    modelAvailable: true,
    routingMode: "reliable",
    sustainsLiveSermon: true,
    freeTierDisclosure: [
      {
        label: "Google Gemini",
        note: "Free tier submissions may be used to improve products.",
      },
    ],
  },
  bible: { configured: "reference-only", textAvailable: false, translation: "" },
  counter: {
    provider: "OpenRouter",
    mayTrain: false,
    note: "",
    openWeightModel: true,
  },
} satisfies AppConfig;

describe("launcher booth preflight readiness", () => {
  it("marks an unverified raw Sermon input as limited without blocking it", () => {
    const [input] = readinessRows({
      config: null,
      mode: "sermon",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      boothPreflightVerified: false,
    });

    expect(input).toMatchObject({
      label: "입력",
      value: "USB Mixer · 사전 점검 안 됨",
      level: "limited",
    });
    expect(input.detail).toMatch(/그대로 시작해도 됩니다/);
  });

  it("returns the same Sermon input to ready after a matching fresh preflight", () => {
    const [input] = readinessRows({
      config: null,
      mode: "sermon",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      boothPreflightVerified: true,
    });

    expect(input).toMatchObject({
      label: "입력",
      value: "USB Mixer",
      level: "ready",
    });
  });

  it("does not require church booth preflight in General mode", () => {
    const [input] = readinessRows({
      config: null,
      mode: "general",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      boothPreflightVerified: false,
    });

    expect(input.level).toBe("ready");
  });

  it("blocks a remembered input after that physical device disappears", () => {
    const [input] = readinessRows({
      config: null,
      mode: "sermon",
      source: "deepgram",
      audioInputLabel: "선택한 입력을 찾을 수 없음",
      audioInputSupported: true,
      audioInputAvailable: false,
      boothPreflightVerified: true,
    });

    expect(input).toMatchObject({ level: "blocked" });
    expect(input.value).toMatch(/연결이 끊겼습니다/);
  });
});

describe("launcher privacy readiness", () => {
  it("requires disclosure before a training-capable free provider can start", () => {
    const privacy = readinessRows({
      config: configWithDisclosure,
      source: "webspeech",
      consent: "needed",
    })[3];

    expect(privacy).toMatchObject({
      label: "개인정보",
      value: "시작 전에 확인이 필요합니다",
      level: "limited",
    });
  });

  it("does not claim no-training after the interpreter accepts the disclosure", () => {
    const privacy = readinessRows({
      config: configWithDisclosure,
      source: "webspeech",
      consent: "granted",
    })[3];

    expect(privacy).toMatchObject({
      label: "개인정보",
      value: "외부 제공자 정책 확인됨",
      level: "limited",
    });
    expect(privacy.detail).toContain("Google Gemini");
    expect(privacy.detail).toContain("improve products");
  });

  it("keeps an already-acknowledged browser truthful on a later visit", () => {
    const privacy = readinessRows({
      config: configWithDisclosure,
      source: "webspeech",
      consent: "clear",
    })[3];

    expect(privacy.value).toBe("외부 제공자 정책 확인됨");
    expect(privacy.value).not.toMatch(/학습하지 않습니다/);
  });
});
