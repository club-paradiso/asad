import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { remoteMicIceConfig } from "./ice";

describe("remote microphone ICE configuration", () => {
  it("defaults to public STUN only — no relay, no credential", () => {
    const config = remoteMicIceConfig({});
    expect(config.turn).toBe(false);
    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers[0].urls.every((url) => url.startsWith("stun:"))).toBe(true);
    expect(config.iceServers[0].credential).toBeUndefined();
  });

  it("can disable STUN for strictly local operation", () => {
    expect(remoteMicIceConfig({ REMOTE_MIC_STUN_URLS: "none" }).iceServers).toEqual([]);
  });

  it("drops malformed URLs", () => {
    const config = remoteMicIceConfig({ REMOTE_MIC_STUN_URLS: "stun:ok.example:3478, http://evil, turn:wrong-scheme" });
    expect(config.iceServers[0].urls).toEqual(["stun:ok.example:3478"]);
  });

  it("issues expiring coturn REST credentials from a shared secret", () => {
    const now = 1_800_000_000_000;
    const config = remoteMicIceConfig(
      { REMOTE_MIC_TURN_URLS: "turns:turn.example:5349", REMOTE_MIC_TURN_SECRET: "s3cret" },
      now,
    );
    const turn = config.iceServers.find((server) => server.urls[0].startsWith("turn"));
    expect(config.turn).toBe(true);
    expect(turn?.username).toMatch(/^\d+:asad-remote-mic$/);
    const expiry = Number(turn!.username!.split(":")[0]);
    expect(expiry).toBeGreaterThan(now / 1000);
    expect(turn?.credential).toBe(createHmac("sha1", "s3cret").update(turn!.username!).digest("base64"));
  });

  it("supports static TURN credentials and ignores TURN without any", () => {
    expect(
      remoteMicIceConfig({
        REMOTE_MIC_TURN_URLS: "turn:turn.example:3478",
        REMOTE_MIC_TURN_USERNAME: "u",
        REMOTE_MIC_TURN_CREDENTIAL: "p",
      }).turn,
    ).toBe(true);
    expect(remoteMicIceConfig({ REMOTE_MIC_TURN_URLS: "turn:turn.example:3478" }).turn).toBe(false);
  });

  it("never forces relay-only when no relay exists", () => {
    expect(remoteMicIceConfig({ REMOTE_MIC_ICE_TRANSPORT_POLICY: "relay" }).iceTransportPolicy).toBe("all");
    expect(
      remoteMicIceConfig({
        REMOTE_MIC_ICE_TRANSPORT_POLICY: "relay",
        REMOTE_MIC_TURN_URLS: "turn:turn.example:3478",
        REMOTE_MIC_TURN_SECRET: "s",
      }).iceTransportPolicy,
    ).toBe("relay");
  });
});
