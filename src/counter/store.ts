/**
 * Counter session store.
 *
 * In-memory, behind a small interface so it can be swapped for a shared store
 * without touching the routes.
 *
 * KNOWN LIMITATION, stated here rather than discovered in front of a visitor:
 * this does not survive a process restart and does not work across multiple
 * instances — including serverless deployments where each request may reach a
 * different worker. It is correct for a single long-running Node process, which
 * is how a venue would actually run this. `/diagnostics` reports the
 * limitation. See docs/counter-mode.md.
 */
import { generateCode } from "./codes";
import type { CounterMessage, CounterSession, Participant } from "./types";

/** A counter session is not a document. Idle sessions are discarded. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
/** Bound per-session memory; a counter conversation is not a transcript. */
export const MAX_MESSAGES = 500;

export interface CounterStore {
  create(input: { hostLang: string; deskLabel?: string }): CounterSession;
  get(code: string): CounterSession | undefined;
  update(code: string, mutate: (session: CounterSession) => void): CounterSession | undefined;
  end(code: string): boolean;
  /** Diagnostics only — counts, never content. */
  stats(): { active: number; waiting: number; totalMessages: number };
}

class MemoryCounterStore implements CounterStore {
  private readonly sessions = new Map<string, CounterSession>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Drop anything past its TTL. Called on every access; there is no timer to
   *  leak, and the map is small. */
  private sweep(): void {
    const cutoff = this.now() - SESSION_TTL_MS;
    for (const [code, session] of this.sessions) {
      if (session.lastActivityAt < cutoff) this.sessions.delete(code);
    }
  }

  create(input: { hostLang: string; deskLabel?: string }): CounterSession {
    this.sweep();
    let code = generateCode();
    // Retry on collision rather than lengthening the code — a longer code is
    // harder to read aloud, which is the thing that actually matters.
    for (let attempt = 0; attempt < 8 && this.sessions.has(code); attempt += 1) {
      code = generateCode();
    }

    const at = this.now();
    const session: CounterSession = {
      code,
      createdAt: at,
      lastActivityAt: at,
      state: "waiting",
      hostLang: input.hostLang,
      guestLang: null,
      deskLabel: input.deskLabel,
      messages: [],
      nextSeq: 1,
    };
    this.sessions.set(code, session);
    return session;
  }

  get(code: string): CounterSession | undefined {
    this.sweep();
    return this.sessions.get(code);
  }

  update(code: string, mutate: (session: CounterSession) => void): CounterSession | undefined {
    const session = this.get(code);
    if (!session) return undefined;
    mutate(session);
    session.lastActivityAt = this.now();
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES);
    }
    return session;
  }

  end(code: string): boolean {
    // Delete outright rather than marking ended: nothing about a counter
    // conversation should outlive it on the server.
    return this.sessions.delete(code);
  }

  stats() {
    this.sweep();
    let active = 0;
    let waiting = 0;
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      if (session.state === "active") active += 1;
      if (session.state === "waiting") waiting += 1;
      totalMessages += session.messages.length;
    }
    return { active, waiting, totalMessages };
  }
}

/** Append a message and assign its sequence number. */
export function appendMessage(
  session: CounterSession,
  message: Omit<CounterMessage, "seq">,
): CounterMessage {
  const seq = session.nextSeq;
  session.nextSeq += 1;
  const stored: CounterMessage = { ...message, seq };
  session.messages.push(stored);
  return stored;
}

/** Replace a message in place, e.g. when a pending translation completes. */
export function replaceMessage(session: CounterSession, message: CounterMessage): void {
  const at = session.messages.findIndex((m) => m.id === message.id);
  if (at !== -1) session.messages[at] = message;
}

/** The language a message from `from` should be translated INTO. */
export const targetLangFor = (session: CounterSession, from: Participant): string =>
  from === "host" ? (session.guestLang ?? "en-US") : session.hostLang;

export const sourceLangFor = (session: CounterSession, from: Participant): string =>
  from === "host" ? session.hostLang : (session.guestLang ?? "en-US");

/** Process-wide store. */
let store: CounterStore | null = null;
export const counterStore = (): CounterStore => (store ??= new MemoryCounterStore());

/** Test seam. */
export const __setCounterStore = (next: CounterStore | null) => {
  store = next;
};
export const createMemoryStore = (now?: () => number): CounterStore =>
  new MemoryCounterStore(now);
