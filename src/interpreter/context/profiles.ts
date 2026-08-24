/**
 * Provider-aware context profiles.
 *
 * Phase 1 sent one context size to everyone. That is fine for a provider with
 * 250,000 tokens per minute and impossible for one with 6,000 — Groq's free
 * tier cannot carry tong-yuck's full context at live speed, and no amount of
 * hoping changes that.
 *
 * So the budget is a profile, chosen from the provider's headroom and the
 * live quota pressure. The ordering below is deliberate: the last things to be
 * cut are the ones an interpreter cannot recover from — a name they have
 * already established, a correction they made, the passage on screen.
 */
import type { InterpretRequest } from "@/lib/schema";

/**
 * The context as it crosses the wire. Slightly looser than the engine's
 * internal `RollingContext` — `summary` is optional here because a client may
 * legitimately omit it.
 */
export type WireContext = InterpretRequest["context"];

export type ContextProfile = "full" | "compact" | "ultra-compact";

export interface ProfileBudget {
  koreanSegments: number;
  englishChunks: number;
  glossary: number;
  entities: number;
  scripture: number;
  corrections: number;
  /** Whether the compressed history summary is sent at all. */
  summary: boolean;
  /** Whether prep notes are sent. */
  prepNotes: boolean;
  /** Rough total tokens this profile is aiming at. */
  targetTokens: number;
}

export const PROFILE_BUDGETS: Record<ContextProfile, ProfileBudget> = {
  full: {
    koreanSegments: 12,
    englishChunks: 12,
    glossary: 24,
    entities: 16,
    scripture: 8,
    corrections: 16,
    summary: true,
    prepNotes: true,
    // MEASURED by `npm run bench:live`, not estimated.
    targetTokens: 2718,
  },
  compact: {
    koreanSegments: 5,
    englishChunks: 4,
    glossary: 10,
    entities: 10,
    scripture: 3,
    corrections: 10,
    summary: true,
    prepNotes: false,
    targetTokens: 2432,
  },
  "ultra-compact": {
    // Only what the interpreter cannot recover from: the last thing said, the
    // last thing rendered, the live passage, settled names and corrections.
    koreanSegments: 2,
    englishChunks: 1,
    glossary: 4,
    entities: 6,
    scripture: 1,
    corrections: 8,
    summary: false,
    prepNotes: false,
    // Only ~20% below full: the system prompt dominates, so context trimming
    // has a hard floor. See docs/llm-benchmark.md.
    targetTokens: 2177,
  },
};

/** Apply a profile's budget to an already-built rolling context. */
export function applyProfile(
  context: WireContext,
  profile: ContextProfile,
): WireContext {
  const budget = PROFILE_BUDGETS[profile];
  return {
    ...context,
    summary: budget.summary ? context.summary : undefined,
    recentKorean: context.recentKorean.slice(-budget.koreanSegments),
    recentEnglish: context.recentEnglish.slice(-budget.englishChunks),
    glossary: context.glossary.slice(-budget.glossary),
    entities: context.entities.slice(-budget.entities),
    scripture: context.scripture.slice(-budget.scripture),
    // Corrections are never trimmed hard: an interpreter who fixed a name once
    // must not see it revert because the token budget got tight.
    corrections: context.corrections.slice(-budget.corrections),
    prep: budget.prepNotes
      ? context.prep
      : context.prep
        ? { ...context.prep, notes: undefined }
        : undefined,
  };
}

export interface ProfileDecision {
  profile: ContextProfile;
  reason: string;
}

/**
 * Choose a profile.
 *
 * Quota pressure and the provider's own recommended live budget both feed in.
 * The result is deliberately conservative: dropping to `compact` costs a little
 * contextual quality, whereas exceeding a free tier costs the whole session.
 */
export function chooseProfile(input: {
  recommendedLiveTokens?: number;
  quotaPressure: number;
  /** Recent p95 latency for this provider, if known. */
  latencyP95Ms?: number;
  /** Lag profile — SAFE can afford more context, FAST cannot. */
  lag: "fast" | "balanced" | "safe";
}): ProfileDecision {
  const recommended = input.recommendedLiveTokens ?? PROFILE_BUDGETS.full.targetTokens;

  // Thresholds sit just above each profile's MEASURED cost, so a provider whose
  // sustainable budget is around a profile's real price gets that profile.
  // This is the Groq case: its budget sits at the ultra-compact price.
  if (recommended < PROFILE_BUDGETS.compact.targetTokens) {
    return {
      profile: "ultra-compact",
      reason: `Provider sustains only ~${recommended} tokens per live call.`,
    };
  }

  if (input.quotaPressure >= 0.85) {
    return { profile: "ultra-compact", reason: "Free-tier quota nearly exhausted." };
  }

  if (recommended < PROFILE_BUDGETS.full.targetTokens) {
    return {
      profile: "compact",
      reason: `Provider sustains ~${recommended} tokens per live call.`,
    };
  }

  if (input.quotaPressure >= 0.6) {
    return { profile: "compact", reason: "Approaching the free-tier quota." };
  }

  // A provider that is consistently slow benefits from less to read.
  if (input.latencyP95Ms !== undefined && input.latencyP95Ms > 3500) {
    return { profile: "compact", reason: "p95 latency above the live target." };
  }

  if (input.lag === "fast") {
    return { profile: "compact", reason: "FAST lag — smaller prompt for lower latency." };
  }

  return { profile: "full", reason: "Ample headroom." };
}
