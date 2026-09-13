import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/app/api/config/route";
import { boothPreflightApplies, readinessRows } from "./StartScreen";

// The rows are pure. The launcher module also binds the live-session hook,
// which drags in the recogniser and engine graph; none of it is exercised here.
vi.mock("./useLiveSession", () => ({ useLiveSession: () => ({}) }));

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

describe("when the booth sound check applies", () => {
  it("applies when the interpreter says the room is a service", () => {
    expect(boothPreflightApplies({ context: "sermon", source: "deepgram" })).toBe(true);
    expect(boothPreflightApplies({ context: "worship", source: "webspeech" })).toBe(true);
  });

  it("applies when a cloud recogniser is fed from a chosen physical input", () => {
    expect(
      boothPreflightApplies({ context: "auto", source: "deepgram", audioDeviceSelected: true }),
    ).toBe(true);
    expect(
      boothPreflightApplies({ context: "meeting", source: "openai", audioDeviceSelected: true }),
    ).toBe(true);
  });

  it("does not apply to a default microphone in an ordinary room", () => {
    expect(boothPreflightApplies({ context: "auto", source: "deepgram" })).toBe(false);
    expect(
      boothPreflightApplies({ context: "meeting", source: "deepgram", audioDeviceSelected: false }),
    ).toBe(false);
    // Browser recognition picks its own input; there is nothing to preflight.
    expect(
      boothPreflightApplies({ context: "auto", source: "webspeech", audioDeviceSelected: true }),
    ).toBe(false);
  });
});

describe("launcher booth preflight readiness", () => {
  it("marks an unverified raw input in a service as limited without blocking it", () => {
    const [input] = readinessRows({
      config: null,
      context: "sermon",
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

  it("asks for the same check when a booth input is chosen under auto context", () => {
    const [input] = readinessRows({
      config: null,
      context: "auto",
      source: "deepgram",
      audioInputLabel: "USB Mixer",
      audioInputSupported: true,
      audioDeviceSelected: true,
      boothPreflightVerified: false,
    });

    expect(input).toMatchObject({ level: "limited", value: "USB Mixer · 사전 점검 안 됨" });
  });

  it("returns the same input to ready after a matching fresh preflight", () => {
    const [input] = readinessRows({
      config: null,
      context: "sermon",
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

  it("does not require a booth preflight for a default input in auto context", () => {
    const [input] = readinessRows({
      config: null,
      context: "auto",
      source: "deepgram",
      audioInputLabel: "시스템 기본값",
      audioInputSupported: true,
      boothPreflightVerified: false,
    });

    expect(input.level).toBe("ready");
  });

  it("never takes a mode", () => {
    // The unified console has no Sermon/General switch; the rows must not
    // quietly grow one back.
    const rows = readinessRows({ config: null, source: "demo" });
    expect(rows.map((row) => row.label)).toEqual(["입력", "인식", "AI", "개인정보"]);
    expect(JSON.stringify(rows)).not.toMatch(/설교 모드|일반 모드/);
  });

  it("blocks a remembered input after that physical device disappears", () => {
    const [input] = readinessRows({
      config: null,
      context: "sermon",
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
