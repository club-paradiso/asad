/**
 * Context inference against sessions that are not tidy.
 *
 * A real conference keynote contains lecture explanation, an opening prayer,
 * quoted conversation, some agenda language and a Q&A. The resolver's job there
 * is NOT to track every paragraph — it is to settle on something useful and
 * stay there, because context is a translation aid and a label that flickers is
 * worse than a label that is slightly wrong.
 *
 * Two failures, both named in the brief, and both real before this file:
 *
 *   - a Bible quote in an academic lecture turning the session into worship,
 *     permanently, from evidence that scrolled off screen forty minutes ago;
 *   - one "agenda" in a sermon turning it into a corporate meeting.
 *
 * The first was a genuine bug: Scripture and terminology hits were LIFETIME
 * counters while discourse read a rolling window, so structural evidence never
 * aged out and the incumbency rule then held the wrong answer in place.
 */
import { describe, expect, it } from "vitest";
import { ContextResolver, MAX_WINDOW_SIGNALS } from "./context-mode";
import { emptyPrepSheet, type PrepSheet } from "@/types";

const prep = (over: Partial<PrepSheet> = {}): PrepSheet => ({ ...emptyPrepSheet(), ...over });

const LECTURE =
  "오늘 강의에서는 사회적 자본 개념을 다루겠습니다. 첫째, 정의입니다. 다음 장 슬라이드를 봐 주세요.";
const SERMON =
  "오늘 본문은 요한복음 3장 16절입니다. 하나님의 은혜를 함께 나누겠습니다. 성도 여러분, 아멘.";
const MEETING =
  "다음 안건입니다. 담당자와 일정 조율, 액션 아이템, 회의록을 정리하겠습니다.";
/**
 * A lecture signposted the ordinary amount rather than the maximum amount.
 *
 * Deliberately not `LECTURE`: that one saturates every lecture pattern at once
 * and clears a frozen worship score by exactly the switch margin, which hides
 * the bug this file exists to pin.
 */
const QUIET_LECTURE =
  "오늘 강의에서는 사회적 자본 개념을 다루겠습니다. 다음 장 슬라이드를 봐 주세요.";

const speak = (resolver: ContextResolver, text: string, repeats = 1) => {
  for (let i = 0; i < repeats; i += 1) resolver.observe({ text });
};

describe("a lecture that quotes Scripture", () => {
  it("does not become a worship service", () => {
    const resolver = new ContextResolver({ prep: prep({ organisation: "제주대학교" }) });
    speak(resolver, LECTURE, 4);
    expect(resolver.state().resolved).toBe("lecture");

    // The speaker reads a verse to make a point about social trust. The local
    // detector resolves it, exactly as it would in a service.
    resolver.observe({ text: "여기서 잠깐 성경 한 구절을 인용하겠습니다.", scriptureHits: 1 });
    expect(resolver.state().resolved).toBe("lecture");

    speak(resolver, LECTURE, 2);
    expect(resolver.state().resolved).toBe("lecture");
  });

  it("does not become one even when a whole passage is read", () => {
    const resolver = new ContextResolver({ prep: prep({ organisation: "제주대학교" }) });
    speak(resolver, LECTURE, 4);
    resolver.observe({ text: "인용을 이어가겠습니다.", scriptureHits: 3 });
    // Three references is the resolver's structural ceiling — the strongest
    // this signal can ever be — and it still must not clear the switch margin
    // against a lecture the other families are holding up.
    expect(resolver.state().resolved).toBe("lecture");
  });

  it("lets the quotation age out instead of counting for the whole session", () => {
    const resolver = new ContextResolver();
    // An opening devotion: three resolved references, which is the structural
    // signal at full strength.
    resolver.observe({ text: "잠깐 함께 읽고 시작하겠습니다.", scriptureHits: 3 });
    expect(resolver.state().inferred).toBe("worship");

    // Then forty minutes of plainly-signposted lecture, and nothing else.
    //
    // THIS IS THE REGRESSION. The structural signal used to be a LIFETIME
    // count, so those three references pinned +9 on worship for the rest of
    // the session; the incumbency rule then required the lecture to beat that
    // frozen score by the switch margin, and an ordinarily-signposted lecture
    // does not. The session stayed "worship" for an hour on the strength of a
    // reading that ended in the first minute — and there was nothing the
    // interpreter could do about it except override by hand.
    speak(resolver, QUIET_LECTURE, 40);
    expect(resolver.state().resolved).toBe("lecture");
  });
});

