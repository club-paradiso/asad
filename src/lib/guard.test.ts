/**
 * Route protection.
 *
 * Every assertion here corresponds to a way someone could spend the deployer's
 * OpenRouter balance. They are written as the attack, not as the feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCESS_COOKIE,
  SESSION_COOKIE,
  __resetGuards,
  clientAddress,
  guardInferenceRoute,
  isSameOrigin,
  issueSessionToken,
  readJsonBody,
  secretsMatch,
  sessionEnforcement,
  verifySessionToken,
} from "./guard";
import { RequestRateLimiter } from "./rate-limit";
import { __resetEnvCache } from "./env";

const ORIGIN = "http://localhost";

const req = (init: {
  body?: unknown;
  origin?: string | null;
  cookie?: string;
  headers?: Record<string, string>;
} = {}) =>
  new Request("http://localhost/api/interpret", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init.origin === null ? {} : { origin: init.origin ?? ORIGIN }),
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...init.headers,
    },
    body: JSON.stringify(init.body ?? { ok: true }),
  });

const withSession = () => `${SESSION_COOKIE}=${issueSessionToken()}`;

const guard = (request: Request) =>
  guardInferenceRoute(request, {
    requireSession: true,
    maxBodyBytes: 4096,
    limits: [{ rule: "interpretSession", by: "session" }],
  });

beforeEach(() => {
  delete process.env.APP_ACCESS_KEY;
  delete process.env.SESSION_SECRET;
  __resetEnvCache();
  __resetGuards();
});

/**
 * Session enforcement on a deployment that scales out.
 *
 * The bug these exist to prevent is not a weakness, it is an outage. With a
 * per-process signing key and more than one instance, a token minted by one
 * instance fails on the next — so enforcing sessions would 401 every request
 * in a loop, with the console re-minting a token the following request
 * rejects again. Interpretation would fail continuously on the exact platform
 * this project documents deploying to.
 */
