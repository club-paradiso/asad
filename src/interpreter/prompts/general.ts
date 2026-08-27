/**
 * GENERAL mode — the domain-neutral path.
 *
 * Meetings, lectures, interviews, public-service counters and conferences.
 * Nothing here assumes a religious setting.
 *
 * A small delta on top of `CORE_CONTRACT`, not a second engine. Everything
 * about chunking, delayed predicates, uncertainty and anticipation is shared,
 * and the only thing that genuinely differs between domains is register.
 */
import {
  CORE_CONTRACT,
  OUTPUT_CONTRACT,
  OUTPUT_CONTRACT_SCHEMA_ENFORCED,
} from "./shared";

const GENERAL_DELTA = `DOMAIN: GENERAL
Meetings, lectures, interviews, public-service counters, conferences. Assume nothing religious.

REGISTER
Match the speaker's. A board meeting is not a lecture and neither is an immigration counter. Korean honorific levels rarely survive into English — carry the RESPECT, not the grammar. 하십시오체 becomes ordinary polite English, never archaic English.`;

export const generalSystemPrompt = (schemaEnforced: boolean): string =>
  [
    CORE_CONTRACT,
    GENERAL_DELTA,
    schemaEnforced ? OUTPUT_CONTRACT_SCHEMA_ENFORCED : OUTPUT_CONTRACT,
  ].join("\n\n");

/** Kept for tests and any caller that wants the full contract. */
export const GENERAL_SYSTEM_PROMPT = generalSystemPrompt(false);
