import { describe, expect, it } from "vitest";
import {
  CONTEXT_MIN_CHARS,
  ContextResolver,
  contextFromMode,
  discourseScores,
  isWorshipContext,
  metadataScores,
} from "./context-mode";
import { emptyPrepSheet, type PrepSheet } from "@/types";

const prep = (over: Partial<PrepSheet> = {}): PrepSheet => ({ ...emptyPrepSheet(), ...over });

/** Enough speech to clear the warm-up floor, in the shape of the given text. */
const speak = (resolver: ContextResolver, text: string, repeats = 1) => {
  for (let i = 0; i < repeats; i += 1) resolver.observe({ text });
};

describe("the manual override", () => {
  it("resolves to itself and reports full confidence", () => {
    const resolver = new ContextResolver({ mode: "meeting" });
    speak(resolver, "오늘 말씀은 요한복음 3장 16절입니다. 하나님의 은혜로 우리는 구원을 받았습니다.", 4);
    const state = resolver.state();
    expect(state.resolved).toBe("meeting");
    expect(state.confidence).toBe(1);
    // The evidence is still collected — handing it back to Auto must not mean
    // starting from nothing.
    expect(state.inferred).toBe("worship");
  });

  it("hands control straight back when set to auto", () => {
    const resolver = new ContextResolver({ mode: "meeting" });
    speak(resolver, "오늘 말씀은 요한복음 3장 16절입니다. 하나님의 은혜로 구원을 받았습니다.", 4);
    resolver.setMode("auto");
    expect(resolver.state().resolved).toBe("worship");
  });

  it("maps a mode to a resolved context without a resolver", () => {
    expect(contextFromMode("auto", "lecture")).toBe("lecture");
    expect(contextFromMode("worship", "lecture")).toBe("worship");
  });
});

describe("warming up", () => {
  it("stays generic until there is enough speech to be worth reading", () => {
    const resolver = new ContextResolver();
    resolver.observe({ text: "안녕하세요." });
    const state = resolver.state();
    expect(state.resolved).toBe("generic");
    expect(state.warmingUp).toBe(true);
    expect(state.confidence).toBe(0);
  });

  it("specialises from prep metadata before a word is spoken", () => {
    // The prep sheet is one of the six families, and it is the only one
    // available at second zero. An unambiguous venue is enough.
    const resolver = new ContextResolver({
      prep: prep({ organisation: "은혜공동체교회", scripture: "요한복음 3:16" }),
    });
    expect(resolver.state().resolved).toBe("worship");
    expect(resolver.state().confidence).toBeGreaterThan(0);
  });

  it("does not specialise from a vague prep sheet", () => {
    const resolver = new ContextResolver({ prep: prep({ title: "9월 정기" }) });
    expect(resolver.state().resolved).toBe("generic");
  });
});

describe("inference from speech", () => {
  const resolve = (text: string, repeats = 3) => {
    const resolver = new ContextResolver();
    speak(resolver, text, repeats);
    return resolver.state();
  };

  it("reads a worship service", () => {
    const state = resolve(
      "오늘 본문은 요한복음 3장 16절 말씀입니다. 하나님의 은혜와 사랑을 함께 나누겠습니다. 성도 여러분, 아멘 하시겠습니다.",
    );
    expect(state.resolved).toBe("worship");
    expect(isWorshipContext(state.resolved)).toBe(true);
  });

  it("reads a meeting", () => {
    const state = resolve(
      "다음 안건으로 넘어가겠습니다. 4분기 예산은 담당자가 검토하겠습니다. 액션 아이템과 일정 조율은 회의록에 남기겠습니다.",
    );
    expect(state.resolved).toBe("meeting");
  });

  it("reads a lecture", () => {
    const state = resolve(
      "오늘 강의에서는 세 가지를 다루겠습니다. 첫째, 정의입니다. 다음 장 슬라이드를 봐 주세요. 과제는 다음 주까지입니다.",
    );
    expect(state.resolved).toBe("lecture");
  });

  it("reads an event programme", () => {
    const state = resolve(
      "내빈 여러분 환영합니다. 오늘 사회를 맡은 사람입니다. 다음 순서는 축사입니다. 박수로 맞이해 주시기 바랍니다.",
    );
    expect(state.resolved).toBe("event");
  });

  it("works in English as well as Korean", () => {
    const state = resolve(
      "Let's move to the next agenda item. The action items and the deadline are in the minutes; who is taking this one?",
    );
    expect(state.resolved).toBe("meeting");
  });

  it("stays generic on speech that signals nothing", () => {
    const state = resolve(
      "그러니까 저희가 어제 이야기한 대로 진행하면 될 것 같습니다. 준비는 다 되어 있다고 들었습니다. 그렇게 알고 계시면 됩니다.",
      3,
    );
    expect(state.resolved).toBe("generic");
  });
});

