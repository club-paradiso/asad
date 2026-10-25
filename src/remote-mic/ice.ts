/**
 * ICE server configuration for Remote Microphone.
 *
 * Same-Wi-Fi pairing needs nothing but host candidates. STUN helps two devices
 * behind ordinary NATs find each other; it carries no audio and no credential.
 * TURN relays audio when no direct path exists (guest Wi-Fi with client
 * isolation, phone on cellular, strict corporate networks) — and it costs
 * money, so ASAD never ships with one. A deployer opts in explicitly:
 *
 *   REMOTE_MIC_STUN_URLS        comma-separated stun: URLs, or "none"
 *   REMOTE_MIC_TURN_URLS        comma-separated turn:/turns: URLs
 *   REMOTE_MIC_TURN_SECRET      coturn "use-auth-secret" shared secret
 *                               (preferred: per-pairing credentials that expire)
 *   REMOTE_MIC_TURN_USERNAME    static credential, when the relay has no
 *   REMOTE_MIC_TURN_CREDENTIAL  REST-API secret
 *   REMOTE_MIC_ICE_TRANSPORT_POLICY  "relay" to force TURN (testing only)
 *
 * The relay credential is only ever handed to an authenticated pairing role,
 * never to /api/config or a diagnostics page.
 */
import "server-only";
import { createHmac } from "node:crypto";
import type { RemoteMicIceConfig, RemoteMicIceServer } from "./protocol";

const DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];
/** Ephemeral TURN credentials outlive the pairing's hard ceiling. */
const TURN_CREDENTIAL_TTL_S = 6 * 60 * 60;

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const valid = (url: string, schemes: string[]) =>
  schemes.some((scheme) => url.startsWith(`${scheme}:`)) && url.length <= 256 && !/\s/.test(url);

export function remoteMicIceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: number = Date.now(),
): RemoteMicIceConfig {
  const servers: RemoteMicIceServer[] = [];

  const stunSetting = env.REMOTE_MIC_STUN_URLS?.trim();
  const stun =
    stunSetting?.toLowerCase() === "none"
      ? []
      : (stunSetting ? list(stunSetting) : DEFAULT_STUN).filter((url) => valid(url, ["stun", "stuns"]));
  if (stun.length) servers.push({ urls: stun });

  const turnUrls = list(env.REMOTE_MIC_TURN_URLS).filter((url) => valid(url, ["turn", "turns"]));
  const turnCredential = turnUrls.length ? turnCredentials(env, now) : null;
  if (turnUrls.length && turnCredential) servers.push({ urls: turnUrls, ...turnCredential });

  const relayOnly = env.REMOTE_MIC_ICE_TRANSPORT_POLICY?.trim().toLowerCase() === "relay";
  return {
    iceServers: servers,
    // Forcing relay without a relay would make pairing impossible; ignore it.
    iceTransportPolicy: relayOnly && turnCredential ? "relay" : "all",
    turn: !!(turnUrls.length && turnCredential),
  };
}

function turnCredentials(env: Readonly<Record<string, string | undefined>>, now: number) {
  const secret = env.REMOTE_MIC_TURN_SECRET?.trim();
  if (secret) {
    // coturn TURN REST API: username = "<expiry>:<label>", password =
    // base64(HMAC-SHA1(secret, username)). Expires on its own.
    const username = `${Math.floor(now / 1000) + TURN_CREDENTIAL_TTL_S}:asad-remote-mic`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    return { username, credential };
  }
  const username = env.REMOTE_MIC_TURN_USERNAME?.trim();
  const credential = env.REMOTE_MIC_TURN_CREDENTIAL?.trim();
  return username && credential ? { username, credential } : null;
}

/** Capability flags only — safe for /api/config. */
export function remoteMicTurnConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return remoteMicIceConfig(env).turn;
}