describe("a sermon with one corporate word in it", () => {
  it("does not become a meeting", () => {
    const resolver = new ContextResolver();
    speak(resolver, SERMON, 4);
    expect(resolver.state().resolved).toBe("worship");

    const changed = resolver.observe({
      text: "다음 주 안건은 나중에 광고 시간에 말씀드리겠습니다.",
    });
    expect(changed).toBe(false);
    expect(resolver.state().resolved).toBe("worship");
  });

  it("does not follow a single disagreeing model vote either", () => {
    const resolver = new ContextResolver();
    speak(resolver, SERMON, 4);
    resolver.observe({ modelHint: "meeting" });
    expect(resolver.state().resolved).toBe("worship");
  });
});

describe("a keynote that contains everything", () => {
  it("settles on one reading and stays there through the parts that disagree", () => {
    const resolver = new ContextResolver({ prep: prep({ organisation: "AI 컨퍼런스 2026" }) });

    // Opening: a welcome from the stage.
    speak(resolver, "내빈 여러분 환영합니다. 오늘 사회를 맡은 사람입니다.", 2);
    // The body: teaching.
    speak(resolver, LECTURE, 12);

    // Either reading is defensible for a conference keynote, and which one it
    // lands on is not the point. What matters is that it lands, and then holds
    // through the sections that disagree with it — the label is a translation
    // aid, and one that changes every few sentences is worse than one that is
    // slightly wrong.
    const settled = resolver.state().resolved;
    expect(["event", "lecture"]).toContain(settled);

    // Q&A: short turns and questions, genuinely conversational, and five
    // minutes of a ninety-minute session.
    speak(resolver, "혹시 어떻게 적용하면 될까요? 여쭤볼게요.", 2);
    expect(resolver.state().resolved).toBe(settled);

    // A closing prayer. Structurally the strongest worship signal there is.
    resolver.observe({ text: "마무리 기도하겠습니다.", scriptureHits: 1 });
    expect(resolver.state().resolved).toBe(settled);

    // And an aside about next steps.
    resolver.observe({ text: "다음 안건은 이메일로 공유드리겠습니다." });
    expect(resolver.state().resolved).toBe(settled);
  });

  it("still moves when the session genuinely becomes something else", () => {
    const resolver = new ContextResolver();
    speak(resolver, LECTURE, 4);
    expect(resolver.state().resolved).toBe("lecture");

    // The lecture ends and a working session begins. Sustained, not an aside.
    speak(resolver, MEETING, 30);
    expect(resolver.state().resolved).toBe("meeting");
  });
});

describe("an operator override", () => {
  it("wins outright and keeps collecting evidence underneath", () => {
    const resolver = new ContextResolver({ mode: "lecture" });
    speak(resolver, SERMON, 4);
    expect(resolver.state().resolved).toBe("lecture");
    expect(resolver.state().confidence).toBe(1);
    // Handing control back must not start from nothing.
    resolver.setMode("auto");
    expect(resolver.state().resolved).toBe("worship");
  });
});

describe("bounded state", () => {
  it("does not accumulate observations across a long service", () => {
    const resolver = new ContextResolver();
    for (let i = 0; i < 2_000; i += 1) {
      resolver.observe({ text: LECTURE, scriptureHits: 0, worshipTermHits: 0 });
    }
    const signals = (resolver as unknown as { signals: unknown[] }).signals;
    expect(signals.length).toBeLessThanOrEqual(MAX_WINDOW_SIGNALS);
  });

  it("does not accumulate text-free observations either", () => {
    const resolver = new ContextResolver();
    for (let i = 0; i < 2_000; i += 1) resolver.observe({ scriptureHits: 1 });
    const signals = (resolver as unknown as { signals: unknown[] }).signals;
    expect(signals.length).toBeLessThanOrEqual(MAX_WINDOW_SIGNALS);
  });
});
