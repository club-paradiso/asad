/**
 * The code-switching fixture suite.
 *
 * One fixture per way a real speaker mixes languages, asserted against the
 * layers that decide what reaches the engine: which hypothesis the recogniser's
 * output resolves to, how separate result slots are joined, what each vendor is
 * actually asked for, and what terminology the session hands the recogniser.
 *
 * The shape of every fixture is the same, and it is the shape of the bug: the
 * recogniser offers a correct code-switched hypothesis AND a fully-Koreanised
 * invention, and the product used to prefer the invention because it looked
 * more Korean.
 */
import { describe, expect, it } from "vitest";
import { buildSttHints } from "@/interpreter/glossary/stt-hints";
import { emptyPrepSheet, type PrepSheet } from "@/types";
import { DeepgramSpeechProvider } from "./deepgram";
import { OpenAiSpeechProvider } from "./openai";
import { deepgramSessionLanguage, sttCodeSwitchSupport } from "./language";
import { joinBrowserResultParts, joinTranscriptParts, pickSpeechAlternative } from "./transcript";

/**
 * Each fixture is [what the speaker said, what a monolingual recogniser
 * invents instead]. The first must win.
 */
const FIXTURES: Array<{ name: string; spoken: string; koreanised: string }> = [
  {
    name: "an English noun inside a Korean sentence",
    spoken: "이번 quarter의 conversion rate가 생각보다 낮습니다.",
    koreanised: "이번 쿼터의 컨버전 레이트가 생각보다 낮습니다.",
  },
  {
    name: "an English technical phrase with its acronym",
    spoken: "오늘은 retrieval augmented generation, 그러니까 RAG 구조를 살펴보겠습니다.",
    koreanised: "오늘은 리트리벌 어그멘티드 제너레이션, 그러니까 라그 구조를 살펴보겠습니다.",
  },
  {
    name: "an academic term of art",
    spoken: "Putnam은 bonding social capital과 bridging social capital을 구분합니다.",
    koreanised: "푸트남은 본딩 소셜 캐피탈과 브리징 소셜 캐피탈을 구분합니다.",
  },
  {
    name: "an English sermon title",
    spoken: "오늘 말씀의 제목은 Grace in the Wilderness입니다.",
    koreanised: "오늘 말씀의 제목은 그레이스 인 더 윌더니스입니다.",
  },
  {
    name: "foreign proper nouns",
    spoken: "OpenAI, Anthropic, DeepMind가 함께 참여했습니다.",
    koreanised: "오픈에이아이, 앤트로픽, 딥마인드가 함께 참여했습니다.",
  },
  {
    name: "a visa class identifier",
    spoken: "E-7 비자에서 F-2 비자로 변경하셔야 합니다.",
    koreanised: "이칠 비자에서 에프투 비자로 변경하셔야 합니다.",
  },
  {
    name: "an HTTP status code",
    spoken: "서버가 HTTP 403을 반환하고 있습니다.",
    koreanised: "서버가 에이치티티피 사백삼을 반환하고 있습니다.",
  },
  {
    name: "a business metric",
    spoken: "이번 프로젝트의 KPI는 conversion rate입니다.",
    koreanised: "이번 프로젝트의 케이피아이는 컨버전 레이트입니다.",
  },
];

describe("choosing between the recogniser's hypotheses", () => {
  for (const fixture of FIXTURES) {
    it(`keeps ${fixture.name}`, () => {
      // The browser ranks by acoustic confidence and hands the real hypothesis
      // over first. All the picker has to do is stop overruling it.
      expect(pickSpeechAlternative([fixture.spoken, fixture.koreanised], "ko-KR")).toBe(
        fixture.spoken,
      );
    });
  }

  it("still prefers the code-switched reading when it is ranked second", () => {
    // A tie on plausibility leaves the browser's own ordering in charge, so
    // this is the case that proves the script prejudice is gone rather than
    // merely reordered: with the hallucination first, only an explicit hint
    // can pull the real one up.
    const spoken = "오늘은 retrieval augmented generation을 살펴보겠습니다.";
    const koreanised = "오늘은 리트리벌 어그멘티드 제너레이션을 살펴보겠습니다.";
    expect(
      pickSpeechAlternative([koreanised, spoken], "ko-KR", {
        hints: ["retrieval augmented generation"],
      }),
    ).toBe(spoken);
  });

  it("does not let a hint outrank the right writing system", () => {
    // Romanised Mandarin containing a hinted term must still lose to real Han
    // characters. The guest allowance is conditional on the session's own
    // script being present at all.
    expect(
      pickSpeechAlternative(["wo yao yan chang qian zheng", "我要延长签证"], "zh-CN", {
        hints: ["yan chang"],
      }),
    ).toBe("我要延长签证");
  });

  it("ignores hints too short to mean anything", () => {
    const spoken = "회의를 시작하겠습니다.";
    // "a" would otherwise match inside almost every Latin hypothesis.
    expect(pickSpeechAlternative([spoken, "회의를 시작합니다."], "ko-KR", { hints: ["a"] })).toBe(
      spoken,
    );
  });

  it("keeps the single-hypothesis and empty cases unchanged", () => {
    expect(pickSpeechAlternative(["오직 하나"], "ko-KR")).toBe("오직 하나");
    expect(pickSpeechAlternative([], "ko-KR")).toBe("");
  });
});

