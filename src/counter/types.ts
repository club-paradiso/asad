/**
 * Counter Mode domain types.
 *
 * A counter session is two people at a desk who do not share a language. It is
 * deliberately a different model from the live interpretation session: discrete
 * turn-taking messages rather than a continuous stabilised stream, and no
 * temporal locking, because nothing here is "already being said out loud".
 */
import type { HumanReviewFlag } from "@/learning/types";

export type Participant = "host" | "guest";

/** Delivery state of one utterance. */
export type MessageStatus = "pending" | "done" | "failed";

/** How the text was produced. Quick phrases never touch a model. */
export type MessageSource = "voice" | "text" | "quick-phrase" | "confirm";

export type CounterMessageAction = "simplify" | "retry";

export type CriticalValueKind =
  | "integer"
  | "decimal"
  | "money"
  | "date"
  | "time"
  | "phone"
  | "identifier"
  | "name";

export interface CriticalValue {
  kind: CriticalValueKind;
  text: string;
  /** Deterministic comparison key; never shown directly to users. */
  normalized: string;
}

export interface IntegrityIssue {
  kind: CriticalValueKind;
  sourceText: string;
  targetText?: string;
  reason: "missing" | "changed" | "added";
}

export interface TranslationIntegrity {
  status: "verified" | "mismatch";
  issues: IntegrityIssue[];
}

/**
 * A span in the translated text worth reading back aloud.
 *
 * Numbers, times and names are the items that actually go wrong at a counter —
 * "3시" heard as "13시" costs someone their appointment — so they are marked
 * for confirmation rather than trusted.
 */
export interface RiskSpan {
  text: string;
  kind: "number" | "time" | "date" | "money" | "name" | "phone" | "identifier";
}

export interface CounterMessage {
  id: string;
  /** Monotonic within a session; the polling cursor. */
  seq: number;
  from: Participant;
  source: MessageSource;
  /**
   * Client-generated idempotency key. It lets a dropped POST be retried without
   * displaying the same utterance twice. It is random and carries no user data.
   */
  clientRequestId?: string;
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
  /** Explicit translation action replacing the old generic rephrase affordance. */
  action?: CounterMessageAction;
  actionOf?: string;
  /** Values extracted from the source for deterministic read-back. */
  criticalValues?: CriticalValue[];
  /** Semantic comparison between source and translated critical values. */
  integrity?: TranslationIntegrity;
  /** Session-scoped cues requiring a human to inspect this turn. Never a person-level risk label. */
  reviewFlags?: HumanReviewFlag[];
  /** Present when translation failed, so the UI can say why. */
  error?: string;
}

export type SessionState = "waiting" | "active" | "ended";

export interface CounterSession {
  /** Short human-readable code, e.g. "TY-4821". */
  code: string;
  /** Hashed participant capabilities. Never returned by `toView`. */
  hostTokenHash: string;
  guestTokenHash?: string;
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
  /** Lightweight translation vocabulary context, never a legal/medical decision mode. */
  profileId: import("./profiles").CounterProfileId;
}

/** What a client is allowed to see. Never exposes internals. */
export interface SessionView {
  code: string;
  state: SessionState;
  hostLang: string;
  guestLang: string | null;
  deskLabel?: string;
  profileId: import("./profiles").CounterProfileId;
  messages: CounterMessage[];
  /** Cursor to pass on the next poll. */
  seq: number;
  guestPresent: boolean;
}

export const toView = (
  session: CounterSession,
  since = 0,
  viewer: Participant = "host",
): SessionView => ({
  code: session.code,
  state: session.state,
  hostLang: session.hostLang,
  guestLang: session.guestLang,
  deskLabel: session.deskLabel,
  profileId: session.profileId ?? "general",
  messages: session.messages
    .filter((m) => m.seq > since)
    .map((message) => toParticipantMessage(message, viewer)),
  seq: session.nextSeq - 1,
  guestPresent: session.guestJoinedAt !== undefined,
});

/** Human-review metadata is staff-only and must not leak to a visitor device. */
export function toParticipantMessage(
  message: CounterMessage,
  viewer: Participant,
): CounterMessage {
  if (viewer === "host" || message.reviewFlags === undefined) return message;
  const { reviewFlags: _reviewFlags, ...publicMessage } = message;
  return publicMessage;
}