describe("stability", () => {
  it("does not flicker on one stray sentence from another setting", () => {
    const resolver = new ContextResolver();
    speak(resolver, "오늘 본문은 요한복음 3장 16절입니다. 하나님의 은혜를 함께 나누겠습니다. 아멘.", 4);
    expect(resolver.state().resolved).toBe("worship");

    // A single meeting-flavoured aside must not take the session with it.
    const changed = resolver.observe({ text: "다음 안건은 나중에 말씀드리겠습니다." });
    expect(changed).toBe(false);
    expect(resolver.state().resolved).toBe("worship");
  });

  it("does switch once the evidence genuinely changes", () => {
    const resolver = new ContextResolver();
    speak(resolver, "오늘 강의는 세 가지를 다룹니다. 첫째, 정의입니다. 다음 장 슬라이드.", 2);
    expect(resolver.state().resolved).toBe("lecture");

    // Enough that the lecture has genuinely scrolled out of the rolling
    // window — about a minute of speech, which is what "the setting changed"
    // actually looks like. Anything less is an aside, and an aside must not
    // move the session.
    speak(
      resolver,
      "다음 안건입니다. 담당자와 일정 조율, 액션 아이템, 회의록, 의결 사항을 정리하겠습니다.",
      30,
    );
    expect(resolver.state().resolved).toBe("meeting");
  });
});

describe("the model's vote", () => {
  it("is one signal among several, not an instruction", () => {
    const resolver = new ContextResolver();
    // Heavy, unambiguous worship evidence already banked.
    speak(resolver, "요한복음 3장 16절. 하나님의 은혜와 구원, 성령의 인도하심. 아멘. 할렐루야.", 6);
    expect(resolver.state().resolved).toBe("worship");

    // A single disagreeing vote does not clear the switch margin.
    resolver.observe({ modelHint: "conversation" });
    expect(resolver.state().resolved).toBe("worship");
  });

  it("can settle a session the text alone leaves ambiguous", () => {
    const resolver = new ContextResolver();
    speak(resolver, "네, 그렇게 하겠습니다. 그 부분은 확인해 보겠습니다. 알겠습니다.", 4);
    expect(resolver.state().resolved).toBe("generic");

    resolver.observe({ modelHint: "conversation" });
    resolver.observe({ modelHint: "conversation" });
    expect(resolver.state().resolved).toBe("conversation");
  });
});

describe("signal families in isolation", () => {
  it("scores discourse patterns without any session state", () => {
    const worship = discourseScores("성도 여러분, 아멘 하시겠습니다. 하나님의 은혜입니다.");
    expect(worship.worship).toBeGreaterThan(worship.meeting);

    const empty = discourseScores("   ");
    expect(Object.values(empty).every((value) => value === 0)).toBe(true);
  });

  it("scores prep metadata without any speech", () => {
    expect(metadataScores(prep({ organisation: "서울대학교 세미나" })).lecture).toBeGreaterThan(0);
    expect(metadataScores(undefined).worship).toBe(0);
  });

  it("counts Scripture as structure rather than vocabulary", () => {
    const resolver = new ContextResolver();
    // No worship VOCABULARY at all — the references alone carry it, which is
    // what makes this signal independent of the terminology one.
    resolver.observe({
      text: "자, 그러면 오늘 함께 볼 부분을 펴 보시기 바랍니다. 앞에서 이야기한 그대로입니다.".repeat(2),
      scriptureHits: 3,
    });
    expect(resolver.state().resolved).toBe("worship");
  });
});

describe("the warm-up floor is a real threshold", () => {
  it("is measured in characters of speech, not in calls", () => {
    const resolver = new ContextResolver();
    const line = "다음 안건입니다. 담당자와 일정 조율을 하겠습니다.";
    let total = 0;
    while (total < CONTEXT_MIN_CHARS) {
      resolver.observe({ text: line });
      total += line.length;
    }
    expect(resolver.state().warmingUp).toBe(false);
  });
});
