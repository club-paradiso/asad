/**
 * How often the browser asks the server for the other side's messages.
 *
 * Polling is the transport (see docs/counter-mode.md for why), so the poll
 * interval is a direct term in the time a recipient waits: on average half an
 * interval, at worst a whole one, on top of translation itself. A fixed 1.2 s
 * cadence spent that budget evenly over a conversation that is anything but
 * even — a few seconds of rapid exchange, then a minute of someone reading a
 * form.
 *
 * So the cadence follows the conversation. While it is live, polls are
 * frequent enough that delivery delay is small; once it goes quiet, they thin
 * out so an idle desk is not the busiest client the server has. Hidden tabs
 * stay slow: a backgrounded phone cannot show anything anyway.
 */

export const POLL_HOT_MS = 500;
export const POLL_ACTIVE_MS = 1200;
export const POLL_IDLE_MS = 2500;
export const POLL_HIDDEN_MS = 8000;

/** How long after the last change the conversation counts as live. */
export const HOT_WINDOW_MS = 20_000;
/** How long without a change before the cadence relaxes. */
export const IDLE_AFTER_MS = 120_000;

export interface PollContext {
  hidden: boolean;
  /** Now, in ms. */
  now: number;
  /** When the conversation last changed, or this device last sent. */
  lastChangeAt: number;
  /** Whether this device has a send in flight; a reply is likely soon. */
  sendPending: boolean;
}

export function pollIntervalFor(context: PollContext): number {
  if (context.hidden) return POLL_HIDDEN_MS;
  const quietFor = context.now - context.lastChangeAt;
  if (context.sendPending || quietFor < HOT_WINDOW_MS) return POLL_HOT_MS;
  if (quietFor >= IDLE_AFTER_MS) return POLL_IDLE_MS;
  return POLL_ACTIVE_MS;
}
