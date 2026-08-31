import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetGuards,
  issueSessionToken,
  sessionEnforcement,
  verifySessionToken,
} from "./guard";
import { __resetEnvCache } from "./env";

const clear = () => {
  delete process.env.APP_ACCESS_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  __resetEnvCache();
  __resetGuards();
};

beforeEach(clear);
afterEach(clear);

describe("shared Redis session signing", () => {
  it("uses existing Redis credentials to enforce portable sessions", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "stable-shared-infrastructure-secret";
    __resetEnvCache();
    __resetGuards();

    expect(sessionEnforcement()).toBe("enforced");
    const token = issueSessionToken();

    // Simulate another serverless instance. The derived HMAC key is rebuilt
    // from the same deployment secret rather than a process-local random key.
    __resetGuards();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("stays best-effort when neither an explicit nor shared secret exists", () => {
    expect(sessionEnforcement()).toBe("best-effort");
  });
});
