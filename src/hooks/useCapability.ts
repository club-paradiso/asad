"use client";

/**
 * Read a static browser capability without a hydration-mismatch or a
 * cascading render.
 *
 * Capabilities (does this browser have wake lock? speech recognition?) are
 * constant for the lifetime of the page but unknowable on the server, so they
 * are read through `useSyncExternalStore` with a never-changing subscription:
 * the server snapshot is the optimistic default, and hydration corrects it in
 * the same pass rather than in a follow-up effect.
 */
import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

export function useCapability(detect: () => boolean, serverValue = false): boolean {
  return useSyncExternalStore(noSubscribe, detect, () => serverValue);
}
