/**
 * Evaluation fixtures.
 *
 * One fixture per interpretation problem the product has to handle. These are
 * the cases a human interpreter would name as the hard ones, and they are
 * asserted on rather than eyeballed: `expectations` describe what the pipeline
 * must and must not do with each.
 *
 * Latency and interpreter usefulness are not asserted here — they are measured
 * against a real model, not a deterministic stub. See docs/interpreter-engine.md.
 */
export type FixtureCategory =
  | "declarative"
  | "delayed-predicate"
  | "long-sentence"
  | "incomplete"
  | "self-correction"
  | "scripture"
  | "terminology"
  | "idiom"
  | "cultural"
  | "wordplay"
  | "proper-noun"
  | "prayer"
  | "testimony"
  | "repetition"
  | "humour";

export interface Fixture {
  id: string;
  category: FixtureCategory;
  korean: string;
  /** Why this case is hard. */
  challenge: string;
  expect: {
    /** Scripture that must be detected, in display form. */
    scripture?: string[];
    /** Glossary terms that must be offered. */
    terms?: string[];
    /** Cultural note kinds that must fire. */
    cultural?: string[];
    /** Substrings that must never appear in English output. */
    forbidden?: string[];
    /** Substrings the English output must contain. */
    required?: string[];
    /** True when nothing should be detected — a guard against false positives. */
    quiet?: boolean;
  };
}

export const FIXTURES: Fixture[] = [
  {
    id: "f01",
    category: "declarative",
    korean: "우리는 하나님의 부르심을 받은 사람들입니다.",
    challenge: "Plain sentence — the baseline everything else is measured against.",
    expect: { terms: ["부르심", "하나님"] },
  },
  {
    id: "f02",
    category: "delayed-predicate",
    korean: "제가 오늘 여러분과 함께 나누고 싶은 것은 바로 우리의 정체성입니다.",
    challenge:
      "The payload arrives last. English needs a topic frame so the interpreter can start speaking.",
    expect: { required: ["Today, I'd like to talk with you about"] },
  },
  {
    id: "f03",
    category: "long-sentence",
    korean:
      "베드로 사도는 우리를 가리켜서 택하신 족속이요, 왕 같은 제사장들이요, 거룩한 나라요, 그의 소유가 된 백성이라고 말씀하고 있습니다.",
    challenge: "One Korean sentence, four English breath groups.",
    expect: {
      terms: ["택하신 족속", "왕 같은 제사장", "거룩한 나라"],
      required: ["a chosen people,", "a royal priesthood,"],
    },
  },
  {
    id: "f04",
    category: "incomplete",
    korean: "그런데 우리가 이 놀라운 은혜를 받고도",
    challenge: "Unfinished. A scaffold is honest; completing it is invention.",
    expect: { terms: ["은혜"], forbidden: ["we forget who we are."] },
  },
  {
    id: "f05",
    category: "self-correction",
    korean: "제가 처음 이 교회에 왔을 때, 한 삼천... 아니, 삼백 명 정도가 모였습니다.",
    challenge: "The speaker corrects a number mid-sentence. The wrong figure must not survive.",
    expect: { forbidden: ["three thousand"] },
  },
  {
    id: "f06",
    category: "scripture",
    korean: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
    challenge: "Spoken Korean reference must normalise, and the wording must not be invented.",
    expect: {
      scripture: ["1 Peter 2:9"],
      required: ["1 Peter 2:9."],
      forbidden: ["chosen race", "But you are"],
    },
  },
  {
    id: "f07",
    category: "terminology",
    korean: "칭의와 성화는 다른 것입니다. 대속의 은혜를 기억하십시오.",
    challenge: "Technical theology must stay technical, not be softened into paraphrase.",
    expect: { terms: ["칭의", "성화", "대속"] },
  },
  {
    id: "f08",
    category: "idiom",
    korean: "티끌 모아 태산이라고 하지 않습니까? 작은 순종이 쌓이는 겁니다.",
    challenge: "Literal rendering destroys the proverb.",
    expect: {
      cultural: ["idiom"],
      required: ["little by little, it adds up."],
      forbidden: ["specks", "great mountain"],
    },
  },
  {
    id: "f09",
    category: "cultural",
    korean: "우리 교회는 새벽기도로 유명한 교회입니다.",
    challenge: "새벽기도 is an institution, not a time of day.",
    expect: { cultural: ["cultural"], terms: ["새벽기도"] },
  },
  {
    id: "f10",
    category: "wordplay",
    korean: "그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.",
    challenge: "The brief's disqualifying case. Literal translation kills the joke.",
    expect: {
      cultural: ["wordplay"],
      required: ['even in my name'],
      forbidden: ["road in my name", "find the road well"],
    },
  },
  {
    id: "f11",
    category: "proper-noun",
    korean: "저는 오늘 말씀을 전하게 된 류정길 목사입니다.",
    challenge: "A name must romanise once and stay consistent for the whole session.",
    expect: { required: ["Ryu Jeong-gil"], terms: ["목사"] },
  },
  {
    id: "f12",
    category: "prayer",
    korean: "사랑의 하나님, 오늘 이 말씀을 통해 우리를 만나 주시옵소서.",
    challenge: "Register shifts to direct address. English must follow, not stay expository.",
    expect: { required: ["God of love,"] },
  },
  {
    id: "f13",
    category: "testimony",
    korean: "제가 처음 이 교회에 왔을 때, 한 삼천... 아니, 삼백 명 정도가 모였습니다.",
    challenge: "Narrative past tense, personal register.",
    expect: { required: ["When I first came to this church,"] },
  },
  {
    id: "f14",
    category: "repetition",
    korean: "여러분은 택하신 족속입니다. 여러분은 왕 같은 제사장입니다. 여러분은 거룩한 나라입니다.",
    challenge: "Repetition here is the rhetoric. Compressing it flattens the sermon.",
    expect: { required: ["You are a chosen people.", "You are a holy nation."] },
  },
  {
    id: "f15",
    category: "humour",
    korean: "사실 제가 어젯밤에 설교 준비하다가 그만 잠들었습니다. 아멘 하실 분?",
    challenge: "아멘 하실 분 invites a response an English-speaking room may not give.",
    expect: { cultural: ["humour"] },
  },
  {
    id: "f16",
    category: "declarative",
    korean: "오늘 날씨가 참 좋습니다. 다들 편안하게 앉으세요.",
    challenge:
      "False-positive guard: ordinary speech must produce no Scripture and no cultural notes.",
    expect: { quiet: true },
  },
];