describe("joining recogniser output across a script change", () => {
  it("separates an English word from the Korean beside it", () => {
    // Korean result slots are concatenated because ONE lexical item can be
    // split across them. No lexical item is half Hangul and half Latin, so
    // gluing them produced 오늘social — one unrecognisable token for the
    // stabiliser, the glossary matcher and the model alike.
    expect(joinBrowserResultParts(["오늘", "social", "capital", "입니다"], "ko-KR")).toBe(
      "오늘 social capital 입니다",
    );
  });

  it("still concatenates a Korean item split across slots", () => {
    expect(joinBrowserResultParts(["안녕", "하세요"], "ko-KR")).toBe("안녕하세요");
  });

  it("leaves genuinely unspaced scripts tight against Latin", () => {
    // Chinese and Japanese set an inserted Latin word without a space, and
    // that has always been deliberate.
    expect(joinTranscriptParts(["我的名字是", "Kim", "Min", "Su"], "zh-CN")).toBe(
      "我的名字是Kim Min Su",
    );
  });
});

describe("what each recogniser is actually asked for", () => {
  const credentials = { provider: "deepgram" as const, token: "t", model: "nova-3" };

  it("keeps a Korean Deepgram stream monolingual, because Korean is not in the multilingual model", () => {
    // Verified against Deepgram's published Nova-3 multilingual coverage: ten
    // languages, Korean not among them. Sending `language=multi` here would be
    // inventing a capability, and the socket would be refused mid-service.
    expect(deepgramSessionLanguage("ko-KR", "en-US")).toBe("ko-KR");
    expect(sttCodeSwitchSupport("deepgram", "ko-KR", "en-US")).toBe("none");
  });

  it("uses the multilingual model for a pair it genuinely covers", () => {
    expect(deepgramSessionLanguage("ja-JP", "en-US")).toBe("multi");
    expect(sttCodeSwitchSupport("deepgram", "ja-JP", "en-US")).toBe("multi-model");
  });

  it("never asks for the multilingual model without a second language", () => {
    expect(deepgramSessionLanguage("ja-JP")).toBe("ja");
    expect(deepgramSessionLanguage("ja-JP", "ja-JP")).toBe("ja");
  });

  it("sends Deepgram the session language and its keyterms", async () => {
    const provider = new DeepgramSpeechProvider({
      language: "ko-KR",
      guestLanguage: "en-US",
      hints: ["social capital", "Putnam"],
      credentials,
    });
    const { url } = await (
      provider as unknown as { socketUrl(): Promise<{ url: string }> }
    ).socketUrl();
    const params = new URL(url).searchParams;
    expect(params.get("language")).toBe("ko-KR");
    // Keyterm prompting is the only lever a monolingual Korean stream has
    // against an English technical term, so the English forms must arrive.
    expect(params.getAll("keyterm")).toEqual(["social capital", "Putnam"]);
  });

  it("gives OpenAI the registry's language code and a code-switching prompt", () => {
    const provider = new OpenAiSpeechProvider({
      language: "ko-KR",
      guestLanguage: "en-US",
      hints: ["RAG", "Putnam"],
      credentials: { provider: "openai", token: "t", model: "gpt-live-transcribe" },
    });
    const message = JSON.parse(
      (provider as unknown as { openMessage(): string }).openMessage(),
    ) as {
      session: { input_audio_transcription: { language: string; prompt?: string } };
    };
    const transcription = message.session.input_audio_transcription;
    // Resolved through the registry rather than `tag.split("-")[0]`.
    expect(transcription.language).toBe("ko");
    expect(transcription.prompt).toContain("English");
    expect(transcription.prompt).toContain("do not transliterate");
    expect(transcription.prompt).toContain("RAG");
  });

  it("says nothing about a guest language when there is not one", () => {
    const provider = new OpenAiSpeechProvider({
      language: "ko-KR",
      guestLanguage: "ko-KR",
      credentials: { provider: "openai", token: "t" },
    });
    const message = JSON.parse(
      (provider as unknown as { openMessage(): string }).openMessage(),
    ) as { session: { input_audio_transcription: { prompt?: string } } };
    expect(message.session.input_audio_transcription.prompt).toBeUndefined();
  });

  it("reports the Whisper family as inherently multilingual", () => {
    // Its language parameter biases the decoder rather than constraining it,
    // which is why this is the path that handles Korean-English mixing best.
    expect(sttCodeSwitchSupport("openai", "ko-KR", "en-US")).toBe("inherent");
    expect(sttCodeSwitchSupport("webspeech", "ko-KR", "en-US")).toBe("none");
  });
});

describe("the vocabulary a live session hands its recogniser", () => {
  const prep = (over: Partial<PrepSheet> = {}): PrepSheet => ({ ...emptyPrepSheet(), ...over });

  it("sends both languages' forms of a term the interpreter prepared", () => {
    const hints = buildSttHints(
      "lecture",
      prep({
        entities: [{ korean: "퍼트넘", english: "Putnam", kind: "person" }],
        glossary: [{ korean: "사회적 자본", english: "social capital" }],
      }),
      { includeGuestForms: true },
    );
    expect(hints).toContain("사회적 자본");
    // A Korean-only keyterm list tells the recogniser English is not expected,
    // which is the opposite of true for a speaker who says both in one breath.
    expect(hints).toContain("social capital");
    expect(hints).toContain("Putnam");
  });

  it("picks up Latin terms written into today's material", () => {
    const hints = buildSttHints(
      "meeting",
      prep({ notes: "Discuss the RAG rollout and the Vercel migration." }),
      { includeGuestForms: true },
    );
    expect(hints).toContain("RAG");
    expect(hints).toContain("Vercel");
  });

  it("leaves a one-language turn's vocabulary alone", () => {
    // Counter Mode translates ONE utterance in one language; adding the other
    // side's vocabulary would bias a recogniser that has no reason to hear it.
    const hints = buildSttHints(
      "conversation",
      prep({ glossary: [{ korean: "체류자격", english: "residence status" }] }),
    );
    expect(hints).toContain("체류자격");
    expect(hints).not.toContain("residence status");
  });
});
