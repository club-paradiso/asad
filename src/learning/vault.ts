import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { resolveCounterRedisConfig, type RedisConfig } from "@/counter/store";
import { isSensitiveCounterProfile, type CounterProfileId } from "@/counter/profiles";
import type { TranslationIntegrity } from "@/counter/types";
import { redactForLearning } from "./privacy";
import { hasSafetyReviewFlag } from "./review";
import type { HumanReviewFlag, LearningCandidate } from "./types";

const REDIS_KEY = "asad:learning:v1:candidates";
const MAX_CANDIDATES = 5_000;
const RETENTION_SECONDS = 180 * 24 * 60 * 60;
const MEMORY_MAX = 500;

const memoryCandidates: LearningCandidate[] = [];

interface RedisResponse<T> {
  result?: T;
  error?: string;
}

async function redisCommand<T>(config: RedisConfig, args: Array<string | number>): Promise<T> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Learning Vault Redis request failed (${response.status}).`);
  const body = (await response.json()) as RedisResponse<T>;
  if (body.error) throw new Error(`Learning Vault Redis error: ${body.error}`);
  return body.result as T;
}

export interface RecordLearningCandidateInput {
  sourceText: string;
  modelTranslation: string;
  sourceLang: string;
  targetLang: string;
  profileId: CounterProfileId;
  confidence?: "high" | "medium" | "low";
  integrity?: TranslationIntegrity;
  reviewFlags?: HumanReviewFlag[];
}

/**
 * Store only a de-identified, high-confidence translation candidate.
 *
 * Raw session codes, participant identities, desk labels and the unredacted
 * utterance never enter this store. Safety-flagged, low-confidence and
 * integrity-mismatched turns are deliberately excluded from training data.
 *
 * Refugee and judicial/case-processing profiles are fail-closed: their turns
 * never enter the Learning Vault at all, even after redaction. Those sessions
 * exist only in the short-lived Counter session store and are deleted when the
 * session ends (or its TTL expires).
 */
export async function recordLearningCandidate(
  input: RecordLearningCandidateInput,
): Promise<{ stored: boolean; durable: boolean; reason?: string }> {
  const durable = !!resolveCounterRedisConfig();

  if (isSensitiveCounterProfile(input.profileId)) {
    return { stored: false, durable, reason: "sensitive-profile-excluded" };
  }
  if (hasSafetyReviewFlag(input.reviewFlags)) {
    return { stored: false, durable, reason: "safety-review" };
  }
  if (input.confidence !== "high") {
    return { stored: false, durable, reason: "not-high-confidence" };
  }
  if (input.integrity?.status === "mismatch") {
    return { stored: false, durable, reason: "integrity-mismatch" };
  }

  const source = redactForLearning(input.sourceText);
  const target = redactForLearning(input.modelTranslation);
  if (!source.text || !target.text) {
    return { stored: false, durable, reason: "empty-after-redaction" };
  }

  const sourceHash = createHash("sha256")
    .update(`${input.sourceLang}\u0000${input.targetLang}\u0000${source.text}`)
    .digest("hex");

  const candidate: LearningCandidate = {
    id: randomUUID(),
    createdAt: Date.now(),
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    profileId: input.profileId,
    sourceText: source.text,
    modelTranslation: target.text,
    sourceHash,
    origin: "verified-model",
  };

  const redis = resolveCounterRedisConfig();
  if (redis) {
    await redisCommand<number>(redis, ["LPUSH", REDIS_KEY, JSON.stringify(candidate)]);
    await redisCommand<string>(redis, ["LTRIM", REDIS_KEY, 0, MAX_CANDIDATES - 1]);
    await redisCommand<number>(redis, ["EXPIRE", REDIS_KEY, RETENTION_SECONDS]);
    return { stored: true, durable: true };
  }

  memoryCandidates.unshift(candidate);
  if (memoryCandidates.length > MEMORY_MAX) memoryCandidates.length = MEMORY_MAX;
  return { stored: true, durable: false };
}

export function learningVaultInfo(env: NodeJS.ProcessEnv = process.env) {
  const redis = resolveCounterRedisConfig(env);
  return {
    kind: redis ? ("redis" as const) : ("memory" as const),
    durable: !!redis,
    retentionDays: redis ? 180 : null,
    rawIdentityStored: false,
    personRiskProfiles: false,
    sensitiveProfilesStored: false,
    sensitivePolicy: "session-only" as const,
  };
}

/** Test seam for the non-durable local fallback. */
export const __memoryLearningCandidates = () => [...memoryCandidates];
export const __resetMemoryLearningCandidates = () => {
  memoryCandidates.length = 0;
};
