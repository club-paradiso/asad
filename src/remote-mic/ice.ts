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
 *   REMOTE_MIC_CLOUDFLARE_TURN_KEY_ID     Cloudflare Realtime TURN key: the
 *   REMOTE_MIC_CLOUDFLARE_TURN_API_TOKEN  server mints short-lived ICE servers
 *                               per pairing (1,000 GB/month free at the time
 *                               of writing; audio is ~30 MB/hour)
 *   REMOTE_MIC_TRANSPORT        "relay" skips WebRTC and uses the ASAD server
 *                               relay straight away (networks known to block
 *                               WebRTC, and testing the fallback)
 *
 * With none of these set, pairing still works across networks: when WebRTC
 * finds no path, the phone falls back to the ASAD server relay by itself.
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
    forceRelay: env.REMOTE_MIC_TRANSPORT?.trim().toLowerCase() === "relay",
  };
}

const CLOUDFLARE_TIMEOUT_MS = 2500;

function cloudflareConfigured(env: Readonly<Record<string, string | undefined>>) {
  const keyId = env.REMOTE_MIC_CLOUDFLARE_TURN_KEY_ID?.trim();
  const apiToken = env.REMOTE_MIC_CLOUDFLARE_TURN_API_TOKEN?.trim();
  return keyId && apiToken && /^[A-Za-z0-9_-]{8,128}$/.test(keyId) ? { keyId, apiToken } : null;
}

/**
 * The ICE configuration for one pairing role. Adds per-pairing Cloudflare
 * TURN credentials when that is configured; any Cloudflare failure degrades
 * to the static configuration (and so to the server relay), never to an error.
 */
export async function resolveRemoteMicIceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: number = Date.now(),
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<RemoteMicIceConfig> {
  const base = remoteMicIceConfig(env, now);
  const cloudflare = cloudflareConfigured(env);
  if (!cloudflare || base.forceRelay) return base;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cloudflare.keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${cloudflare.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_S }),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) return base;
    const body = (await response.json()) as { iceServers?: unknown };
    const minted = parseCloudflareIceServers(body.iceServers);
    if (!minted.length) return base;
    // Keep the configured STUN servers; add Cloudflare's TURN.
    const turnServers = minted.filter((server) => server.urls.some((url) => url.startsWith("turn")));
    if (!turnServers.length) return base;
    return {
      ...base,
      iceServers: [...base.iceServers.filter((server) => !server.username), ...turnServers],
      turn: true,
    };
  } catch {
    return base;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cloudflare's response, validated. Port 53 URLs are dropped: browsers block
 * that port, and without trickle ICE a blocked URL costs a timeout.
 */
export function parseCloudflareIceServers(value: unknown): RemoteMicIceServer[] {
  if (!Array.isArray(value)) return [];
  const servers: RemoteMicIceServer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls])
      .filter((url): url is string => typeof url === "string")
      .filter((url) => valid(url, ["stun", "stuns", "turn", "turns"]))
      .filter((url) => !/:53(\?|$)/.test(url));
    if (!urls.length) continue;
    const isTurn = urls.some((url) => url.startsWith("turn"));
    if (isTurn) {
      if (typeof entry.username !== "string" || typeof entry.credential !== "string") continue;
      servers.push({ urls, username: entry.username, credential: entry.credential });
    } else {
      servers.push({ urls });
    }
  }
  return servers;
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
  return remoteMicIceConfig(env).turn || !!cloudflareConfigured(env);
}
