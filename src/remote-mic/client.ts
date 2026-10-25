/**
 * Browser side of the Remote Microphone signalling routes.
 *
 * A thin, injectable wrapper so the receiver and sender state machines can be
 * driven against the real route handlers in tests. Errors keep the server's
 * machine-readable code; the UI decides how to say it.
 */
import {
  REMOTE_MIC_TOKEN_HEADER,
  type ClaimPairingResponse,
  type CreatePairingResponse,
  type RemoteMicErrorCode,
  type RemoteMicState,
  type RemoteMicView,
  type SignalRequest,
} from "./protocol";

export type RemoteMicClientErrorCode = RemoteMicErrorCode | "NETWORK" | "UNKNOWN";

export class RemoteMicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: RemoteMicClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RemoteMicApiError";
  }
}

export interface RemoteMicApi {
  create(): Promise<CreatePairingResponse>;
  claim(id: string, secret: string): Promise<ClaimPairingResponse>;
  poll(id: string, token: string, since: number): Promise<RemoteMicView>;
  signal(token: string, request: SignalRequest): Promise<{ state: RemoteMicState; expiresAt: number }>;
  end(id: string, token: string): Promise<void>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createRemoteMicApi(deps: {
  fetch?: FetchLike;
  /** Used only for `create`, the one operator route that needs the app session. */
  guardedFetch?: FetchLike;
  base?: string;
} = {}): RemoteMicApi {
  const plain: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const guarded: FetchLike = deps.guardedFetch ?? plain;
  const base = deps.base ?? "";

  async function call<T>(fetcher: FetchLike, path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, { cache: "no-store", ...init });
    } catch {
      throw new RemoteMicApiError(0, "NETWORK", "Network request failed.");
    }
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: string; code?: RemoteMicErrorCode })
      | null;
    if (!response.ok) {
      const code: RemoteMicClientErrorCode =
        body?.code ?? (response.status === 401 ? "ACCESS_REQUIRED" : response.status === 429 ? "RATE_LIMITED" : "UNKNOWN");
      throw new RemoteMicApiError(response.status, code, body?.error ?? `Request failed (${response.status}).`);
    }
    return body as T;
  }

  const json = (token?: string): HeadersInit => ({
    "content-type": "application/json",
    ...(token ? { [REMOTE_MIC_TOKEN_HEADER]: token } : {}),
  });

  return {
    create: () =>
      call<CreatePairingResponse>(guarded, "/api/remote-mic/session", {
        method: "POST",
        headers: json(),
        body: "{}",
      }),
    claim: (id, secret) =>
      call<ClaimPairingResponse>(plain, "/api/remote-mic/claim", {
        method: "POST",
        headers: json(),
        body: JSON.stringify({ id, secret }),
      }),
    poll: (id, token, since) =>
      call<RemoteMicView>(
        plain,
        `/api/remote-mic/session?id=${encodeURIComponent(id)}&since=${since}`,
        { method: "GET", headers: { [REMOTE_MIC_TOKEN_HEADER]: token } },
      ),
    signal: (token, request) =>
      call(plain, "/api/remote-mic/signal", {
        method: "POST",
        headers: json(token),
        body: JSON.stringify(request),
      }),
    end: async (id, token) => {
      await call(plain, `/api/remote-mic/session?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { [REMOTE_MIC_TOKEN_HEADER]: token },
        keepalive: true,
      });
    },
  };
}
