import { describe, expect, it } from "vitest";
import { CODE_LENGTH, formatCode, generateCode, joinUrl, normaliseCode } from "./codes";
import { createMemoryStore, appendMessage, sourceLangFor, targetLangFor } from "./store";
import { detectRisks, buildConfirmationText } from "./risks";
import { QUICK_PHRASES, phrasesFor, quickPhraseCoverage, resolveQuickPhrase } from "./quick-phrases";
import { COUNTER_LANGUAGES, findLanguage, suggestLanguage } from "./languages";
import { buildCounterPrompt } from "./prompt";
import { parseCounterOutput } from "@/lib/schema";
import type { CounterMessage } from "./types";

describe("room codes", () => {
  it("generates codes of the right shape", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(normaliseCode(code)).toBe(code);
    }
  });

  it("excludes characters a person would misread or mishear", () => {
    // A staff member has to read this aloud across a counter to someone who
    // does not share their language.
    const confusable = ["0", "O", "1", "I", "L", "5", "S", "2", "Z", "8", "B"];
    const sample = Array.from({ length: 400 }, generateCode).join("");
    for (const char of confusable) expect(sample).not.toContain(char);
  });

  it("accepts anything a human might type", () => {
    const code = generateCode();
    expect(normaliseCode(`TY-${code}`)).toBe(code);
    expect(normaliseCode(`ty-${code.toLowerCase()}`)).toBe(code);
    expect(normaliseCode(` ${code} `)).toBe(code);
    expect(normaliseCode(`TY${code}`)).toBe(code);
  });

  it("accepts a generated code that itself begins with the prefix", () => {
    // `T` and `Y` are both in the alphabet, so ~1 in 625 codes looks like a
    // prefixed one. Stripping blindly made those codes impossible to type in.
    expect(normaliseCode("TY4A")).toBe("TY4A");
    expect(normaliseCode("ty4a")).toBe("TY4A");
    // Still unambiguous when the prefix is genuinely a prefix.
    expect(normaliseCode("TY-TY4A")).toBe("TY4A");
    expect(normaliseCode("TYTY4A")).toBe("TY4A");
  });

  it("rejects malformed codes rather than guessing", () => {
    expect(normaliseCode("")).toBeNull();
    expect(normaliseCode("ABC")).toBeNull();
    expect(normaliseCode("ABCDE")).toBeNull();
    expect(normaliseCode("0000")).toBeNull(); // excluded alphabet
  });

  it("builds a short join URL for the QR", () => {
    expect(joinUrl("https://x.dev/", "AC34")).toBe("https://x.dev/c/AC34");
    expect(formatCode("AC34")).toBe("TY-AC34");
  });
});

describe("session store", () => {
  it("creates a waiting session and finds it by code", () => {
    const store = createMemoryStore();
    const session = store.create({ hostLang: "ko-KR", deskLabel: "접수 2" });
    expect(session.state).toBe("waiting");
    expect(session.guestLang).toBeNull();
    expect(store.get(session.code)?.deskLabel).toBe("접수 2");
  });

  it("expires idle sessions", () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    const session = store.create({ hostLang: "ko-KR" });
    now += 4 * 60 * 60 * 1000 + 1;
    expect(store.get(session.code)).toBeUndefined();
  });

  it("keeps a session alive while it is being used", () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    const session = store.create({ hostLang: "ko-KR" });
    for (let i = 0; i < 5; i += 1) {
      now += 60 * 60 * 1000;
      expect(store.update(session.code, () => {})).toBeDefined();
    }
    expect(store.get(session.code)).toBeDefined();
  });

  it("discards a session outright when it ends", () => {
    const store = createMemoryStore();
    const session = store.create({ hostLang: "ko-KR" });
    expect(store.end(session.code)).toBe(true);
    // Nothing about a counter conversation should outlive it on the server.
    expect(store.get(session.code)).toBeUndefined();
  });

  it("assigns monotonic sequence numbers", () => {
    const store = createMemoryStore();
    const session = store.create({ hostLang: "ko-KR" });
    const seqs: number[] = [];
    store.update(session.code, (s) => {
      for (let i = 0; i < 4; i += 1) {
        seqs.push(appendMessage(s, message({ id: `m${i}` })).seq);
      }
    });
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it("bounds message history", () => {
    const store = createMemoryStore();
    const session = store.create({ hostLang: "ko-KR" });
    store.update(session.code, (s) => {
      for (let i = 0; i < 600; i += 1) appendMessage(s, message({ id: `m${i}` }));
    });
    expect(store.get(session.code)!.messages.length).toBeLessThanOrEqual(500);
  });

  it("routes each direction to the other party's language", () => {
    const store = createMemoryStore();
    const session = store.create({ hostLang: "ko-KR" });
    store.update(session.code, (s) => {
      s.guestLang = "vi-VN";
    });
    const live = store.get(session.code)!;
    expect(targetLangFor(live, "host")).toBe("vi-VN");
    expect(sourceLangFor(live, "host")).toBe("ko-KR");
    expect(targetLangFor(live, "guest")).toBe("ko-KR");
    expect(sourceLangFor(live, "guest")).toBe("vi-VN");
  });

  it("reports counts for diagnostics, never content", () => {
    const store = createMemoryStore();
    const a = store.create({ hostLang: "ko-KR" });
    store.create({ hostLang: "ko-KR" });
    store.update(a.code, (s) => {
      s.state = "active";
      appendMessage(s, message({ id: "m1" }));
    });
    const stats = store.stats();
    expect(stats).toEqual({ active: 1, waiting: 1, totalMessages: 1 });
    expect(JSON.stringify(stats)).not.toContain("안녕");
  });
});

