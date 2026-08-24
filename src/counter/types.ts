/**
 * Counter Mode domain types.
 *
 * A counter session is two people at a desk who do not share a language. It is
 * deliberately a different model from the live interpretation session: discrete
 * turn-taking messages rather than a continuous stabilised stream, and no
 * temporal locking, because nothing here is "already being said out loud".
 */

export type Participant = "host" | "guest";

/** Delivery state of one utterance. */
export type MessageStatus = "pending" | "done" | "failed";

/** How the text was produced. Quick phrases never touch a model. */
export type MessageSource = "voice" | "text" | "quick-phrase" | "confirm";

/**
 * A span in the translated text worth reading back aloud.
 *
 * Numbers, times and names are the items that actually go wrong at a counter —
 * "3시" heard as "13시" costs someone their appointment — so they are marked
 * for confirmation rather than trusted.
 */
export interface RiskSpan {
  text: string;
  kind: "number" | "time" | "date" | "money" | "name";
}

export interface CounterMessage {
  id: string;
  /** Monotonic within a session; the polling cursor. */
  seq: number;
  from: Participant;
  source: MessageSource;
  originalText: string;
  originalLang: string;
  translatedText: string;
  targetLang: string;
  at: number;
  status: MessageStatus;
  confidence?: "high" | "medium" | "low";
  /** Short note from the model, e.g. an ambiguity worth resolving. */
  note?: string;
  /** Spans the sender should read back to confirm. */
  risks?: RiskSpan[];
  /** Set when this message is a rephrasing of an earlier one. */
  rephraseOf?: string;
  /** Present when translation failed, so the UI can say why. */
  error?: string;
}

export type SessionState = "waiting" | "active" | "ended";

export interface CounterSession {
  /** Short human-readable code, e.g. "TY-4821". */
  code: string;
  createdAt: number;
  lastActivityAt: number;
  state: SessionState;
  /** The staff member's working language. */
  hostLang: string;
  /** Chosen by the visitor when they join; null until then. */
  guestLang: string | null;
  guestJoinedAt?: number;
  messages: CounterMessage[];
  nextSeq: number;
  /** Optional label shown to the visitor, e.g. "접수 창구 2". */
  deskLabel?: string;
}

/** What a client is allowed to see. Never exposes internals. */
export interface SessionView {
  code: string;
  state: SessionState;
  hostLang: string;
  guestLang: string | null;
  deskLabel?: string;
  messages: CounterMessage[];
  /** Cursor to pass on the next poll. */
  seq: number;
  guestPresent: boolean;
}

export const toView = (session: CounterSession, since = 0): SessionView => ({
  code: session.code,
  state: session.state,
  hostLang: session.hostLang,
  guestLang: session.guestLang,
  deskLabel: session.deskLabel,
  messages: session.messages.filter((m) => m.seq > since),
  seq: session.nextSeq - 1,
  guestPresent: session.guestJoinedAt !== undefined,
});
