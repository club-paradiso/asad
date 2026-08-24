"use client";

/**
 * Screen wake lock.
 *
 * A phone that dims halfway through a sermon is worse than no phone. Where the
 * Wake Lock API exists the lock is held for the whole session and re-acquired
 * after the tab is backgrounded, because browsers release it automatically.
 *
 * The lock is an external system, so it is modelled as one: a module-level
 * manager owns the sentinel and React subscribes to it. That keeps the whole
 * async acquire/release dance out of the render path, and means two components
 * asking for a lock cannot fight over it.
 *
 * iOS Safari's support is recent and uneven, so `supported` is surfaced and
 * the console shows a hint rather than pretending the lock is held.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useCapability } from "./useCapability";

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockApi {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

const getApi = (): WakeLockApi | null => {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock ?? null;
};

const listeners = new Set<() => void>();
let sentinel: WakeLockSentinelLike | null = null;
let held = false;
/** Number of components currently asking for the screen to stay awake. */
let holders = 0;

function publish(next: boolean) {
  if (held === next) return;
  held = next;
  for (const listener of listeners) listener();
}

async function acquire(): Promise<void> {
  const api = getApi();
  if (!api || holders === 0) return;
  if (sentinel && !sentinel.released) return;

  try {
    const lock = await api.request("screen");
    // The caller may have gone away while we were awaiting.
    if (holders === 0) {
      void lock.release().catch(() => {});
      return;
    }
    sentinel = lock;
    publish(true);
    lock.addEventListener("release", () => {
      if (sentinel === lock) sentinel = null;
      publish(false);
    });
  } catch {
    // Denied, or the document is hidden. Not fatal — the session continues.
    publish(false);
  }
}

async function release(): Promise<void> {
  const lock = sentinel;
  sentinel = null;
  if (!lock) {
    publish(false);
    return;
  }
  await lock.release().catch(() => {});
  publish(false);
}

const onVisibilityChange = () => {
  if (document.visibilityState === "visible") void acquire();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useWakeLock(active: boolean) {
  const supported = useCapability(() => getApi() !== null, true);
  const isHeld = useSyncExternalStore(
    subscribe,
    () => held,
    () => false,
  );

  useEffect(() => {
    if (!active) return;

    holders += 1;
    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      holders -= 1;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (holders === 0) void release();
    };
  }, [active]);

  return { held: isHeld, supported };
}
