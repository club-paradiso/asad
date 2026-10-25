import type { CounterMessage } from "@/counter/types";

/**
 * A message as the browser holds it.
 *
 * Server messages arrive complete. A message this device has sent but the
 * server has not yet answered for is held locally with `local` set, so the
 * sender sees their own words on screen the moment they press Send — marked
 * as still translating — rather than nothing for the several seconds a model
 * takes. When the server answers, the local copy is replaced by the stored
 * one (matched on the idempotency key); when every retry fails, it stays on
 * screen as failed with its text intact, so nothing typed is ever lost.
 */
export interface LocalMessageState {
  requestId: string;
  /** What to send again if the user asks. */
  input: {
    text: string;
    source: "voice" | "text" | "quick-phrase" | "confirm";
    rephraseOf?: string;
    action?: "simplify" | "retry";
    actionOf?: string;
  };
}

export type ClientCounterMessage = CounterMessage & { local?: LocalMessageState };

/** Locally held messages sort after every server-numbered one. */
export const LOCAL_SEQ_BASE = 1_000_000_000;

export const localMessageId = (requestId: string): string => `local:${requestId}`;
