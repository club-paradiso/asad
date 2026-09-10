import { describe, expect, it } from "vitest";
import {
  SESSION_QUOTA_BYPASS_MS,
  TEMPORARY_RATE_LIMIT_BYPASS_MS,
  cloudBypassMsForFailure,
} from "./cloud-degradation";

describe("cloud degradation bypass", () => {
  it("bypasses the rest of a normal service after a daily free quota exhaustion", () => {
    expect(
      cloudBypassMsForFailure({ reason: "OpenRouter rate limit exceeded: free-models-per-day" }),
    ).toBe(SESSION_QUOTA_BYPASS_MS);
    expect(cloudBypassMsForFailure({ reason: "Daily cap of 50 requests exhausted" })).toBe(
      SESSION_QUOTA_BYPASS_MS,
    );
  });

  it("uses a short cooldown for a generic 429", () => {
    expect(cloudBypassMsForFailure({ status: 429 })).toBe(TEMPORARY_RATE_LIMIT_BYPASS_MS);
    expect(cloudBypassMsForFailure({ reason: "temporarily rate limited" })).toBe(
      TEMPORARY_RATE_LIMIT_BYPASS_MS,
    );
  });

  it("does not suppress cloud after recoverable network or server failures", () => {
    expect(cloudBypassMsForFailure({ status: 503, reason: "upstream unavailable" })).toBe(0);
    expect(cloudBypassMsForFailure({ reason: "network request failed" })).toBe(0);
  });
});
