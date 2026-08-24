/**
 * Benchmark dataset for live interpretation.
 *
 * Twenty cases, each one an interpretation problem a working Korean→English
 * interpreter would name as hard. Every case carries machine-checkable
 * expectations so a provider can be scored without a human in the loop, plus
 * enough context for a human to judge the cases machines cannot.
 *
 * `forbidden` entries are the important ones: they encode renderings that are
 * *specifically wrong* for this product, most notably the literal wordplay
 * failure the brief names as disqualifying.
 */
import type { InterpretationMode } from "@/types";

export type BenchCategory =
  | "declarative"
  | "delayed-predicate"
  | "fast-rhetorical"
  | "incomplete"
  | "self-correction"
  | "scripture-reference"
  | "scripture-paraphrase"
  | "terminology"
  | "idiom"
  | "proper-noun"
  | "wordplay"
  | "testimony"
  | "prayer"
  | "humour"
  | "repetition"
  | "cultural"
  | "ambiguous-pronoun"
  | "context-dependent-term"
  | "early-restructuring"
  | "anticipation-hazard";

export interface BenchCase {
  id: string;
  category: BenchCategory;
  mode: InterpretationMode;
  korean: string;
  /** Why this case is hard, shown in the human review sheet. */
  challenge: string;
  /** Prior turns, so context-dependent cases are actually context-dependent. */
  priorKorean?: string[];
  priorEnglish?: string[];
  expect: {
    /** Scripture that must be detected, in display form. */
    scripture?: string[];
    /** Case-insensitive substrings that must appear somewhere in the output. */
    required?: string[];
    /** Case-insensitive substrings that must NEVER appear. */
    forbidden?: string[];
    /** A cultural note of one of these kinds must be produced. */
    culturalKinds?: string[];
    /** Output must not exceed this many chunks. */
    maxChunks?: number;
    /** No chunk may exceed this many words. */
    maxWordsPerChunk?: number;
    /** Anticipation would be dangerous here; there must be none. */
    forbidAnticipation?: boolean;
  };
  /** What a good rendering looks like, for the human review sheet. */
  reference?: string;
}

