/**
 * Deterministic interpretation-quality fixtures.
 *
 * These exercise the parts of the quality path that need no model: the
 * Repair Engine's source and target checks, the Entity Memory, the
 * Translation Memory ladder, the Context Engine and the stability gate. Every
 * fixture is a class of failure, not a memorised example — the entities and
 * phrases here are made up for the harness and are never referenced by the
 * library code.
 *
 * Provider-dependent quality (what a cloud model returns) is measured by
 * `npm run bench:llm`, which needs credentials; this harness runs anywhere.
 */
import type { LanguagePair } from "@/types";

export interface EntitySeed {
  canonical: string;
  target: string;
  kind?: "person" | "place" | "organisation" | "work" | "other";
  provenance: "user" | "prep" | "glossary" | "inferred" | "model";
  /** How many times the model has established it (for inferred/model). */
  repeats?: number;
}

export interface SourceRepairFixture {
  id: string;
  language: string;
  entities: EntitySeed[];
  /** What the recogniser wrote. */
  heard: string;
  /** What should reach the pipeline. Same as `heard` when no repair is allowed. */
  expected: string;
  /** Recogniser metadata, when the fixture depends on it. */
  meta?: { confidence?: number; alternatives?: string[] };
  /** True when a repair here would be an unnecessary or wrong repair. */
  mustNotRepair?: boolean;
  /** A medium-band hypothesis is acceptable (and expected) instead of a repair. */
  expectHypothesis?: boolean;
  challenge: string;
}

export interface TargetCheckFixture {
  id: string;
  pair: LanguagePair;
  source: string;
  target: string[];
  entities?: EntitySeed[];
  /** Issue kinds that must be raised. */
  expectKinds: string[];
  /** When a fix is expected, the text the fixed target must contain. */
  expectFixedContains?: string;
  /** True when nothing may be flagged — a false alarm is a failure. */
  quiet?: boolean;
  challenge: string;
}

export interface StabilityFixture {
  id: string;
  language: string;
  current: string[];
  proposed: string[];
  /** Whether replacing is a genuine correction. */
  different: boolean;
  challenge: string;
}

export interface DomainFixture {
  id: string;
  language: string;
  units: string[];
  expect: "worship" | "sermon" | "lecture" | "meeting" | "conversation" | "presentation" | "event" | "generic";
  /** Domains this must NOT settle on. */
  forbid?: string[];
  challenge: string;
}

export const SOURCE_REPAIR_FIXTURES: SourceRepairFixture[] = [
  {
    id: "r01",
    language: "ko-KR",
    entities: [{ canonical: "새빛교회", target: "Saebit Church", kind: "organisation", provenance: "user" }],
    heard: "새 빛 교회에 오신 여러분을 환영합니다.",
    expected: "새빛교회에 오신 여러분을 환영합니다.",
    challenge: "Spacing corruption of a user-confirmed organisation name.",
  },
  {
    id: "r02",
    language: "ko-KR",
    entities: [{ canonical: "새빛교회", target: "Saebit Church", kind: "organisation", provenance: "user" }],
    heard: "새 빗 교회에서 만납시다.",
    expected: "새빛교회에서 만납시다.",
    challenge: "Phonetically similar syllable (빗/빛) plus spacing, user-confirmed entity.",
  },
  {
    id: "r03",
    language: "ko-KR",
    entities: [{ canonical: "새빛교회", target: "Saebit Church", kind: "organisation", provenance: "user" }],
    heard: "새 빗자루로 교회 마당을 쓸었습니다.",
    expected: "새 빗자루로 교회 마당을 쓸었습니다.",
    mustNotRepair: true,
    challenge: "A superficially similar phrase that is ordinary speech. Binding it would be an invented entity.",
  },
  {
    id: "r04",
    language: "ko-KR",
    entities: [{ canonical: "박성훈 목사", target: "Pastor Sung-hoon Park", kind: "person", provenance: "user" }],
    heard: "박성운 목사님께서 기도해 주시겠습니다.",
    expected: "박성훈 목사님께서 기도해 주시겠습니다.",
    challenge: "One-syllable corruption of a confirmed person name, honorific attached.",
  },
  {
    id: "r05",
    language: "ko-KR",
    entities: [{ canonical: "박성훈 목사", target: "Pastor Sung-hoon Park", kind: "person", provenance: "model", repeats: 1 }],
    heard: "박성운 목사님께서 기도해 주시겠습니다.",
    expected: "박성운 목사님께서 기도해 주시겠습니다.",
    expectHypothesis: true,
    challenge: "Same corruption, but the entity rests on a single model answer: hypothesis, not repair.",
  },
  {
    id: "r06",
    language: "ko-KR",
    entities: [{ canonical: "김하늘 집사", target: "Deacon Ha-neul Kim", kind: "person", provenance: "user" }],
    heard: "오늘 하늘이 참 맑습니다.",
    expected: "오늘 하늘이 참 맑습니다.",
    mustNotRepair: true,
    challenge: "A name syllable used as an ordinary noun (하늘 = sky). No entity here.",
  },
  {
    id: "r07",
    language: "ko-KR",
    entities: [{ canonical: "새빛교회", target: "Saebit Church", kind: "organisation", provenance: "user" }],
    heard: "새 빗 교회 청년부가 준비했습니다.",
    expected: "새빛교회 청년부가 준비했습니다.",
    meta: { confidence: 0.41, alternatives: ["새빛교회 청년부가 준비했습니다."] },
    challenge: "Low recogniser confidence and an alternative that matches the canonical form: strong evidence.",
  },
  {
    id: "r08",
    language: "en-US",
    entities: [{ canonical: "New Song Church", target: "뉴송교회", kind: "organisation", provenance: "user" }],
    heard: "Welcome to new son church this morning.",
    expected: "Welcome to New Song Church this morning.",
    challenge: "Latin-script corruption of a confirmed name (son/Song).",
  },
  {
    id: "r09",
    language: "en-US",
    entities: [{ canonical: "New Song Church", target: "뉴송교회", kind: "organisation", provenance: "user" }],
    heard: "My son goes to church every week.",
    expected: "My son goes to church every week.",
    mustNotRepair: true,
    challenge: "The same words as ordinary speech. Must not become the church.",
  },
  {
    id: "r10",
    language: "zh-CN",
    entities: [{ canonical: "新光教会", target: "Xinguang Church", kind: "organisation", provenance: "user" }],
    heard: "欢迎大家来到新广教会。",
    expected: "欢迎大家来到新光教会。",
    challenge: "Homophone character substitution (光/广) in a confirmed Chinese organisation name.",
  },
];

