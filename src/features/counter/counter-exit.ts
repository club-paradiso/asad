"use client";

/**
 * Leaving the browser when a counter conversation ends.
 *
 * A finished consultation must not stay on screen. The visitor's phone is
 * handed back, put in a pocket, or passed to the next person in the queue, and
 * the desk device has to be ready for whoever is standing there now. Either
 * side hanging up therefore takes both browsers off the dead conversation.
 *
 * What "leaving" can actually mean is decided by the browser, not by us. A
 * script may only close a tab that a script opened, so a QR/deep-link tab —
 * which is how a visitor always arrives — cannot be closed at all. Attempting
 * it there produces a console warning and nothing else. So closing is tried
 * only where it is permitted, and every surface also has a navigation
 * fallback that is guaranteed to work.
 *
 * The short delay exists so the terminal state paints once. Vanishing without
 * a frame of "this ended" looks like a crash, and a visitor who thinks the app
 * crashed asks the staff member about it, which is the opposite of finished.
 */

/** Long enough for the ended state to paint, short enough to feel automatic. */
export const COUNTER_EXIT_DELAY_MS = 300;

/** How long a permitted window.close() gets before the fallback runs. */
export const COUNTER_CLOSE_GRACE_MS = 150;

/** The parts of `window` this needs, so a test can hand over a fake. */
export interface ExitWindow {
  readonly closed: boolean;
  readonly opener: unknown;
  close(): void;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
}

export interface CounterExitOptions {
  /**
   * Take this browser off the conversation without closing it. Runs when the
   * page cannot be closed, which is the normal case. Must always be supplied:
   * it is the only branch that is guaranteed to happen.
   */
  leave: () => void;
  /**
   * Try `window.close()` first. Only worth setting on a surface that may have
   * been opened by a script; it is skipped when there is no opener.
   */
  tryClose?: boolean;
  delayMs?: number;
  /** Defaults to the real window. Injected in tests. */
  target?: ExitWindow | null;
}

/**
 * Schedule the exit and return a canceller, so a React effect can drop it if
 * the surface unmounts (or the session comes back) before it fires.
 */
export function scheduleCounterExit({
  leave,
  tryClose = false,
  delayMs = COUNTER_EXIT_DELAY_MS,
  target,
}: CounterExitOptions): () => void {
  const view = target ?? (typeof window === "undefined" ? null : (window as ExitWindow));
  if (!view) return () => {};

  const timers: number[] = [];

  const fallback = () => {
    // A refused close leaves the page open; a permitted one already left.
    if (!view.closed) leave();
  };

  timers.push(
    view.setTimeout(() => {
      if (tryClose && view.opener) {
        try {
          view.close();
        } catch {
          // Refusal is expected on some browsers; the fallback still leaves.
        }
        timers.push(view.setTimeout(fallback, COUNTER_CLOSE_GRACE_MS));
        return;
      }
      fallback();
    }, delayMs),
  );

  return () => {
    for (const timer of timers) view.clearTimeout(timer);
  };
}