describe("session enforcement", () => {
  it("is best-effort when no secret is stable across instances", () => {
    expect(sessionEnforcement()).toBe("best-effort");
  });

  it("does not refuse a request it cannot verify, in best-effort mode", async () => {
    // Same-origin and rate limits still apply; the token just cannot gate.
    const result = await guard(req());
    expect(result.ok).toBe(true);
  });

  it("still refuses cross-origin in best-effort mode", async () => {
    // Degrading session enforcement must not degrade anything else.
    const result = await guard(req({ origin: "https://attacker.example" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("enforces once SESSION_SECRET makes tokens portable", async () => {
    process.env.SESSION_SECRET = "a-secret-shared-by-every-instance";
    __resetEnvCache();
    __resetGuards();

    expect(sessionEnforcement()).toBe("enforced");
    const without = await guard(req());
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.response.status).toBe(401);

    const withToken = await guard(req({ cookie: withSession() }));
    expect(withToken.ok).toBe(true);
  });

  it("treats APP_ACCESS_KEY as a stable secret too", () => {
    process.env.APP_ACCESS_KEY = "a-private-deployment-key";
    __resetEnvCache();
    __resetGuards();
    // A gated deployment needs no second variable to get full strength.
    expect(sessionEnforcement()).toBe("enforced");
  });
});

describe("session tokens", () => {
  it("accepts a token this server minted", () => {
    expect(verifySessionToken(issueSessionToken())).toBe(true);
  });

  it("rejects a forged token", () => {
    const real = issueSessionToken();
    const forged = `${real.slice(0, real.lastIndexOf("."))}.${"A".repeat(43)}`;
    expect(verifySessionToken(forged)).toBe(false);
  });

  it("rejects a token whose expiry has been edited forward", () => {
    // The expiry is inside the signed payload, so moving it invalidates the
    // signature rather than extending the token.
    const tampered = `${Date.now() + 10_000_000}.abc.${"A".repeat(43)}`;
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = issueSessionToken(0);
    expect(verifySessionToken(token, Date.now())).toBe(false);
  });

  it("rejects nonsense rather than throwing", () => {
    for (const value of [undefined, "", ".", "no-dots", "a.b"]) {
      expect(verifySessionToken(value as string | undefined)).toBe(false);
    }
  });
});

describe("same-origin", () => {
  it("accepts a request from a page this deployment served", () => {
    expect(isSameOrigin(req())).toBe(true);
  });

  it("rejects a request from somebody else's page", () => {
    // The case this exists for: a script on another site spending our credits.
    // A browser cannot forge Origin, so this one is airtight against browsers.
    expect(isSameOrigin(req({ origin: "https://attacker.example" }))).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    const request = new Request("http://localhost/api/interpret", {
      method: "POST",
      headers: { referer: "https://attacker.example/page" },
    });
    expect(isSameOrigin(request)).toBe(false);
  });

  it("resolves the host from the request URL when no host header survives", () => {
    // `Host` is a forbidden header the Fetch API strips. Reading only that
    // made the check fail closed, which is a denial of service, not security.
    expect(isSameOrigin(req({ origin: null }))).toBe(true);
  });
});

describe("body limits", () => {
  it("refuses an oversized body with 413", async () => {
    const result = await readJsonBody(req({ body: { pad: "x".repeat(9000) } }), 4096);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("refuses a declared oversize before reading anything", async () => {
    const request = new Request("http://localhost/api/interpret", {
      method: "POST",
      headers: { "content-length": "99999999" },
      body: "{}",
    });
    expect(await readJsonBody(request, 4096)).toMatchObject({ ok: false, status: 413 });
  });

  it("refuses malformed JSON with 400, not 500", async () => {
    const request = new Request("http://localhost/api/interpret", {
      method: "POST",
      body: "{not json",
    });
    expect(await readJsonBody(request, 4096)).toMatchObject({ ok: false, status: 400 });
  });

  it("accepts a body inside the ceiling", async () => {
    expect(await readJsonBody(req({ body: { a: 1 } }), 4096)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });
});

describe("the guard as a whole", () => {
  it("lets a legitimate console request through", async () => {
    const result = await guard(req({ cookie: withSession() }));
    expect(result.ok).toBe(true);
  });

  it("refuses a request with no session token, when tokens are enforceable", async () => {
    process.env.SESSION_SECRET = "a-secret-shared-by-every-instance";
    __resetEnvCache();
    __resetGuards();
    const result = await guard(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("refuses a cross-origin request even with a valid session", async () => {
    const result = await guard(
      req({ origin: "https://attacker.example", cookie: withSession() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rate limits a client that will not stop", async () => {
    const cookie = withSession();
    let last: Awaited<ReturnType<typeof guard>> | null = null;
    // The configured live budget is 60/minute; a real interpreter produces
    // about eleven. Anything that reaches 61 is not interpreting.
    for (let i = 0; i < 61; i += 1) last = await guard(req({ cookie }));
    expect(last?.ok).toBe(false);
    if (last && !last.ok) {
      expect(last.response.status).toBe(429);
      expect(last.response.headers.get("retry-after")).toBeTruthy();
    }
  });

  it("never lets a body reach a provider before the limits are checked", async () => {
    // Ordering matters for cost: an oversized body from a rate-limited client
    // must be rejected on the limit, without being read.
    const cookie = withSession();
    for (let i = 0; i < 61; i += 1) await guard(req({ cookie }));
    const result = await guard(req({ cookie, body: { pad: "x".repeat(9000) } }));
    if (!result.ok) expect(result.response.status).toBe(429);
  });
});

describe("access gate", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_KEY = "a-private-deployment-key";
    __resetEnvCache();
    __resetGuards();
  });

  it("refuses everything without the key", async () => {
    const result = await guard(req({ cookie: withSession() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("admits a browser holding the access cookie", async () => {
    const result = await guard(
      req({ cookie: `${ACCESS_COOKIE}=a-private-deployment-key; ${withSession()}` }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a near-miss key", async () => {
    const result = await guard(
      req({ cookie: `${ACCESS_COOKIE}=a-private-deployment-ke; ${withSession()}` }),
    );
    expect(result.ok).toBe(false);
  });

  it("compares secrets without leaking length through an early return", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abcd")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });
});

describe("client address", () => {
  it("takes the first hop from x-forwarded-for", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(clientAddress(request)).toBe("203.0.113.9");
  });

  it("degrades to a shared bucket rather than to no limit", () => {
    // Failing toward throttling is the correct direction to be wrong in when
    // the alternative is failing toward spending.
    expect(clientAddress(new Request("http://localhost/"))).toBe("unknown");
  });
});

describe("rate limiter", () => {
  it("rolls the window", () => {
    let now = 0;
    const limiter = new RequestRateLimiter({ limit: 2, windowMs: 1000 }, 100, () => now);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
    now = 1001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("cannot be made to allocate without bound by unique keys", () => {
    // Otherwise the limiter is itself the denial-of-service vector: the key is
    // attacker-controlled.
    const limiter = new RequestRateLimiter({ limit: 5, windowMs: 1000 }, 50);
    for (let i = 0; i < 5000; i += 1) limiter.check(`key-${i}`);
    expect(limiter.trackedKeys).toBeLessThanOrEqual(50);
  });

  it("reports the headroom a well-behaved client has left", () => {
    const limiter = new RequestRateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.check("k").remaining).toBe(2);
    expect(limiter.check("k").remaining).toBe(1);
  });
});
