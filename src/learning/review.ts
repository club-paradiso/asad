import type { TranslationIntegrity } from "@/counter/types";
import type { HumanReviewFlag } from "./types";

const KOREAN_EXPLICIT_THREAT =
  /(?:죽이겠|죽여\s*버리|살해하겠|해치겠|불\s*지르겠|폭파하겠|칼로\s*(?:찌르|찔러)|총으로\s*(?:쏘|쏴))/i;
const ENGLISH_EXPLICIT_THREAT =
  /\b(?:i(?:'ll| will| am going to)\s+(?:kill|hurt|shoot|stab|bomb|burn)|kill you|shoot you|stab you|bomb (?:this|the))\b/i;

const KOREAN_SELF_HARM = /(?:죽고\s*싶|자살하겠|스스로\s*목숨|내가\s*죽겠)/i;
const ENGLISH_SELF_HARM =
  /\b(?:i want to die|i(?:'ll| will| am going to) kill myself|i am going to end my life)\b/i;

// High-precision first-person phrases in every language offered by Counter
// Mode. These flags only ask a human to inspect the current turn; they never
// create a person-level label or make an administrative decision.
const MULTILINGUAL_EXPLICIT_THREAT = [
  /(?:我要杀你|我會殺你|我要殺你|我会杀了你)/,
  /(?:お前を殺す|殺してやる)/,
  /(?:tôi|tao)\s+sẽ\s+giết\s+(?:bạn|mày)/i,
  /(?:ฉันจะฆ่าคุณ|กูจะฆ่ามึง)/,
  /(?:saya|aku)\s+akan\s+membunuhmu/i,
  /я\s+тебя\s+убью/i,
  /(?:te\s+voy\s+a\s+matar|voy\s+a\s+matarte)/i,
  /je\s+vais\s+te\s+tuer/i,
  /(?:سأقتلك|سوف\s+أقتلك)/,
  /मैं\s+तुम्हें\s+मार\s+द(?:ूँ|ू)गा/,
  /seni\s+öldüreceğim/i,
  /seni\s+o['’ʻ]?ldiraman/i,
  /чамайг\s+ална/i,
  /म\s+तिमीलाई\s+मार्छु/,
  /ខ្ញុំនឹងសម្លាប់អ្នក/,
];

const MULTILINGUAL_SELF_HARM = [
  /(?:我想死|我要自杀|我要自殺)/,
  /(?:死にたい|自殺する)/,
  /tôi\s+(?:muốn\s+chết|sẽ\s+tự\s+sát)/i,
  /(?:ฉันอยากตาย|ฉันจะฆ่าตัวตาย)/,
  /(?:saya|aku)\s+ingin\s+mati|(?:saya|aku)\s+akan\s+bunuh\s+diri/i,
  /(?:я\s+хочу\s+умереть|я\s+покончу\s+с\s+собой)/i,
  /(?:quiero\s+morir|voy\s+a\s+suicidarme)/i,
  /(?:je\s+veux\s+mourir|je\s+vais\s+me\s+suicider)/i,
  /(?:أريد\s+أن\s+أموت|سأنتحر)/,
  /मैं\s+मरना\s+चाह(?:ता|ती)\s+हूँ/,
  /(?:ölmek\s+istiyorum|intihar\s+edeceğim)/i,
  /o['’ʻ]?lmoqchiman/i,
  /үхмээр\s+байна/i,
  /म\s+मर्न\s+चाहन्छु/,
  /ខ្ញុំចង់ស្លាប់/,
];

const matchesAny = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

export function buildHumanReviewFlags(input: {
  sourceText: string;
  confidence?: "high" | "medium" | "low";
  integrity?: TranslationIntegrity;
}): HumanReviewFlag[] {
  const flags: HumanReviewFlag[] = [];

  if (input.integrity?.status === "mismatch") {
    flags.push({
      kind: "translation-integrity",
      severity: "review",
      reason: "숫자·날짜·이름 등 핵심 값이 번역 과정에서 달라졌을 수 있습니다.",
    });
  }

  if (input.confidence === "low") {
    flags.push({
      kind: "low-confidence",
      severity: "review",
      reason: "번역 신뢰도가 낮습니다. 원문과 번역문을 직접 확인해 주세요.",
    });
  }

  if (
    KOREAN_EXPLICIT_THREAT.test(input.sourceText) ||
    ENGLISH_EXPLICIT_THREAT.test(input.sourceText) ||
    matchesAny(MULTILINGUAL_EXPLICIT_THREAT, input.sourceText)
  ) {
    flags.push({
      kind: "explicit-threat",
      severity: "urgent",
      reason: "현재 발화에 구체적인 위해·폭력 표현이 감지되었습니다. 사람의 확인이 필요합니다.",
    });
  }

  if (
    KOREAN_SELF_HARM.test(input.sourceText) ||
    ENGLISH_SELF_HARM.test(input.sourceText) ||
    matchesAny(MULTILINGUAL_SELF_HARM, input.sourceText)
  ) {
    flags.push({
      kind: "self-harm-language",
      severity: "urgent",
      reason: "현재 발화에 명시적인 자해·자살 관련 표현이 감지되었습니다. 사람의 확인이 필요합니다.",
    });
  }

  return flags;
}

export const hasSafetyReviewFlag = (flags: readonly HumanReviewFlag[] | undefined): boolean =>
  !!flags?.some((flag) => flag.kind === "explicit-threat" || flag.kind === "self-harm-language");
