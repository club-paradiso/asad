"use client";

/**
 * The contextual (cloud) lane as the browser runs it.
 *
 * One call of `interpret` is one `/api/interpret` round trip with the short
 * retry ladder a live turn can afford, the quota-dead bypass, and the fallback
 * order the console relies on:
 *
 *   cloud → (already-ready Chrome Translator) → deterministic local helper
 *
 * Extracted from `useLiveSession` so the quota, retry and fallback rules can be
 * tested without React, and so the hook is left owning only browser wiring.
 * Every dependency that touches the world is injected.
 */
import type { InterpretRequest } from "@/lib/schema";
import { interpreterOutputSchema } from "@/lib/schema";
import type { InterpreterOutput } from "@/types";
import type { ContextualTurnInfo, InterpretResult } from "@/interpreter/engine/session";
import {
  translateWithBrowserTranslator,
  type BrowserTranslatorSession,
} from "@/providers/llm/browser-translator";
import type { ClientLatencyQueue } from "./client-latency";
import { cloudBypassMsForFailure } from "./cloud-degradation";

/** Short retries only. Live work cannot wait through a conventional API backoff. */
export const INTERPRET_RETRY_DELAYS_MS = [0, 350, 900] as const;

export const BROWSER_TRANSLATOR_PROVIDER = "browser-on-device";
export const BROWSER_TRANSLATOR_MODEL = "chrome-translator";

export const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

const retryableInterpretStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const retryAfterMs = (response: Response): number | null => {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
};

