import { beforeEach, describe, expect, it } from "vitest";
import {
  counterDataClass,
  isSensitiveCounterProfile,
} from "@/counter/profiles";
import {
  __memoryLearningCandidates,
  __resetMemoryLearningCandidates,
  recordLearningCandidate,
} from "./vault";

describe("sensitive Counter data handling", () => {
  beforeEach(() => __resetMemoryLearningCandidates());

  it("classifies refugee and judicial profiles as sensitive", () => {
    expect(counterDataClass("refugee")).toBe("refugee");
    expect(counterDataClass("judicial")).toBe("judicial");
    expect(isSensitiveCounterProfile("refugee")).toBe(true);
    expect(isSensitiveCounterProfile("judicial")).toBe(true);
    expect(isSensitiveCounterProfile("immigration")).toBe(false);
  });

  it.each(["refugee", "judicial"] as const)(
    "never puts %s turns into the Learning Vault",
    async (profileId) => {
      const result = await recordLearningCandidate({
        sourceText: "My name is Example Person and this is my statement.",
        modelTranslation: "제 이름은 예시 인물이고 이것은 제 진술입니다.",
        sourceLang: "en-US",
        targetLang: "ko-KR",
        profileId,
        confidence: "high",
        integrity: { status: "verified", issues: [] },
      });

      expect(result.stored).toBe(false);
      expect(result.reason).toBe("sensitive-profile-excluded");
      expect(__memoryLearningCandidates()).toHaveLength(0);
    },
  );
});
