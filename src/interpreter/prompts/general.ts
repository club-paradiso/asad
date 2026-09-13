/**
 * GENERAL layer — the domain-neutral path.
 *
 * Meetings, lectures, interviews, public-service counters and conferences.
 * Nothing here assumes a religious setting.
 *
 * A small delta on top of the core contract, not a second engine. Everything
 * about chunking, delayed predicates, uncertainty and anticipation is shared,
 * and the only thing that genuinely differs between domains is register.
 */
import { DEFAULT_LANGUAGE_PAIR, type LanguagePairIds } from "@/languages/registry";
import {
  coreContract,
  OUTPUT_CONTRACT,
  OUTPUT_CONTRACT_SCHEMA_ENFORCED,
  pairNames,
  type PairNames,
} from "./shared";

/** The Korean → English delta, byte-identical to the measured production prompt. */
const GENERAL_DELTA_KO_EN = `DOMAIN: GENERAL
Meetings, lectures, interviews, public-service counters, conferences. Assume nothing religious.

REGISTER
Match the speaker's. A board meeting is not a lecture and neither is an immigration counter. Korean honorific levels rarely survive into English — carry the RESPECT, not the grammar. 하십시오체 becomes ordinary polite English, never archaic English.`;

const generalDeltaKorean = (names: PairNames): string => `DOMAIN: GENERAL
Meetings, lectures, interviews, public-service counters, conferences. Assume nothing religious.

REGISTER
Match the speaker's. A board meeting is not a lecture and neither is an immigration counter. Korean honorific levels rarely map one-to-one onto ${names.target} — carry the RESPECT, not the grammar. 하십시오체 becomes ordinary polite ${names.target}, never archaic ${names.target}.`;

const generalDeltaGeneric = (names: PairNames): string => `DOMAIN: GENERAL
Meetings, lectures, interviews, public-service counters, conferences. Assume nothing religious.

REGISTER
Match the speaker's. A board meeting is not a lecture and neither is an immigration counter. Politeness and honorific grammar rarely map one-to-one onto ${names.target} — carry the RESPECT, not the grammar, in ordinary polite ${names.target}, never archaic ${names.target}.`;

export function generalDelta(pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR): string {
  const names = pairNames(pair);
  if (names.koreanSource && names.englishTarget) return GENERAL_DELTA_KO_EN;
  if (names.koreanSource) return generalDeltaKorean(names);
  return generalDeltaGeneric(names);
}

export const generalSystemPrompt = (
  schemaEnforced: boolean,
  pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR,
): string =>
  [
    coreContract(pair),
    generalDelta(pair),
    schemaEnforced ? OUTPUT_CONTRACT_SCHEMA_ENFORCED : OUTPUT_CONTRACT,
  ].join("\n\n");

/** Kept for tests and any caller that wants the full Korean → English contract. */
export const GENERAL_SYSTEM_PROMPT = generalSystemPrompt(false);
