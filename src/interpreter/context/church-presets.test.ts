import { describe, expect, it } from "vitest";
import {
  CHURCH_PRESETS,
  detectChurchPreset,
  isChurchPreset,
} from "./church-presets";
import { ContextResolver } from "./context-mode";
import { emptyPrepSheet, type PrepSheet } from "@/types";

const prep = (over: Partial<PrepSheet> = {}): PrepSheet => ({ ...emptyPrepSheet(), ...over });

/** Enough speech to clear the warm-up floor, in the shape of the given text. */
const speak = (resolver: ContextResolver, text: string, repeats = 4) => {
  for (let i = 0; i < repeats; i += 1) resolver.observe({ text });
};

describe("church presets", () => {
  it("ships the five church gatherings", () => {
    const ids = CHURCH_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual([
      "worship-service",
      "sermon",
      "prayer-meeting",
      "bible-study",
      "retreat",
    ]);
  });

  it("validates preset ids", () => {
    expect(isChurchPreset("prayer-meeting")).toBe(true);
    expect(isChurchPreset("wedding")).toBe(false);
    expect(isChurchPreset(undefined)).toBe(false);
  });

  it("names a prayer meeting from its speech", () => {
    expect(
      detectChurchPreset("오늘 기도회에서는 기도제목을 나누고 중보기도로 합심하겠습니다."),
    ).toBe("prayer-meeting");
  });

  it("names a Bible study from its speech", () => {
    expect(
      detectChurchPreset("성경공부 시간입니다. 오늘은 원어의 의미를 살펴보고 질문을 나누겠습니다."),
    ).toBe("bible-study");
  });

  it("names a retreat from its speech", () => {
    expect(
      detectChurchPreset("이번 수련회는 부흥회 형식으로 진행됩니다. 집회 시간표를 확인해 주세요."),
    ).toBe("retreat");
  });

  it("names a sermon from its speech", () => {
    expect(
      detectChurchPreset("오늘 설교의 본문은 요한복음 3장 16절입니다. 대지를 따라 말씀을 전하겠습니다."),
    ).toBe("sermon");
  });

  it("stays silent on thin evidence", () => {
    expect(detectChurchPreset("안녕하세요. 오늘 날씨가 좋네요.")).toBeNull();
    expect(detectChurchPreset("")).toBeNull();
  });

  it("reads the gathering from prep metadata before anyone speaks", () => {
    expect(
      detectChurchPreset("", prep({ title: "금요 기도회", organisation: "은혜교회" })),
    ).toBe("prayer-meeting");
    expect(
      detectChurchPreset("", prep({ title: "청년부 여름 수련회" })),
    ).toBe("retreat");
  });
});

describe("ContextResolver.churchPreset", () => {
  it("is null outside worship", () => {
    const resolver = new ContextResolver();
    speak(resolver, "다음 안건으로 넘어가겠습니다. 담당자는 일정 조율을 보고드리겠습니다.");
    expect(resolver.churchPreset()).toBeNull();
  });

  it("names the gathering inside a worship session", () => {
    const resolver = new ContextResolver();
    speak(resolver, "오늘 기도회에서는 기도제목을 나누고 중보기도로 합심하겠습니다. 아멘.");
    expect(resolver.state().resolved).toBe("worship");
    expect(resolver.churchPreset()).toBe("prayer-meeting");
  });

  it("specialises worship from a gathering prep sheet before a word is spoken", () => {
    const resolver = new ContextResolver({
      prep: prep({ organisation: "은혜교회", title: "여름 수련회", scripture: "여호수아 1:9" }),
    });
    expect(resolver.state().resolved).toBe("worship");
    expect(resolver.churchPreset()).toBe("retreat");
  });
});
