"use client";

/**
 * Read a static browser capability without a hydration-mismatch or a
 * cascading render.
 *
 * Capabilities (does this browser have wake lock? speech recognition?) are
 * constant for the lifetime of the page but unknowable on the server, so they
 * are read through `useClientValue`: the server snapshot is the optimistic
 * default, and hydration corrects it in the same pass rather than in a
 * follow-up effect.
 */
import { useClientValue } from "./useClientValue";

export function useCapability(detect: () => boolean, serverValue = false): boolean {
  return useClientValue(detect, serverValue);
}
