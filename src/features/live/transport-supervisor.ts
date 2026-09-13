/**
 * The transport supervisor.
 *
 * Owns one question and nothing else: is the recogniser open, and if it just
 * stopped being open, whose problem is that?
 *
 *   transport    a socket, a token, the venue's Wi-Fi. Reopen automatically,
 *                with backoff, and keep everything on screen.
 *   permission   only a person can grant a microphone. Stop, say so, wait.
 *   device       only a person can plug an interface back in. Same.
 *   unsupported  this deployment or browser cannot do what was asked. Same.
 *
 * IN NO CASE IS THE SESSION DESTROYED. That is the change this module exists
 * to make: the console used to have exactly one failure path, it ran on any
 * recogniser error, and the only recovery it offered rebuilt the interpretation
 * engine from scratch — so a Wi-Fi dip in the fourth minute of a service cost
 * the transcript, the settled names, the glossary and the Scripture list.
 *
 * Deliberately outside React, for the same reason the interpretation engine is:
 * it is a small state machine with timers, it must keep working while the UI is
 * busy, and the rules are worth testing without rendering anything.
 */

/** Why a live session stopped listening. */
export type SessionFailureKind =
  /** The browser or the OS refused the microphone. */
  | "permission"
  /** The chosen input vanished or cannot be opened. */
  | "device"
  /** This deployment or browser cannot do what was asked. */
  | "unsupported"
  /** A socket, a token or the network. Retryable, and usually transient. */
  | "transport";

export interface SessionFault {
  kind: SessionFailureKind;
  message: string;
  /** True while automatic recovery is still being attempted. */
  recovering: boolean;
  /** How many automatic attempts have been made so far. */
  attempts: number;
}

export type TransportPhase =
  | "idle"
  | "opening"
  | "open"
  /** Reopening automatically. Session state is intact. */
  | "recovering"
  /** Stopped for a reason only a human can clear. Session state is intact. */
  | "interrupted"
  /** The very first open failed, so there is no session state to preserve. */
  | "failed-to-start"
  | "closed";

export interface TransportState {
  phase: TransportPhase;
  fault: SessionFault | null;
}

/**
 * How long to wait before each automatic attempt, and therefore how many
 * attempts there are. Roughly fifteen seconds in total, front-loaded: most
 * transient drops come back inside the first two.
 */
export const RECOVERY_BACKOFF_MS = [600, 1800, 4000, 8000] as const;

export interface TransportSupervisorDeps {
  /** Open the recogniser and microphone. False means "cancelled, do nothing". */
  open: () => Promise<boolean>;
  /** Close them. Must be safe to call at any time, including twice. */
  close: () => Promise<void>;
  /** Classify anything thrown by `open`. */
  classify: (error: unknown) => { kind: SessionFailureKind; message: string };
  onState: (state: TransportState) => void;
  /** Injectable so the backoff can be driven directly in tests. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class TransportSupervisor {
  private phase: TransportPhase = "idle";
  private fault: SessionFault | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly setTimer: NonNullable<TransportSupervisorDeps["setTimer"]>;
  private readonly clearTimer: NonNullable<TransportSupervisorDeps["clearTimer"]>;

  constructor(private readonly deps: TransportSupervisorDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  state(): TransportState {
    return { phase: this.phase, fault: this.fault };
  }

  /** First open of a brand-new session. */
  async start(): Promise<boolean> {
    return this.attemptOpen({ firstOpen: true });
  }

  /**
   * Pick the session back up after an interruption a person has now cleared.
   * The caller keeps its engine, so the transcript survives.
   */
  async resume(): Promise<boolean> {
    if (this.disposed || this.phase === "open" || this.phase === "opening") return false;
    this.attempts = 0;
    return this.attemptOpen({ firstOpen: false });
  }

  /**
   * Report a fault observed while the transport was open — a recogniser's own
   * terminal error, or a microphone track ending.
   */
  report(kind: SessionFailureKind, message: string): void {
    if (this.disposed || this.phase === "recovering") return;
    void this.handle({ kind, message }, { firstOpen: false });
  }

  /** Ending is explicit and final: no scheduled reconnection outlives it. */
  async close(): Promise<void> {
    this.cancelTimer();
    this.attempts = 0;
    this.fault = null;
    this.phase = "closed";
    this.disposed = true;
    await this.deps.close();
  }

  /** Tear down without emitting further state — used on unmount. */
  dispose(): void {
    this.cancelTimer();
    this.disposed = true;
  }

  private emit(): void {
    if (!this.disposed) this.deps.onState(this.state());
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private async attemptOpen(options: { firstOpen: boolean }): Promise<boolean> {
    if (this.disposed) return false;
    this.cancelTimer();
    this.phase = options.firstOpen || this.attempts === 0 ? "opening" : "recovering";
    if (options.firstOpen || this.attempts === 0) this.fault = null;
    this.emit();

    try {
      const opened = await this.deps.open();
      if (this.disposed) return false;
      if (!opened) return false;
      this.attempts = 0;
      this.fault = null;
      this.phase = "open";
      this.emit();
      return true;
    } catch (error) {
      if (this.disposed) return false;
      await this.handle(this.deps.classify(error), options);
      return false;
    }
  }

  /**
   * Decide what a fault means, then do exactly that.
   *
   * The first open is the one case where giving up cleanly is right: nothing
   * was ever heard, so there is no session state worth preserving and the
   * launcher's Start is the correct affordance, not Resume.
   */
  private async handle(
    failure: { kind: SessionFailureKind; message: string },
    options: { firstOpen: boolean },
  ): Promise<void> {
    const retryable =
      failure.kind === "transport" &&
      !options.firstOpen &&
      this.attempts < RECOVERY_BACKOFF_MS.length;

    if (retryable) {
      this.fault = {
        kind: failure.kind,
        message: failure.message,
        recovering: true,
        attempts: this.attempts,
      };
      this.phase = "recovering";
      this.emit();
      await this.deps.close();
      if (this.disposed) return;
      const delay = RECOVERY_BACKOFF_MS[Math.min(this.attempts, RECOVERY_BACKOFF_MS.length - 1)];
      this.attempts += 1;
      this.timer = this.setTimer(() => {
        this.timer = null;
        void this.attemptOpen({ firstOpen: false });
      }, delay);
      return;
    }

    await this.deps.close();
    if (this.disposed) return;
    this.fault = {
      kind: failure.kind,
      message: failure.message,
      recovering: false,
      attempts: this.attempts,
    };
    this.phase = options.firstOpen ? "failed-to-start" : "interrupted";
    this.emit();
  }
}
