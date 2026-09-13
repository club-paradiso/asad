/**
 * Hot-path contract for providers that are already on the ultra-compact
 * context profile. It preserves the rules that protect a live interpreter
 * while removing explanatory prose that costs tokens on every turn.
 */
import type { ResolvedContext } from "@/types";
import { findLanguage, languageName } from "@/lib/languages";
import { contextDelta } from "./domains";
import {
  DEFAULT_PROMPT_LANGUAGES,
  OUTPUT_CONTRACT,
  OUTPUT_CONTRACT_SCHEMA_ENFORCED,
  type PromptLanguages,
} from "./shared";

function structureLine(languages: PromptLanguages): string {
  const source = languageName(languages.source);
  const target = languageName(languages.target);
  if (findLanguage(languages.source)?.base === "ko") {
    return `KOREAN → ${target.toUpperCase()}
Korean often delays the predicate/payload. Commit to ${target} structure without inventing unresolved content:
제가 오늘 여러분과 나누고 싶은 것은... → "Today I'd like to talk with you about..."
Never invent the payload. Compress filler, but preserve deliberate repetition/refrains. 우리 is collective, not automatically "my".`;
  }
  return `${source.toUpperCase()} → ${target.toUpperCase()}
${source} may resolve a clause later than ${target} can wait. Commit to ${target} structure without inventing unresolved content.
Never invent the payload. Compress filler, but preserve deliberate repetition/refrains. Render collective first-person as collective.`;
}

function nameLine(languages: PromptLanguages): string {
  if (findLanguage(languages.source)?.base === "ko") {
    return `Romanise a new Korean name with Revised Romanisation: 류정길 → "Ryu Jeong-gil". Reuse settled English forms exactly.`;
  }
  return `Transliterate a new name using the standard form for its own language, never a local equivalent. Reuse settled forms exactly.`;
}

export function compactCore(
  languages: PromptLanguages = DEFAULT_PROMPT_LANGUAGES,
): string {
  const source = languageName(languages.source);
  const target = languageName(languages.target);
  return `You support a HUMAN simultaneous interpreter working ${source} → ${target}. You are NOT the interpreter. Output is read while the human is already speaking.

PRIORITY
semantic fidelity > zero hallucination > spoken naturalness > low working-memory load > latency > brevity.

CHUNKS
Use short spoken thought units, 3–12 words each. Each must stand alone and join naturally. Split long sentences. Keep a trailing "..." only for a genuinely unfinished thought.

${structureLine(languages)}

UNCERTAINTY
Do not guess unclear names, numbers, dates or references. Use a safe generic and low confidence. Omission beats invention. Never supply wording of an unseen quotation, verse or document; name it, do not recite it.
${nameLine(languages)}

ANTICIPATION
Only for a genuinely unresolved tail. At most two short anticipated chunks. Never predict a reference, a number, a name or a quotation. If not clearly better than a coin flip, return none.`;
}

/** The Korean → English hot-path core, kept as a named export for the harness. */
export const LIVE_COMPACT_CORE = compactCore(DEFAULT_PROMPT_LANGUAGES);

export function compactSystemPrompt(
  context: ResolvedContext,
  schemaEnforced: boolean,
  languages: PromptLanguages = DEFAULT_PROMPT_LANGUAGES,
): string {
  return [
    compactCore(languages),
    contextDelta(context, languages, { compact: true }),
    schemaEnforced ? OUTPUT_CONTRACT_SCHEMA_ENFORCED : OUTPUT_CONTRACT,
  ].join("\n\n");
}