export const BENCH_CASES: BenchCase[] = [
  {
    id: "b01",
    category: "declarative",
    mode: "sermon",
    korean: "여러분, 반갑습니다. 오늘 이 자리에 함께해 주셔서 감사합니다.",
    challenge: "Ordinary sermon opening — the baseline everything else is measured against.",
    expect: { maxChunks: 4, maxWordsPerChunk: 14, forbidden: ["thanksgiving"] },
    reference: "Good morning, everyone. / Thank you for being here today.",
  },
  {
    id: "b02",
    category: "delayed-predicate",
    mode: "sermon",
    korean:
      "제가 오늘 이 자리에서 여러분과 함께 꼭 나누고 싶은 한 가지 이야기가 있는데 그것은 바로 우리의 정체성에 관한 것입니다.",
    challenge:
      "Long sentence holding its payload to the very end. English must lead with a topic frame or the interpreter cannot start.",
    expect: { maxWordsPerChunk: 16, required: ["today"] },
    reference: "There's one thing I really want to share with you today... / and it's about who we are.",
  },
  {
    id: "b03",
    category: "fast-rhetorical",
    mode: "sermon",
    korean:
      "여러분 그렇지 않습니까? 정말 그렇지 않습니까? 우리가 정말 그렇게 살고 있습니까?",
    challenge: "Rapid rhetorical questions to the room. Must stay short and keep the drive.",
    expect: { maxWordsPerChunk: 12, forbidden: ["furthermore", "moreover"] },
    reference: "Isn't that right? / Isn't it though? / Are we really living like that?",
  },
  {
    id: "b04",
    category: "incomplete",
    mode: "sermon",
    korean: "그런데 우리가 이 놀라운 은혜를 받고도",
    challenge:
      "Unfinished. A scaffold is honest; completing the thought is invention.",
    expect: {
      forbidAnticipation: false,
      forbidden: ["we forget who we are.", "we turn away from god"],
      maxChunks: 3,
    },
    reference: "And yet, even after receiving this amazing grace...",
  },
  {
    id: "b05",
    category: "self-correction",
    mode: "general",
    korean: "그 자리에는 한 삼천... 아니, 삼백 명 정도가 모였습니다.",
    challenge: "Speaker corrects a number mid-sentence. The wrong figure must not survive.",
    expect: { forbidden: ["three thousand", "3,000", "3000"] },
    reference: "There were about three hundred people there.",
  },
  {
    id: "b06",
    category: "scripture-reference",
    mode: "sermon",
    korean: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
    challenge: "The acceptance case. Reference must normalise; wording must not be invented.",
    expect: {
      scripture: ["1 Peter 2:9"],
      required: ["1 peter 2:9"],
      forbidden: ["chosen race", "but you are a chosen", "royal priesthood, a holy nation, a people"],
      maxChunks: 4,
    },
    reference: "Today we're going to look at... / 1 Peter 2:9.",
  },
  {
    id: "b07",
    category: "scripture-paraphrase",
    mode: "sermon",
    korean: "베드로 사도는 우리가 택하신 족속이라고 말합니다.",
    challenge:
      "Paraphrase rather than citation. Must render the paraphrase, not quote a translation it was not given.",
    expect: { required: ["chosen"], forbidden: ["but you are a chosen race"] },
    reference: "Peter says we are a chosen people.",
  },
  {
    id: "b08",
    category: "terminology",
    mode: "sermon",
    korean: "칭의는 단번에 이루어지지만 성화는 평생에 걸쳐 계속됩니다.",
    challenge:
      "Two technical terms that must stay technical. Softening them loses the distinction the sentence exists to make.",
    expect: { required: ["justification", "sanctification"] },
    reference: "Justification happens once and for all, / but sanctification continues your whole life.",
  },
  {
    id: "b09",
    category: "idiom",
    mode: "general",
    korean: "티끌 모아 태산이라고 하지 않습니까?",
    challenge: "Literal rendering destroys the proverb.",
    expect: {
      culturalKinds: ["idiom"],
      forbidden: ["specks", "dust", "great mountain", "gather dust"],
    },
    reference: "You know the saying — little by little, it adds up.",
  },
  {
    id: "b10",
    category: "proper-noun",
    mode: "sermon",
    korean: "오늘 말씀은 류정길 목사님께서 전해 주시겠습니다.",
    challenge:
      "Korean name must romanise conventionally. 'Ryu', not the strict-RR 'Lyu'; surname first.",
    expect: { required: ["ryu"], forbidden: ["yu jeong", "lyu"] },
    reference: "Today's message will be brought by Pastor Ryu Jeong-gil.",
  },
  {
    id: "b11",
    category: "wordplay",
    mode: "sermon",
    korean: "그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.",
    priorKorean: ["오늘 말씀은 류정길 목사님께서 전해 주시겠습니다."],
    challenge:
      "The brief's disqualifying case. Literal translation kills the joke and the interpreter cannot recover once said.",
    expect: {
      culturalKinds: ["wordplay", "hanja"],
      required: ["way"],
      forbidden: ["road in my name", "find the road well", "there is a road"],
    },
    reference:
      'So we need to find the right way. / And speaking of "the way," it\'s even in my name.',
  },
  {
    id: "b12",
    category: "testimony",
    mode: "sermon",
    korean: "제가 스무 살 때 정말 힘든 시간을 보냈습니다. 그때 하나님을 만났습니다.",
    challenge: "Narrative past, personal register. Must not become expository.",
    expect: { maxWordsPerChunk: 14, forbidden: ["it is worth noting"] },
    reference: "When I was twenty I went through a really hard time. / That's when I met God.",
  },
  {
    id: "b13",
    category: "prayer",
    mode: "sermon",
    korean: "사랑의 하나님, 오늘 이 말씀을 통해 우리를 만나 주시옵소서.",
    challenge: "Register shifts to direct address. English must follow.",
    expect: { required: ["god"], maxWordsPerChunk: 14 },
    reference: "God of love, / meet us today through this word.",
  },
  {
    id: "b14",
    category: "humour",
    mode: "sermon",
    korean: "사실 제가 어젯밤에 설교 준비하다가 그만 잠들었습니다. 아멘 하실 분?",
    challenge:
      "아멘 하실 분 invites a response an English-speaking room may not give. Needs a flag, not a literal render.",
    expect: { required: ["amen"], maxWordsPerChunk: 16 },
    reference:
      "Last night I actually fell asleep preparing this sermon. / Anyone want to say amen to that?",
  },
  {
    id: "b15",
    category: "repetition",
    mode: "sermon",
    korean:
      "여러분은 택하신 족속입니다. 여러분은 왕 같은 제사장입니다. 여러분은 거룩한 나라입니다.",
    challenge: "Repetition IS the rhetoric here. Compressing it flattens the sermon.",
    expect: { required: ["you are a chosen", "you are a holy"], maxWordsPerChunk: 12 },
    reference: "You are a chosen people. / You are a royal priesthood. / You are a holy nation.",
  },
  {
    id: "b16",
    category: "cultural",
    mode: "sermon",
    korean: "우리 교회는 새벽기도로 유명한 교회입니다.",
    challenge: "새벽기도 is a Korean church institution, not a time of day.",
    expect: { required: ["early morning prayer"], forbidden: ["dawn prayer at 5"] },
    reference: "Our church is known for early morning prayer.",
  },
  {
    id: "b17",
    category: "ambiguous-pronoun",
    mode: "general",
    korean: "그분이 그렇게 말씀하셨을 때, 그 사람은 아무 대답도 하지 않았습니다.",
    priorKorean: ["김 목사님이 이재훈 집사님을 만나셨습니다."],
    priorEnglish: ["Pastor Kim met with Deacon Lee Jae-hoon."],
    challenge:
      "Korean drops and reuses referents. Getting 그분 vs 그 사람 backwards inverts the sentence.",
    expect: { forbidden: ["he said to himself"] },
    reference: "When he said that, the other man didn't answer at all.",
  },
  {
    id: "b18",
    category: "context-dependent-term",
    mode: "sermon",
    korean: "오늘 하루도 은혜 많이 받으세요.",
    challenge:
      "은혜 is 'grace' as theology but a blessing in a farewell. Technical rendering here is wrong.",
    expect: { forbidden: ["receive much grace", "receive a lot of grace"] },
    reference: "I hope you're richly blessed today.",
  },
  {
    id: "b19",
    category: "early-restructuring",
    mode: "general",
    korean:
      "제가 지난 삼 년 동안 이 프로젝트를 준비하면서 가장 크게 배운 것은 결국 사람이 전부라는 사실이었습니다.",
    challenge:
      "The lesson arrives last. English must open with a frame so the interpreter can begin speaking.",
    expect: { maxWordsPerChunk: 16, required: ["people"] },
    reference:
      "Over the last three years working on this project, / the biggest thing I learned was this: / in the end, it's all about people.",
  },
  {
    id: "b20",
    category: "anticipation-hazard",
    mode: "sermon",
    korean: "그래서 제가 여러분께 드리고 싶은 질문은 바로",
    challenge:
      "Cut mid-frame before the question exists. Predicting the content here is exactly the failure mode that destroys trust.",
    expect: {
      forbidAnticipation: true,
      maxChunks: 2,
      forbidden: ["do you love god", "are you saved", "what is your purpose"],
    },
    reference: "So the question I want to put to you is this...",
  },
];

export const casesByCategory = (): Record<string, BenchCase[]> => {
  const map: Record<string, BenchCase[]> = {};
  for (const c of BENCH_CASES) (map[c.category] ??= []).push(c);
  return map;
};
