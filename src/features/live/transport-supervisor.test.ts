import { describe, expect, it, vi } from "vitest";
import {
  RECOVERY_BACKOFF_MS,
  TransportSupervisor,
  type SessionFailureKind,
  type TransportState,
} from "./transport-supervisor";

class Fault extends Error {
  constructor(readonly kind: SessionFailureKind, message = "boom") {
    super(message);
  }
}

/** A supervisor with a hand-driven clock, so backoff is asserted not awaited. */
function harness(options: { open?: () => Promise<boolean> } = {}) {
  const states: TransportState[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const close = vi.fn(async () => {});
  const open = vi.fn(options.open ?? (async () => true));

  const supervisor = new TransportSupervisor({
    open,
    close,
    classify: (error) =>
      error instanceof Fault
        ? { kind: error.kind, message: error.message }
        : { kind: "transport", message: String(error) },
    onState: (state) => states.push(state),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  });

  return {
    supervisor,
    states,
    timers,
    open,
    close,
    /** Fire the pending backoff timer. */
    async tick() {
      const timer = timers.pop();
      expect(timer, "expected a scheduled recovery").toBeDefined();
      timer!.fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("opening", () => {
  it("reports opening then open", async () => {
    const h = harness();
    await h.supervisor.start();
    expect(h.states.map((s) => s.phase)).toEqual(["opening", "open"]);
    expect(h.supervisor.state().fault).toBeNull();
  });

  it("gives up cleanly when the very first open fails", async () => {
    // Nothing was ever heard, so there is no session state worth preserving
    // and the launcher's Start is the right affordance, not Resume.
    const h = harness({ open: async () => { throw new Fault("transport"); } });
    await h.supervisor.start();
    expect(h.supervisor.state().phase).toBe("failed-to-start");
    expect(h.supervisor.state().fault).toMatchObject({ kind: "transport", recovering: false });
    expect(h.timers).toHaveLength(0);
  });
});

describe("a dropped transport", () => {
  it("reopens automatically with backoff, without ending the session", async () => {
    const h = harness();
    await h.supervisor.start();
    h.open.mockClear();

    h.supervisor.report("transport", "The socket closed.");
    await Promise.resolve();
    await Promise.resolve();

    expect(h.supervisor.state().phase).toBe("recovering");
    expect(h.supervisor.state().fault).toMatchObject({ recovering: true });
    expect(h.timers.at(-1)?.ms).toBe(RECOVERY_BACKOFF_MS[0]);

    await h.tick();
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.supervisor.state().phase).toBe("open");
    expect(h.supervisor.state().fault).toBeNull();
  });

  it("backs off further on each failed attempt, then stops trying", async () => {
    let attempts = 0;
    const h = harness({
      open: async () => {
        attempts += 1;
        if (attempts === 1) return true;
        throw new Fault("transport");
      },
    });
    await h.supervisor.start();

    h.supervisor.report("transport", "gone");
    await Promise.resolve();
    await Promise.resolve();

    const delays: number[] = [];
    for (let i = 0; i < RECOVERY_BACKOFF_MS.length; i += 1) {
      delays.push(h.timers.at(-1)!.ms);
      await h.tick();
    }
    expect(delays).toEqual([...RECOVERY_BACKOFF_MS]);

    // Out of attempts: it stops and hands over to the person, still without
    // destroying anything.
    expect(h.supervisor.state().phase).toBe("interrupted");
    expect(h.supervisor.state().fault).toMatchObject({ recovering: false });
    expect(h.timers).toHaveLength(0);
  });
});

describe("a fault only a person can clear", () => {
  it.each(["permission", "device", "unsupported"] as const)(
    "stops immediately on a %s fault rather than retrying",
    async (kind) => {
      const h = harness();
      await h.supervisor.start();
      h.open.mockClear();

      h.supervisor.report(kind, "needs a human");
      await Promise.resolve();
      await Promise.resolve();

      expect(h.supervisor.state().phase).toBe("interrupted");
      expect(h.supervisor.state().fault).toMatchObject({ kind, recovering: false });
      expect(h.timers).toHaveLength(0);
      expect(h.open).not.toHaveBeenCalled();
    },
  );

  it("reopens on resume once the person has cleared it", async () => {
    const h = harness();
    await h.supervisor.start();
    h.supervisor.report("permission", "denied");
    await Promise.resolve();
    await Promise.resolve();
    h.open.mockClear();

    await h.supervisor.resume();
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.supervisor.state().phase).toBe("open");
    expect(h.supervisor.state().fault).toBeNull();
  });
});

describe("ending", () => {
  it("cancels a scheduled reconnection", async () => {
    const h = harness();
    await h.supervisor.start();
    h.supervisor.report("transport", "gone");
    await Promise.resolve();
    await Promise.resolve();
    expect(h.timers).toHaveLength(1);

    await h.supervisor.close();
    expect(h.supervisor.state().phase).toBe("closed");
    expect(h.close).toHaveBeenCalled();

    // Anything the timer would have done after End must be inert.
    h.open.mockClear();
    h.timers.pop()!.fn();
    await Promise.resolve();
    expect(h.open).not.toHaveBeenCalled();
  });

  it("emits nothing more once disposed", async () => {
    const h = harness();
    await h.supervisor.start();
    const seen = h.states.length;
    h.supervisor.dispose();
    h.supervisor.report("transport", "gone");
    await Promise.resolve();
    expect(h.states).toHaveLength(seen);
  });
});

describe("before anything has ever been heard", () => {
  it("treats a reported fault as a failed start, not an interruption", async () => {
    // A recogniser's `onerror` fires during the first open as readily as in
    // the fortieth minute, and the two need different affordances: Start when
    // nothing was ever heard, Resume when a session is waiting behind it.
    const h = harness({
      open: async () => {
        // Resolves, as a recogniser that reached `onstart` does — but the
        // fault is reported before it ever produced a word.
        return new Promise<boolean>((resolve) => {
          h.supervisor.report("permission", "denied");
          resolve(true);
        });
      },
    });
    await h.supervisor.start();
    expect(h.supervisor.state().phase).toBe("failed-to-start");
  });

  it("treats the same fault as an interruption once a session is open", async () => {
    const h = harness();
    await h.supervisor.start();
    h.supervisor.report("permission", "denied");
    await Promise.resolve();
    await Promise.resolve();
    expect(h.supervisor.state().phase).toBe("interrupted");
  });
});
