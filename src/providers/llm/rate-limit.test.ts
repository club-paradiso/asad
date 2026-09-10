import { describe, expect, it } from "vitest";
import { RateLimitTracker } from "./rate-limit";

describe("RateLimitTracker pressure semantics", () => {
  it("keeps a near-daily-cap estimate advisory rather than a hard stop", () => {
    let now = 0;
    const tracker = new RateLimitTracker(
      "openrouter",
      { requestsPerMinute: 20, requestsPerDay: 50 },
      () => now,
    );

    // Spread 46 requests across separate minute windows. A serverless instance
    // seeing this many requests may warn, but it must not declare the whole
    // OpenRouter account exhausted: funded accounts can have a larger free-model
    // allowance and other instances do not share this counter.
    for (let i = 0; i < 46; i += 1) {
      tracker.recordRequest(100);
      now += 61_000;
    }

    const pressure = tracker.pressure();
    expect(pressure.advisoryLevel).toBeGreaterThanOrEqual(0.9);
    expect(pressure.advisoryDetail).toContain("advisory");
    expect(pressure.level).toBeLessThan(0.9);
    expect(pressure.binding).toBe("rpm");
  });

  it("still treats minute request pressure as enforceable", () => {
    const tracker = new RateLimitTracker(
      "openrouter",
      { requestsPerMinute: 20, requestsPerDay: 1000 },
      () => 0,
    );

    for (let i = 0; i < 18; i += 1) tracker.recordRequest(100);

    const pressure = tracker.pressure();
    expect(pressure.level).toBeGreaterThanOrEqual(0.9);
    expect(pressure.binding).toBe("rpm");
  });

  it("treats an actual 429 as hard evidence regardless of daily estimates", () => {
    const tracker = new RateLimitTracker(
      "openrouter",
      { requestsPerMinute: 20, requestsPerDay: 1000 },
      () => 0,
    );

    tracker.recordRateLimited();
    const pressure = tracker.pressure();
    expect(pressure.level).toBeGreaterThanOrEqual(0.9);
    expect(pressure.detail).toContain("rate-limit");
  });

  it("does not misread reported request remainder as an RPM window", () => {
    const tracker = new RateLimitTracker(
      "groq",
      { requestsPerMinute: 30, requestsPerDay: 1000 },
      () => 0,
    );

    // Groq documents x-ratelimit-remaining-requests as an RPD value. A large
    // reported remainder must not become a nonsensical RPM score.
    tracker.observe({ requestsRemaining: 900, observedAt: 0 });
    const pressure = tracker.pressure();
    expect(pressure.level).toBe(0);
    expect(pressure.advisoryLevel).toBe(0);
  });
});
