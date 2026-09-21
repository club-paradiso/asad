/**
 * When the live recovery route may be used at all.
 *
 * The route exists so a total provider failure does not end in silence. It must
 * not also become a way for speech to reach a new set of servers because of
 * where the app happens to be hosted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetEnvCache } from "@/lib/env";
import { LIVE_RECOVERY_ID, liveGatewayRecovery, liveRecoveryAllowed, liveRecoveryModel } from "./live-recovery";

const KEY = "x".repeat(24);
const ORIGINAL = { ...process.env };

const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetEnvCache();
};

beforeEach(() => {
  setEnv({
    AI_GATEWAY_API_KEY: undefined,
    VERCEL_OIDC_TOKEN: undefined,
    VERCEL_AI_GATEWAY_LIVE_MODEL: undefined,
    LLM_PRIVACY_MODE: undefined,
  });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  __resetEnvCache();
});

describe("availability", () => {
  it("is absent with no credential at all", () => {
    expect(liveRecoveryAllowed()).toBe(false);
    // Null rather than a route that always fails: a deployment that never
    // configured the gateway should not accumulate a failed attempt on every
    // turn of every session.
    expect(liveGatewayRecovery()).toBeNull();
  });

  it("is available from an ambient host token on an ordinary deployment", () => {
    setEnv({ VERCEL_OIDC_TOKEN: KEY });
    expect(liveRecoveryAllowed()).toBe(true);
    expect(liveGatewayRecovery()?.id).toBe(LIVE_RECOVERY_ID);
  });

  it("is available from the current request's OIDC token when the env snapshot is absent", () => {
    expect(liveRecoveryAllowed(KEY)).toBe(true);
    expect(liveGatewayRecovery(KEY)?.id).toBe(LIVE_RECOVERY_ID);
  });

  it("is available from an explicit gateway key", () => {
    setEnv({ AI_GATEWAY_API_KEY: KEY });
    expect(liveRecoveryAllowed()).toBe(true);
  });
});

describe("strict privacy mode", () => {
  it("ignores an ambient host token", () => {
    // Strict mode is a deployer's statement about whose servers may see this
    // speech. A credential nobody chose to set is not that statement, so the
    // route stays closed and the turn ends at the local interpreter.
    setEnv({ VERCEL_OIDC_TOKEN: KEY, LLM_PRIVACY_MODE: "strict" });
    expect(liveRecoveryAllowed()).toBe(false);
    expect(liveGatewayRecovery()).toBeNull();
  });

  it("also ignores a request-scoped host token in strict mode", () => {
    setEnv({ LLM_PRIVACY_MODE: "strict" });
    expect(liveRecoveryAllowed(KEY)).toBe(false);
    expect(liveGatewayRecovery(KEY)).toBeNull();
  });

  it("accepts a key the deployer set on purpose", () => {
    setEnv({ AI_GATEWAY_API_KEY: KEY, LLM_PRIVACY_MODE: "strict" });
    expect(liveRecoveryAllowed()).toBe(true);
  });
});

describe("the model it asks for", () => {
  it("is separately overridable from Counter's", () => {
    setEnv({ VERCEL_AI_GATEWAY_LIVE_MODEL: "openai/gpt-5-mini" });
    expect(liveRecoveryModel()).toBe("openai/gpt-5-mini");
  });

  it("falls back to the shared default", () => {
    expect(liveRecoveryModel()).toBe("google/gemini-2.5-flash-lite");
  });
});
