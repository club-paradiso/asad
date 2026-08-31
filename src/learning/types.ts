export type HumanReviewFlagKind =
  | "translation-integrity"
  | "low-confidence"
  | "explicit-threat"
  | "self-harm-language";

export interface HumanReviewFlag {
  kind: HumanReviewFlagKind;
  severity: "review" | "urgent";
  /** Session-scoped explanation for a human reviewer. Never a person-level label. */
  reason: string;
}

export interface LearningCandidate {
  id: string;
  createdAt: number;
  sourceLang: string;
  targetLang: string;
  profileId: string;
  sourceText: string;
  modelTranslation: string;
  /** Hash of the redacted source for dedupe without keeping an identity key. */
  sourceHash: string;
  origin: "verified-model";
}
