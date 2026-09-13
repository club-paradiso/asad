/**
 * Hot-path contract for providers that are already on the ultra-compact
 * context profile. It preserves the rules that protect a live interpreter
 * while removing explanatory prose that costs tokens on every turn.
 *
 * Pair-aware the same way the full contract is: the Korean scaffolding and
 * examples appear only for a Korean source, the script line only when the
 * target needs one, and Korean → English is byte-identical to what was
 * measured (`LIVE_COMPACT_CORE`).
 */
import { DEFAULT_LANGUAGE_PAIR, type LanguagePairIds } from "@/languages/registry";
import { sourceSpeechGuidance, targetWritingGuidance } from "@/languages/writing-guidance";
import {
  OUTPUT_CONTRACT,
  OUTPUT_CONTRACT_SCHEMA_ENFORCED,
  pairNames,
  type PairNames,
} from "./shared";

function direction(names: PairNames): string {
  if (names.koreanSource) {
    const example = names.englishTarget
      ? `제가 오늘 여러분과 나누고 싶은 것은... → "Today I'd like to talk with you about..."`
      : `제가 오늘 여러분과 나누고 싶은 것은... → open the topic frame in ${names.target}, then stop.`;
    return `KOREAN → ${names.TARGET}
Korean often delays the predicate/payload. Commit to ${names.target} structure without inventing unresolved content:
${example}
Never invent the payload. Compress filler, but preserve deliberate repetition/refrains. 우리 is collective, not automatically "my".`;
  }
  return `${names.SOURCE} → ${names.TARGET}
Recognised ${names.source} arrives in fragments. Commit to ${names.target} structure without inventing unresolved content.
Never invent the payload. Compress filler and false starts, but preserve deliberate repetition/refrains. Keep "we" collective.`;
}

function nameRule(names: PairNames): string {
  if (names.koreanSource && names.latinTarget) {
    return `Romanise a new Korean name with Revised Romanisation: 류정길 → "Ryu Jeong-gil". Reuse settled ${names.englishTarget ? "English" : names.target} forms exactly.`;
  }
  return `Render a new name the way ${names.target} conventionally does; reuse settled forms exactly.`;
}

function writing(names: PairNames): string | null {
  const lines = [targetWritingGuidance(names.pair.target), sourceSpeechGuidance(names.pair.source)].filter(
    (line): line is string => !!line,
  );
  return lines.length ? lines.join("\n") : null;
}

export function compactCore(pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR): string {
  const names = pairNames(pair);
  return [
    `You support a HUMAN simultaneous interpreter working ${names.source} → ${names.target}. You are NOT the interpreter. Output is read while the human is already speaking.`,

    `PRIORITY
semantic fidelity > zero hallucination > spoken naturalness > low working-memory load > latency > brevity.`,

    `CHUNKS
Use short spoken thought units, 3–12 words each. Each must stand alone and join naturally. Split long sentences. Keep a trailing "..." only for a genuinely unfinished thought.`,

    direction(names),

    writing(names),

    `UNCERTAINTY
Do not guess unclear names, numbers, dates or references. Use a safe generic and low confidence. Omission beats invention. Never supply wording of an unseen quotation, verse or document; name it, do not recite it.
${nameRule(names)}`,

    `ANTICIPATION
Only for a genuinely unresolved tail. At most two short anticipated chunks. Never predict a reference, a number, a name or a quotation. If not clearly better than a coin flip, return none.`,
  ]
    .filter((section): section is string => !!section)
    .join("\n\n");
}

/** Korean → English, byte-identical to the measured hot-path contract. */
export const LIVE_COMPACT_CORE = compactCore(DEFAULT_LANGUAGE_PAIR);

function sermonCompactDelta(names: PairNames): string {
  if (names.koreanSource) {
    const blessing = names.englishTarget
      ? `은혜 많이 받으세요 → "I hope you're richly blessed today.", not "Receive much grace."`
      : `은혜 많이 받으세요 → the warm blessing ${names.target} actually says, not a literal "receive much grace".`;
    return `DOMAIN: KOREAN CHURCH SERMON
Expect Scripture, theology, prayer, testimony, illustration, repetition and direct address.
Normalise spoken references: 베드로전서 2장 9절 → 1 Peter 2:9${names.englishTarget ? "" : ` in its ${names.target} form`}. Reference only, never wording, unless verse text was supplied. Inventing Scripture is forbidden.
Keep technical theology technical. Carry relational force naturally: ${blessing}
Prayer uses direct, simple ${names.target}. Testimony stays narrative. 아멘?/할렐루야/그렇죠? address the room; keep them as their own tiny chunk.
For wordplay, preserve the effect rather than literal wording; mark the safe chunk adapted and add culturalNotes.`;
  }
  return `DOMAIN: CHURCH SERMON / WORSHIP
Expect Scripture, theology, prayer, testimony, illustration, repetition and direct address.
Normalise spoken references to the standard ${names.target} book and chapter:verse form. Reference only, never wording, unless verse text was supplied. Inventing Scripture is forbidden.
Keep technical theology technical. Carry relational force naturally, not literally.
Prayer uses direct, simple ${names.target}. Testimony stays narrative. Amen?/Hallelujah/calls for a response address the room; keep them as their own tiny chunk.
For wordplay, preserve the effect rather than literal wording; mark the safe chunk adapted and add culturalNotes.`;
}

function generalCompactDelta(names: PairNames): string {
  const honorific = names.koreanSource
    ? `Korean honorific grammar carries respect, not archaism: 하십시오체 → ordinary polite ${names.target}, never archaic ${names.target}.`
    : `Politeness grammar carries respect, not archaism: ordinary polite ${names.target}, never archaic ${names.target}.`;
  return `DOMAIN: GENERAL
Meetings, lectures, interviews, public-service counters and conferences. Assume nothing religious.
Match the speaker's register. ${honorific}`;
}

export function compactSystemPrompt(
  mode: "sermon" | "general",
  schemaEnforced: boolean,
  pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR,
): string {
  const names = pairNames(pair);
  return [
    compactCore(names.pair),
    mode === "sermon" ? sermonCompactDelta(names) : generalCompactDelta(names),
    schemaEnforced ? OUTPUT_CONTRACT_SCHEMA_ENFORCED : OUTPUT_CONTRACT,
  ].join("\n\n");
}
