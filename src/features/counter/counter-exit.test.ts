import { describe, expect, it, vi } from "vitest";
import {
  COUNTER_CLOSE_GRACE_MS,
  COUNTER_EXIT_DELAY_MS,
  type ExitWindow,
  scheduleCounterExit,
} from "./counter-exit";

/** A window whose timers are driven by hand, so the delays are assertable. */
function fakeWindow(overrides: Partial<ExitWindow> = {}) {
  const pending = new Map<number, { run: () => void; delay: number }>();
  let nextId = 1;
  let closed = false;

  const view: ExitWindow = {
    get closed() {
      return closed;
    },
    opener: null,
    close: () => {
      closed = true;
    },
    setTimeout: (handler, delay) => {
      const id = nextId++;
      pending.set(id, { run: handler, delay });
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
    ...overrides,
  };

  return {
    view,
    pending,
    /** Run every timer currently due, in scheduling order. */
    flush() {
      for (const [id, timer] of [...pending]) {
        pending.delete(id);
        timer.run();
      }
    },
    delays: () => [...pending.values()].map((timer) => timer.delay),
  };
}

describe("scheduleCounterExit", () => {
  it("leaves the page after the terminal state has had a moment to paint", () => {
    const leave = vi.fn();
    const clock = fakeWindow();

    scheduleCounterExit({ leave, target: clock.view });

    expect(leave).not.toHaveBeenCalled();
    expect(clock.delays()).toEqual([COUNTER_EXIT_DELAY_MS]);

    clock.flush();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a close the browser is certain to refuse", () => {
    const leave = vi.fn();
    const close = vi.fn();
    const clock = fakeWindow({ close, opener: null });

    scheduleCounterExit({ leave, tryClose: true, target: clock.view });
    clock.flush();

    // A QR/deep-link tab has no opener, so the navigation is the only exit.
    expect(close).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("closes a script-opened tab and does not then navigate it", () => {
    const leave = vi.fn();
    const clock = fakeWindow({ opener: {} });

    scheduleCounterExit({ leave, tryClose: true, target: clock.view });
    clock.flush();

    expect(clock.view.closed).toBe(true);
    expect(clock.delays()).toEqual([COUNTER_CLOSE_GRACE_MS]);

    clock.flush();
    expect(leave).not.toHaveBeenCalled();
  });

  it("still leaves when a permitted close is refused anyway", () => {
    const leave = vi.fn();
    const clock = fakeWindow({
      opener: {},
      close: () => {
        throw new Error("refused");
      },
    });

    scheduleCounterExit({ leave, tryClose: true, target: clock.view });
    clock.flush();
    clock.flush();

    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled before it fires", () => {
    const leave = vi.fn();
    const clock = fakeWindow();

    scheduleCounterExit({ leave, target: clock.view })();
    clock.flush();

    expect(leave).not.toHaveBeenCalled();
  });
});
