/**
 * One verdict over every automatic check on a translated turn.
 *
 * Combines the structured-value validator (numbers, dates, codes, negation)
 * with the administrative semantic checks, and states plainly what was NOT
 * checked. The word "passed" here means "no automatic check objected" — never
 * "a person verified this".
 */
import { validateTranslationIntegrity } from "../integrity";
import type { TranslationIntegrity } from "../types";
import { checkSemanticIntegrity, highestSeverity } from "./semantic";

export type IntegrityAssessment = "passed" | "review" | "blocked" | "unverified";

/** Semantic checks are on unless explicitly disabled. */
export const semanticChecksEnabled = (): boolean =>
  process.env.COUNTER_SEMANTIC_CHECKS?.trim().toLowerCase() !== "off";

export function assessTranslation(
  sourceText: string,
  targetText: string,
  sourceLanguage: string | undefined,
  targetLanguage: string | undefined,
  options: { semantic?: boolean } = {},
): TranslationIntegrity {
  const structured = validateTranslationIntegrity(sourceText, targetText, sourceLanguage, targetLanguage);
  if (options.semantic === false) {
    return {
      ...structured,
      assessment: structured.status === "mismatch" ? "blocked" : "unverified",
    };
  }

  const semantic = checkSemanticIntegrity(sourceText, targetText, sourceLanguage, targetLanguage);
  const worst = highestSeverity(semantic.issues);
  const material = worst === "critical" || worst === "high";

  const assessment: IntegrityAssessment =
    structured.status === "mismatch" || worst === "critical"
      ? "blocked"
      : worst === "high" || worst === "medium"
        ? "review"
        : semantic.status === "unsupported"
          ? "unverified"
          : "passed";

  return {
    status: structured.status === "mismatch" || material ? "mismatch" : "verified",
    issues: structured.issues,
    semantic,
    assessment,
  };
}