export const TARGET_CHECK_FIXTURES: TargetCheckFixture[] = [
  {
    id: "t01",
    pair: { source: "ko-KR", target: "en-US" },
    source: "다음 주 화요일 오후 3시에 모이겠습니다.",
    target: ["We will meet next Tuesday afternoon."],
    expectKinds: ["number"],
    challenge: "A time the room will act on vanished from the target.",
  },
  {
    id: "t02",
    pair: { source: "ko-KR", target: "en-US" },
    source: "다음 주 화요일 오후 3시에 모이겠습니다.",
    target: ["We will meet next Tuesday at 3 pm."],
    quiet: true,
    expectKinds: [],
    challenge: "Same sentence, number preserved: nothing to flag.",
  },
  {
    id: "t03",
    pair: { source: "ko-KR", target: "en-US" },
    source: "저는 그 제안에 동의하지 않습니다.",
    target: ["I agree with that proposal."],
    expectKinds: ["negation"],
    challenge: "Negation flipped. The single most dangerous silent error.",
  },
  {
    id: "t04",
    pair: { source: "ko-KR", target: "en-US" },
    source: "저는 그 제안에 동의하지 않습니다.",
    target: ["I do not agree with that proposal."],
    quiet: true,
    expectKinds: [],
    challenge: "Negation preserved.",
  },
  {
    id: "t05",
    pair: { source: "ko-KR", target: "en-US" },
    source: "박성훈 목사님께서 기도해 주시겠습니다.",
    target: ["Pastor Seong-hun Park will lead us in prayer."],
    entities: [{ canonical: "박성훈 목사", target: "Pastor Sung-hoon Park", kind: "person", provenance: "user" }],
    expectKinds: ["entity"],
    expectFixedContains: "Pastor Sung-hoon Park",
    challenge: "A confirmed romanisation rendered differently: fixed to the canonical target form.",
  },
  {
    id: "t06",
    pair: { source: "ko-KR", target: "zh-TW" },
    source: "우리는 하나님의 부르심을 받은 사람들입니다.",
    target: ["我们是蒙神呼召的人。"],
    expectKinds: ["script"],
    challenge: "Traditional target rendered in Simplified characters.",
  },
  {
    id: "t07",
    pair: { source: "ko-KR", target: "zh-TW" },
    source: "우리는 하나님의 부르심을 받은 사람들입니다.",
    target: ["我們是蒙神呼召的人。"],
    quiet: true,
    expectKinds: [],
    challenge: "Traditional target in Traditional script.",
  },
  {
    id: "t08",
    pair: { source: "ko-KR", target: "en-US" },
    source: "오늘 우리는 서로를 사랑해야 합니다.",
    target: ["오늘 우리는 서로를 사랑해야 합니다."],
    expectKinds: ["implausible"],
    challenge: "Untranslated echo of the source.",
  },
  {
    id: "t09",
    pair: { source: "en-US", target: "ko-KR" },
    source: "The deadline is May 31, 2026.",
    target: ["마감일은 2026년 5월 31일입니다."],
    quiet: true,
    expectKinds: [],
    challenge: "Date preserved across a script change: every digit is still there.",
  },
  {
    id: "t10",
    pair: { source: "en-US", target: "ko-KR" },
    source: "The deadline is May 31, 2026.",
    target: ["마감일은 2026년 5월입니다."],
    expectKinds: ["number"],
    challenge: "The day of the month was dropped.",
  },
];