const message = (overrides: Partial<CounterMessage> = {}): Omit<CounterMessage, "seq"> => ({
  id: "m",
  from: "host",
  source: "text",
  originalText: "안녕하세요",
  originalLang: "ko-KR",
  translatedText: "Hello",
  targetLang: "en-US",
  at: 0,
  status: "done",
  ...overrides,
});

describe("risk detection — the values that actually go wrong", () => {
  it("flags times", () => {
    expect(detectRisks("Your appointment is at 3:00 PM.").map((r) => r.kind)).toContain("time");
    expect(detectRisks("오후 3시에 오세요").map((r) => r.kind)).toContain("time");
  });

  it("flags money", () => {
    const risks = detectRisks("The fee is ₩50,000.");
    expect(risks.some((r) => r.kind === "money" && r.text.includes("50,000"))).toBe(true);
  });

  it("flags dates", () => {
    expect(detectRisks("Come back on 2026-09-01.").map((r) => r.kind)).toContain("date");
    expect(detectRisks("8월 24일에 오세요").map((r) => r.kind)).toContain("date");
  });

  it("flags long numbers such as phone numbers", () => {
    const risks = detectRisks("Call 010-1234-5678 when you arrive.");
    expect(risks.some((r) => r.kind === "number")).toBe(true);
  });

  it("flags Latin-script names", () => {
    const risks = detectRisks("Please give this to Kim Min Su.");
    expect(risks.some((r) => r.kind === "name" && r.text === "Kim Min Su")).toBe(true);
  });

  it("does not flag ordinary courtesy as a name", () => {
    // A false "confirm this name" on "Thank You" trains people to ignore the
    // whole feature.
    expect(detectRisks("Thank You for waiting.").some((r) => r.kind === "name")).toBe(false);
  });

  it("finds nothing in plain prose", () => {
    expect(detectRisks("Please have a seat and wait here.")).toHaveLength(0);
  });

  it("caps the number of highlights", () => {
    const risks = detectRisks("1:00 2:00 3:00 4:00 5:00 6:00 7:00 8:00 9:00");
    // Highlighting nine things is the same as highlighting nothing.
    expect(risks.length).toBeLessThanOrEqual(6);
  });

  it("does not double-claim overlapping spans", () => {
    const risks = detectRisks("Pay ₩50,000 by 2026-09-01.");
    const texts = risks.map((r) => r.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("builds a compact read-back line", () => {
    const risks = detectRisks("Come at 3:00 PM and pay ₩50,000.");
    const text = buildConfirmationText(risks);
    expect(text).toContain("3:00");
    expect(text).toContain("50,000");
    expect(text.length).toBeLessThan(60);
  });
});

describe("quick phrases — the zero-error path", () => {
  it("resolves a phrase into both languages without a model", () => {
    const resolved = resolveQuickPhrase("wait-moment", "ko-KR", "vi-VN");
    expect(resolved).toEqual({
      originalText: "잠시만 기다려 주세요.",
      translatedText: "Vui lòng đợi một chút.",
    });
  });

  it("returns null when a language pair is not covered", () => {
    // Falling back to the model beats showing the visitor the wrong language.
    expect(resolveQuickPhrase("wait-moment", "ko-KR", "km-KH")).toBeNull();
    expect(resolveQuickPhrase("no-such-phrase", "ko-KR", "en-US")).toBeNull();
  });

  it("covers Korean and English completely", () => {
    expect(quickPhraseCoverage("ko-KR")).toBe(1);
    expect(quickPhraseCoverage("en-US")).toBe(1);
  });

  it("covers the priority languages well", () => {
    for (const lang of ["zh-CN", "vi-VN", "th-TH", "ja-JP", "ru-RU"]) {
      expect(quickPhraseCoverage(lang)).toBeGreaterThanOrEqual(1);
    }
  });

  it("offers each side the phrases it would actually say", () => {
    const hostIds = phrasesFor("host").map((p) => p.id);
    const guestIds = phrasesFor("guest").map((p) => p.id);
    expect(hostIds).toContain("show-id");
    expect(guestIds).toContain("dont-understand");
    // Shared courtesy is available to both.
    expect(hostIds).toContain("thank-you");
    expect(guestIds).toContain("thank-you");
  });

  it("keeps every phrase short enough to be a quick phrase", () => {
    for (const phrase of QUICK_PHRASES) {
      for (const [lang, text] of Object.entries(phrase.text)) {
        expect(text.length, `${phrase.id}/${lang}`).toBeLessThan(70);
      }
    }
  });
});

describe("languages", () => {
  it("resolves exact and base tags", () => {
    expect(findLanguage("vi-VN")?.en).toBe("Vietnamese");
    expect(findLanguage("vi")?.en).toBe("Vietnamese");
    expect(findLanguage("xx-XX")).toBeUndefined();
  });

  it("suggests from the browser but never silently commits", () => {
    expect(suggestLanguage(["vi-VN", "en-US"])).toBe("vi-VN");
    expect(suggestLanguage(["vi"])).toBe("vi-VN");
    expect(suggestLanguage(["xx"])).toBe("en-US");
    expect(suggestLanguage(undefined)).toBe("en-US");
  });

  it("gives every language its own endonym", () => {
    // A visitor scans the list for their language written in their script.
    for (const language of COUNTER_LANGUAGES) {
      expect(language.endonym.length).toBeGreaterThan(0);
      expect(language.ko.length).toBeGreaterThan(0);
    }
  });
});

describe("counter prompt", () => {
  it("names both languages explicitly", () => {
    const prompt = buildCounterPrompt({
      text: "예약하셨나요?",
      sourceLang: "ko-KR",
      targetLang: "vi-VN",
    });
    expect(prompt).toContain("Korean");
    expect(prompt).toContain("Vietnamese");
    expect(prompt).toContain("예약하셨나요?");
  });

  it("marks recent turns as context, not as content to translate", () => {
    const prompt = buildCounterPrompt({
      text: "네",
      sourceLang: "ko-KR",
      targetLang: "en-US",
      recent: [{ from: "guest", text: "Do I need my passport?" }],
    });
    expect(prompt).toMatch(/do NOT translate these/i);
  });

  it("asks for different wording on a rephrase", () => {
    const prompt = buildCounterPrompt({
      text: "서류를 지참해 주세요",
      sourceLang: "ko-KR",
      targetLang: "en-US",
      rephrase: true,
    });
    expect(prompt).toMatch(/simpler words/i);
    expect(prompt).toMatch(/Do not change the meaning or any number/i);
  });
});

describe("counter output validation", () => {
  it("accepts a well-formed translation", () => {
    const output = parseCounterOutput('{"translation":"Do you have an appointment?","confidence":"high"}');
    expect(output?.translation).toBe("Do you have an appointment?");
  });

  it("recovers JSON wrapped in prose", () => {
    const output = parseCounterOutput('Sure!\n```json\n{"translation":"Hello","confidence":"high"}\n```');
    expect(output?.translation).toBe("Hello");
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(parseCounterOutput("I cannot translate that.")).toBeNull();
    expect(parseCounterOutput('{"translation":123}')).toBeNull();
  });

  it("defaults confidence rather than failing", () => {
    expect(parseCounterOutput('{"translation":"Hi"}')?.confidence).toBe("medium");
  });
});
