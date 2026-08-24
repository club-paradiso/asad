"use client";

/**
 * Read a value that only exists in the browser, without a cascading render.
 *
 * The origin, the navigator's language list, the presence of a Web API — all
 * constant for the life of the page but unknowable on the server. Reading them
 * in an effect means rendering once with a placeholder and again with the
 * truth; `useSyncExternalStore` with a never-changing subscription gets the
 * real value in the hydration pass instead.
 *
 * `read` MUST return a stable primitive or a cached reference: React calls it
 * on every render and compares with `Object.is`, so a fresh object each time
 * is an infinite loop.
 */
import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}
