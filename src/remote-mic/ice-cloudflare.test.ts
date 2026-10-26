import { describe, expect, it, vi } from "vitest";
import { parseCloudflareIceServers, remoteMicIceConfig, remoteMicTurnConfigured, resolveRemoteMicIceConfig } from "./ice";

const CF_ENV = {
  REMOTE_MIC_CLOUDFLARE_TURN_KEY_ID: "0123456789abcdef0123456789abcdef",
  REMOTE_MIC_CLOUDFLARE_TURN_API_TOKEN: "secret-api-token",
};

/** The documented response shape, including the browser-blocked port 53 URL. */
const CF_RESPONSE = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "minted-user",
      credential: "minted-credential",
    },
  ],
};

describe("Cloudflare TURN (optional)", () => {
  it("mints per-pairing TURN servers, keeps configured STUN and drops port 53", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(CF_RESPONSE), { status: 201 }));
    const config = await resolveRemoteMicIceConfig(CF_ENV, Date.now(), fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/0123456789abcdef0123456789abcdef/credentials/generate-ice-servers",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-api-token");
    expect(JSON.parse(String(init.body)).ttl).toBeGreaterThan(6 * 60 * 60 - 1);

    expect(config.turn).toBe(true);
    const turn = config.iceServers.find((server) => server.username);
    expect(turn?.username).toBe("minted-user");
    expect(turn?.urls.some((u) => /:53(\?|$)/.test(u))).toBe(false);
    expect(turn?.urls).toHaveLength(4);
    // The deployment's own STUN servers stay.
    expect(config.iceServers[0].urls.every((u) => u.startsWith("stun:"))).toBe(true);
  });

  it("degrades to the static configuration when Cloudflare fails — never an error", async () => {
    for (const fetchImpl of [
      async () => new Response("nope", { status: 401 }),
      async () => new Response("{}", { status: 201 }),
      async () => {
        throw new Error("offline");
      },
    ]) {
      const config = await resolveRemoteMicIceConfig(CF_ENV, Date.now(), fetchImpl as unknown as typeof fetch);
      expect(config.turn).toBe(false);
      expect(config).toEqual(remoteMicIceConfig(CF_ENV));
    }
  });

  it("does not call Cloudflare when not configured or when the relay is forced", async () => {
    const fetchImpl = vi.fn();
    await resolveRemoteMicIceConfig({}, Date.now(), fetchImpl as unknown as typeof fetch);
    const forced = await resolveRemoteMicIceConfig(
      { ...CF_ENV, REMOTE_MIC_TRANSPORT: "relay" },
      Date.now(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(forced.forceRelay).toBe(true);
  });

  it("reports TURN as configured for /api/config without exposing anything", () => {
    expect(remoteMicTurnConfigured({})).toBe(false);
    expect(remoteMicTurnConfigured(CF_ENV)).toBe(true);
    expect(remoteMicTurnConfigured({ REMOTE_MIC_CLOUDFLARE_TURN_KEY_ID: "../../x", REMOTE_MIC_CLOUDFLARE_TURN_API_TOKEN: "t" })).toBe(false);
  });

  it("rejects TURN entries without credentials and non-ICE schemes", () => {
    expect(
      parseCloudflareIceServers([
        { urls: ["turn:a.example:3478"] },
        { urls: "https://evil.example" },
        { urls: "stun:b.example:3478" },
      ]),
    ).toEqual([{ urls: ["stun:b.example:3478"] }]);
  });
});
