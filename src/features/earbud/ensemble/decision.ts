/**
 * Conservative, deterministic gate for selecting a translation to SPEAK.
 * This is not a learned reference-free translation quality metric. It can
 * reject known hazards and detect disagreement, not certify meaning.
 */
export type EnsembleProvider = "index" | "azure";
export interface TranslationCandidate {
  provider: EnsembleProvider;
  text: string;
  latencyMs: number;
}
export type Selection =
  | { kind: "accepted"; candidate: TranslationCandidate; agreement: number; reason: string }
  | { kind: "needs-judge"; candidates: TranslationCandidate[]; reason: string }
  | { kind: "abstain"; reason: string };

const KOREAN = /[가-힣]/;
const ENGLISH_WORD = /\b[a-z]{2,}\b/i;
const ENGLISH_NEGATION = /\b(?:not|never|no|without|neither|nor|cannot|can\x27t|won\x27t|don\x27t|doesn\x27t|didn\x27t|hasn\x27t|haven\x27t|isn\x27t|aren\x27t|unapproved|denied|rejected|pending)\b/i;
// Avoid matching "1" from E-7-1 as a separate overlapping identifier.
export function criticalTokens(text: string): string[] {
  const tokens = text.match(/\b[A-Z]{1,4}-\d+(?:-\d+)*\b|\b\d+(?:[.,:/-]\d+)*%?\b/gi) ?? [];
  return [...new Set(tokens.map((t) => t.replace(/,/g, "").toUpperCase()))];
}
function polarity(text: string): boolean {
  return /(?:않|못|없|아니|미승인|미허가|불허|거부|금지|아직|취소|중단)/.test(text);
}
function sourceNegative(source: string): boolean | null {
  // Only assert polarity for English and Korean; do not guess in other languages.
  if (KOREAN.test(source)) return polarity(source) ? true : null;
  if (!/[A-Za-z]/.test(source) || /[\u3040-\u9fff]/.test(source)) return null;
  return /\b(?:not|never|no|cannot|can't|won't|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|without)\b/i.test(source);
}
/** Accept a clock rendered naturally as Korean hh시 mm분, not arbitrary numbers. */
export function preservesCriticalTokens(source: string, translated: string): boolean {
  const preserved = new Set(criticalTokens(translated));
  return criticalTokens(source).every(token => {
    if (preserved.has(token)) return true;
    const clock = /^(\d{1,2}):(\d{2})$/.exec(token);
    if (!clock) return false;
    const hour = String(Number(clock[1])), minute = String(Number(clock[2]));
    // A safe equivalent time must keep both hour and minute in order.
    const display = new RegExp(`(?:^|[^0-9])0?${hour}\\s*시\\s*0?${minute}\\s*분`);
    return display.test(translated);
  });
}

export function checkCandidate(source: string, text: string, target = "ko-KR"): { ok: boolean; reason: string } {
  const clean = text.trim();
  if (!clean || clean.length > 800) return { ok: false, reason: "empty or oversized" };
  if (target === "ko-KR" && !KOREAN.test(clean)) return { ok: false, reason: "missing Korean translation" };
  if (target === "en-US" && !ENGLISH_WORD.test(clean)) return { ok: false, reason: "missing English translation" };
  if (target !== "ko-KR" && target !== "en-US") return { ok: false, reason: "unsupported target" };
  if (/<\/?(?:think|reasoning|script|system|tool)>/i.test(clean))
    return { ok: false, reason: "model markup" };
  if (!preservesCriticalTokens(source, clean))
    return { ok: false, reason: "missing identifier, amount or number" };
  const negative = sourceNegative(source);
  if (negative === true && !(target === "ko-KR" ? polarity(clean) : ENGLISH_NEGATION.test(clean)))
    return { ok: false, reason: "possibly lost source negation" };
  return { ok: true, reason: "basic checks passed" };
}
function words(text: string): Set<string> {
  return new Set(text.replace(/[.,!?，。！？():\[\]"']/g, " ").split(/\s+/).map(w => w.trim()).filter(Boolean));
}
export function overlap(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  const intersection = [...x].filter(w => y.has(w)).length;
  return (2 * intersection) / (x.size + y.size);
}
export function chooseTranslation(source: string, incoming: TranslationCandidate[], target = "ko-KR"): Selection {
  const valid = incoming.filter(c => checkCandidate(source, c.text, target).ok);
  if (!valid.length) return { kind: "abstain", reason: "no candidate passed essential safety checks" };
  if (valid.length < 2) return {
    kind: "abstain", reason: "only one provider returned a validated result; no consensus",
  };
  const [index, azure] = valid;
  const similarity = overlap(index.text, azure.text);
  const negation = (text: string) => target === "ko-KR" ? polarity(text) : ENGLISH_NEGATION.test(text);
  if (negation(index.text) !== negation(azure.text))
    return { kind: "needs-judge", candidates: valid, reason: "Korean negation mismatch" };
  // A semantic paraphrase may legitimately have low word overlap; it requires
  // an arbiter, not a falsely confident majority vote.
  if (similarity < 0.72)
    return { kind: "needs-judge", candidates: valid, reason: "translation wording/meaning disagreement" };
  // Prefer the translation-specialist candidate at similar agreement, but
  // never call this a correctness certificate.
  return {
    kind: "accepted",
    candidate: valid.find(c => c.provider === "index") ?? index,
    agreement: similarity,
    reason: "independent candidates pass invariants and substantially agree",
  };
}