export interface CloudLaneDeps {
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  /** The already-prepared on-device translator, or null. Never awaits a download. */
  browserTranslator: () => BrowserTranslatorSession | null;
  /** Deterministic helper for the no-translation floor. */
  local: (request: InterpretRequest) => InterpreterOutput;
  telemetry: ClientLatencyQueue;
  onProvider?: (provider: string | undefined) => void;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface CloudLane {
  interpret(request: InterpretRequest, signal: AbortSignal, turn?: ContextualTurnInfo): Promise<InterpretResult>;
  /** Wall-clock time until which known-doomed cloud turns are skipped. */
  bypassUntil(): number;
}

export function createCloudLane(deps: CloudLaneDeps): CloudLane {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? abortableSleep;
  /** Skip known-doomed cloud turns only while a real on-device translator is ready. */
  let cloudBypassUntil = 0;

  const interpret = async (
    request: InterpretRequest,
    signal: AbortSignal,
    turn?: ContextualTurnInfo,
  ): Promise<InterpretResult> => {
    let firstClientDispatchedAt: number | undefined;

    /**
     * The fast lane already rendered this turn's English on-device. A second
     * on-device translation of the same Korean would only duplicate it; report
     * the degraded state and let the provisional line stand.
     */
    const provisionalStands = (reason: string): InterpretResult => {
      deps.onProvider?.(BROWSER_TRANSLATOR_PROVIDER);
      return {
        output: { safeChunks: [], confidence: "medium" },
        degraded: true,
        reason,
        clientDispatchedAt: firstClientDispatchedAt,
        provider: BROWSER_TRANSLATOR_PROVIDER,
        model: BROWSER_TRANSLATOR_MODEL,
      };
    };

    /**
     * Prefer the already-prepared browser translator over the deterministic
     * fallback. Never wait for a model download here: a live turn has a
     * deadline, and Korean echoed back four seconds late is not translation.
     */
    const localFallback = async (reason: string): Promise<InterpretResult> => {
      // Wait for the fast lane's verdict rather than racing it: it is either
      // about to render this Korean or about to say it cannot.
      if (turn && (await turn.provisionalSettled())) return provisionalStands(reason);
      if (signal.aborted) throw new DOMException("aborted", "AbortError");

      const browserTranslator = deps.browserTranslator();
      if (browserTranslator) {
        const output = await translateWithBrowserTranslator(browserTranslator, request.pending, signal);
        if (output) {
          deps.onProvider?.(BROWSER_TRANSLATOR_PROVIDER);
          return {
            output,
            degraded: true,
            reason: `${reason} Chrome on-device Korean→English backup was used.`,
            clientDispatchedAt: firstClientDispatchedAt,
            provider: BROWSER_TRANSLATOR_PROVIDER,
            model: BROWSER_TRANSLATOR_MODEL,
          };
        }
      }

      // Never strand a browser on the deterministic helper. If the on-device
      // translator is unavailable, cloud remains worth retrying next turn.
      cloudBypassUntil = 0;
      deps.onProvider?.("local");
      return {
        output: deps.local(request),
        degraded: true,
        reason,
        clientDispatchedAt: firstClientDispatchedAt,
        provider: "local",
        model: "deterministic",
      };
    };

    if (deps.browserTranslator() && cloudBypassUntil > now()) {
      return localFallback("Cloud interpretation is cooling down after a quota or rate-limit failure.");
    }

    const clientTelemetry = deps.telemetry.batch();
    const telemetryIds = clientTelemetry.map((sample) => sample.id);
    const wireRequest: InterpretRequest =
      clientTelemetry.length > 0 ? { ...request, clientTelemetry } : request;

    let lastFailure = "Interpretation network request failed.";

    for (let attempt = 0; attempt < INTERPRET_RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(INTERPRET_RETRY_DELAYS_MS[attempt], signal);
      }

      try {
        if (firstClientDispatchedAt === undefined) firstClientDispatchedAt = now();
        const response = await deps.fetchImpl("/api/interpret", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(wireRequest),
        });

        if (response.ok) {
          if (telemetryIds.length > 0) deps.telemetry.acknowledge(telemetryIds);
          const data = (await response.json()) as {
            output: unknown;
            provider?: string;
            model?: string;
            degraded?: boolean;
            reason?: string;
          };
          const parsed = interpreterOutputSchema.safeParse(data.output);
          if (!parsed.success) {
            return localFallback(
              "The interpretation response was malformed — using the local backup path.",
            );
          }

          // The server intentionally returns HTTP 200 even after every cloud
          // model fails, because the transcript must keep running. That means
          // status-code retries alone cannot detect quota exhaustion. Replace
          // its deterministic Korean-only answer with on-device English when
          // Chrome has already prepared the translator.
          if (data.provider === "local") {
            const bypassMs = cloudBypassMsForFailure({ reason: data.reason });
            if (deps.browserTranslator() && bypassMs > 0) {
              cloudBypassUntil = now() + bypassMs;
            }
            return localFallback(data.reason ?? "The cloud interpretation provider was unavailable.");
          }

          cloudBypassUntil = 0;
          deps.onProvider?.(data.provider);
          return {
            output: parsed.data,
            degraded: data.degraded,
            reason: data.reason,
            clientDispatchedAt: firstClientDispatchedAt,
            provider: data.provider,
            model: data.model,
          };
        }

        lastFailure =
          response.status === 429
            ? "The free interpretation provider is temporarily rate limited."
            : `Interpretation request failed (${response.status}).`;

        // Once Chrome's translator is ready, retrying a 429 in 350ms merely
        // buys another 429. Fall back immediately and try cloud after the
        // cooldown instead of adding dead air to this sentence.
        if (response.status === 429 && deps.browserTranslator()) {
          cloudBypassUntil = now() + cloudBypassMsForFailure({ status: response.status });
          return localFallback(`${lastFailure} Using the on-device backup immediately.`);
        }

        if (
          !retryableInterpretStatus(response.status) ||
          attempt === INTERPRET_RETRY_DELAYS_MS.length - 1
        ) {
          return localFallback(`${lastFailure} This turn used the local backup path instead.`);
        }

        // Honour a small Retry-After when present, but never let a server-side
        // abuse window turn into a long blank patch in a live sermon.
        const serverDelay = retryAfterMs(response);
        if (serverDelay && serverDelay <= 1500) {
          await sleep(serverDelay, signal);
        }
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
        lastFailure = err instanceof Error ? err.message : "Interpretation network request failed.";
        if (attempt === INTERPRET_RETRY_DELAYS_MS.length - 1) {
          return localFallback(
            `${lastFailure} The connection did not recover, so this turn used the local backup path.`,
          );
        }
      }
    }

    return localFallback(`${lastFailure} This turn used the local backup path.`);
  };

  return { interpret, bypassUntil: () => cloudBypassUntil };
}