export const STABILITY_FIXTURES: StabilityFixture[] = [
  {
    id: "s01",
    language: "en-US",
    current: ["Please sign in first."],
    proposed: ["First, please log in."],
    different: false,
    challenge: "The brief's example of a pointless rewrite.",
  },
  {
    id: "s02",
    language: "en-US",
    current: ["Please sign in first."],
    proposed: ["Please do not sign in first."],
    different: true,
    challenge: "Negation changed.",
  },
  {
    id: "s03",
    language: "en-US",
    current: ["We will meet at 3 pm."],
    proposed: ["We will meet at 8 pm."],
    different: true,
    challenge: "A number changed.",
  },
  {
    id: "s04",
    language: "en-US",
    current: ["We are people God has called."],
    proposed: ["We are those whom God has called."],
    different: false,
    challenge: "Same meaning, marginally different wording.",
  },
  {
    id: "s05",
    language: "en-US",
    current: ["Today we look at the passage."],
    proposed: ["Today's message is about forgiveness."],
    different: true,
    challenge: "A different sentence altogether.",
  },
  {
    id: "s06",
    language: "ko-KR",
    current: ["먼저 로그인해 주세요."],
    proposed: ["우선 로그인을 해 주세요."],
    different: false,
    challenge: "Korean stylistic restyle.",
  },
];

export const DOMAIN_FIXTURES: DomainFixture[] = [
  {
    id: "d01",
    language: "ko-KR",
    units: [
      "여러분, 반갑습니다. 오늘 이 자리에 함께해 주셔서 감사합니다.",
      "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
      "하나님의 은혜가 여러분과 함께하시기를 기도합니다.",
    ],
    expect: "sermon",
    challenge: "Scripture plus theology plus prayer: a service.",
  },
  {
    id: "d02",
    language: "en-US",
    units: [
      "Let's start with the agenda for this quarter.",
      "The KPI review is the first action item, then the budget.",
      "Who owns the follow-up on the vendor decision?",
    ],
    expect: "meeting",
    forbid: ["worship", "sermon"],
    challenge: "Meeting vocabulary in English.",
  },
  {
    id: "d03",
    language: "ko-KR",
    units: ["오늘 날씨가 참 좋습니다.", "다들 편안하게 앉으세요.", "커피 한 잔 하실래요?"],
    expect: "generic",
    forbid: ["worship", "sermon"],
    challenge: "Ordinary talk. No domain should be claimed.",
  },
  {
    id: "d04",
    language: "en-US",
    units: [
      "We hit this quarter's KPIs, but resources look tight for the next sprint.",
      "Amen to that, honestly.",
      "Let's move the budget line to next week's agenda.",
      "Action item for the vendor: confirm the quote.",
    ],
    expect: "meeting",
    forbid: ["worship", "sermon"],
    challenge: "One stray 'amen' in a meeting must not flip the domain.",
  },
  {
    id: "d05",
    language: "ko-KR",
    units: [
      "자, 그러면 다음 장으로 넘어가겠습니다.",
      "이 부분은 시험에 나올 가능성이 높으니까 집중해 주시기 바랍니다.",
      "교재 42쪽을 펴 주세요.",
    ],
    expect: "lecture",
    forbid: ["worship", "sermon"],
    challenge: "Lecture markers in Korean.",
  },
  {
    id: "d06",
    language: "zh-CN",
    units: ["我们今天一起来读约翰福音3章16节。", "神爱世人，愿恩典与你们同在。", "让我们一起祷告。"],
    expect: "sermon",
    challenge: "Chinese Scripture reference plus worship vocabulary.",
  },
];
