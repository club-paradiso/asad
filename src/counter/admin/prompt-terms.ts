/**
 * Terminology for ONE translation turn, retrieved deterministically.
 *
 * The whole registry is never sent. Only concepts the current utterance or the
 * recent turns actually mention are included (at most eight), so a turn like
 * "one moment please" costs nothing extra and a turn about an extension
 * carries exactly the terms it needs.
 */
import { findConcept, registryLanguage } from "./registry";
import { matchConcepts } from "./matcher";
import type { TermMatch } from "./types";

export interface PromptTermsInput {
  text: string;
  sourceLang: string;
  targetLang: string;
  recent?: ReadonlyArray<{ text: string; lang?: string }>;
}

const MAX_CONCEPTS = 8;
const MAX_RESTRICTIONS = 3;

export function promptTerminology(input: PromptTermsInput): string[] {
  const current = matchConcepts(input.text, input.sourceLang);
  const history = (input.recent ?? []).flatMap((turn) =>
    matchConcepts(turn.text, turn.lang ?? input.sourceLang),
  );

  const ordered: string[] = [];
  for (const match of [...current, ...history]) {
    if (!ordered.includes(match.conceptId)) ordered.push(match.conceptId);
  }
  const ids = ordered.slice(0, MAX_CONCEPTS);
  if (!ids.length) return [];

  const target = registryLanguage(input.targetLang);
  const lines: string[] = [];

  lines.push(
    `ADMINISTRATIVE TERMS IN USE (one name per concept for the whole conversation; Korean = English${
      target && target !== "ko" && target !== "en" ? " = target-language rendering" : ""
    }):\n${ids
      .map((id) => {
        const concept = findConcept(id)!;
        const en = concept.terms.en!;
        const rendering = target && target !== "ko" && target !== "en" ? concept.terms[target] : undefined;
        const tail = rendering
          ? ` = ${rendering.term}${rendering.status === "provisional" ? " (provisional, not an official term: use only if natural)" : ""}`
          : "";
        return `  ${concept.terms.ko?.term ?? concept.ko} = ${en.term}${tail}`;
      })
      .join("\n")}`,
  );

  const nonstandard = current.filter(
    (match): match is TermMatch & { kind: "colloquial" | "asr-error" | "mt-error" } =>
      match.kind === "colloquial" || match.kind === "asr-error" || match.kind === "mt-error",
  );
  if (nonstandard.length) {
    lines.push(
      `NON-STANDARD WORDING IN THIS UTTERANCE: ${nonstandard
        .map((match) => `"${match.text}" (may refer to ${findConcept(match.conceptId)!.ko} / ${findConcept(match.conceptId)!.terms.en!.term})`)
        .join("; ")}. Translate what the speaker actually said. Do NOT replace their words with an official procedure name and do NOT decide which procedure they mean; if it is unclear, keep the ambiguity and lower confidence.`,
    );
  }

  const restrictions = ids
    .flatMap((id) => findConcept(id)!.restrictions ?? [])
    .slice(0, MAX_RESTRICTIONS);
  if (restrictions.length) {
    lines.push(`TERM CAUTIONS (Korean, for you only — never add these to the translation):\n${restrictions.map((r) => `  - ${r}`).join("\n")}`);
  }

  return lines;
}
