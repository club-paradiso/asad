/**
 * Korean labels for the Live launcher and the console's settings sheet.
 *
 * They live here rather than in `lag.ts` / `providers/stt` / `types` on
 * purpose: those modules are shared with the live console's reading path,
 * which stays in the TARGET language because its content is what the
 * interpreter is about to say. The chrome around it — the launcher, the
 * settings sheet, the context control — is read by a Korean interpreter with
 * time to spare, so it follows the reader.
 *
 * Provider names stay Latin. "Deepgram" is a proper noun and transliterating
 * it helps nobody.
 */
import type { ContextDomain, DomainSource, LagProfile, ResolvedDomain } from "@/types";
import type { SttProviderId } from "@/providers/stt";

/** The context control's labels. `auto` is the default and the normal case. */
export const CONTEXT_LABEL_KO: Record<ContextDomain, string> = {
  auto: "자동",
  worship: "예배",
  sermon: "설교",
  lecture: "강의",
  meeting: "회의",
  conversation: "대화",
  presentation: "발표",
  event: "행사",
  generic: "일반",
};

export const contextLabel = (domain: ContextDomain): string => CONTEXT_LABEL_KO[domain];

/** How the Context Engine arrived at its answer, as a short Korean word. */
export const DOMAIN_SOURCE_KO: Record<DomainSource, string> = {
  manual: "직접 지정",
  prep: "준비 시트",
  inferred: "추론",
  default: "기본값",
};

/** Coarse confidence words. Never a percentage on screen. */
export function confidenceWord(confidence: number): string {
  if (confidence >= 0.75) return "높음";
  if (confidence >= 0.45) return "보통";
  return "낮음";
}

/**
 * The one-line explanation under the context control while it is on `auto`:
 * "자동 · 지금은 설교로 판단 (높음)".
 */
export function inferredContextLine(domain: ResolvedDomain, confidence: number): string {
  return `자동 · 지금은 ${CONTEXT_LABEL_KO[domain]}로 판단 (${confidenceWord(confidence)})`;
}

export const LAG_LABEL_KO: Record<LagProfile, string> = {
  fast: "빠르게",
  balanced: "기본",
  safe: "안전하게",
};

export const LAG_DETAIL_KO: Record<LagProfile, string> = {
  fast: "약 1초 뒤따라갑니다 — 예측이 가장 많고, 고칠 일도 가장 많습니다",
  balanced: "약 2–3초 뒤따라갑니다 — 평소 작업용 기본값",
  safe: "약 4–6초 뒤따라갑니다 — 문장이 끝나길 기다리고, 예측하지 않습니다",
};

export const SOURCE_LABEL_KO: Partial<Record<SttProviderId, string>> = {
  demo: "데모",
  webspeech: "브라우저",
};

export const SOURCE_DETAIL_KO: Partial<Record<SttProviderId, string>> = {
  demo: "미리 녹음된 설교 — 마이크도 키도 필요 없고, 오프라인에서도 됩니다",
  webspeech:
    "브라우저가 인식을 관리합니다 — 브라우저 제공자의 서버로 음성이 전송될 수 있습니다",
  deepgram: "스트리밍 인식 — 중간 결과와 용어 힌트를 지원합니다",
  openai: "웹소켓 기반 실시간 인식",
};

/** The remember-corrections toggle's privacy hint. One sentence, no hedging. */
export const REMEMBER_CORRECTIONS_HINT =
  "이 브라우저에만 저장. 확인한 이름·용어만, 대화 내용은 저장하지 않습니다.";
