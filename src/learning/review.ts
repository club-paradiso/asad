import type { TranslationIntegrity } from "@/counter/types";
import type { HumanReviewFlag } from "./types";

const KOREAN_EXPLICIT_THREAT =
  /(?:죽이겠|죽여\s*버리|살해하겠|해치겠|불\s*지르겠|폭파하겠|칼로\s*(?:찌르|찔러)|총으로\s*(?:쏘|쏴))/i;
const ENGLISH_EXPLICIT_THREAT =
  /\b(?:i(?:'ll| will| am going to)\s+(?:kill|hurt|shoot|stab|bomb|burn)|kill you|shoot you|stab you|bomb (?:this|the))\b/i;

const KOREAN_SELF_HARM = /(?:죽고\s*싶|자살하겠|스스로\s*목숨|내가\s*죽겠)/i;
const ENGLISH_SELF_HARM =
  /\b(?:i want to die|i(?:'ll| will| am going to) kill myself|i am going to end my life)\b/i;

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

  if (KOREAN_EXPLICIT_THREAT.test(input.sourceText) || ENGLISH_EXPLICIT_THREAT.test(input.sourceText)) {
    flags.push({
      kind: "explicit-threat",
      severity: "urgent",
      reason: "현재 발화에 구체적인 위해·폭력 표현이 감지되었습니다. 사람의 확인이 필요합니다.",
    });
  }

  if (KOREAN_SELF_HARM.test(input.sourceText) || ENGLISH_SELF_HARM.test(input.sourceText)) {
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
