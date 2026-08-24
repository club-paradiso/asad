/**
 * Interpreter lag profiles.
 *
 * A simultaneous interpreter chooses how far behind the speaker to run. That
 * single choice has to propagate through the whole pipeline, so it lives here
 * as one table rather than as scattered magic numbers.
 */
import type { LagProfile } from "@/types";

export interface LagConfig {
  label: string;
  /** Human-facing description of the target lag. */
  description: string;
  /** Silence after a partial before it is treated as stable, in ms. */
  stabiliseMs: number;
  /** Minimum stabilised characters before the LLM is triggered. */
  minTriggerChars: number;
  /** Hard ceiling on how long pending Korean waits before being sent, in ms. */
  maxHoldMs: number;
  /** How long a `current` chunk stays editable before it locks, in ms. */
  commitDwellMs: number;
  /** Whether predicted continuations are requested at all. */
  anticipation: "aggressive" | "conservative" | "off";
}

export const LAG_PROFILES: Record<LagProfile, LagConfig> = {
  fast: {
    label: "Fast",
    description: "~1s behind — maximum anticipation, most correction risk",
    stabiliseMs: 350,
    minTriggerChars: 6,
    maxHoldMs: 1000,
    commitDwellMs: 1200,
    anticipation: "aggressive",
  },
  balanced: {
    label: "Balanced",
    description: "~2–3s behind — the default working lag",
    stabiliseMs: 900,
    minTriggerChars: 10,
    maxHoldMs: 2600,
    commitDwellMs: 2600,
    anticipation: "conservative",
  },
  safe: {
    label: "Safe",
    description: "~4–6s behind — waits for complete thoughts, no prediction",
    stabiliseMs: 1800,
    minTriggerChars: 16,
    maxHoldMs: 5200,
    commitDwellMs: 5000,
    anticipation: "off",
  },
};

export const lagConfig = (lag: LagProfile): LagConfig => LAG_PROFILES[lag];
