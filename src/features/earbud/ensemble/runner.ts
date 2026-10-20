import {
  checkCandidate, chooseTranslation, type EnsembleProvider,
  type TranslationCandidate,
} from "./decision";

export interface EnsembleInput { text: string; source: string }
export type Translator = (input: EnsembleInput, signal: AbortSignal) => Promise<string>;
export type Judge = (
  input: EnsembleInput, candidates: readonly TranslationCandidate[], signal: AbortSignal,
) => Promise<EnsembleProvider | "abstain">;
export type EnsembleResult = {
  text: string | null;
  selected?: EnsembleProvider;
  confidence: "medium" | "low";
  adjudication: "agreement" | "judge" | "abstain";
  reason: string;
  timings: Partial<Record<EnsembleProvider, number>>;
};
export interface EnsembleDeps {
  index: Translator;
  azure: Translator;
  judge?: Judge;
  candidateTimeoutMs?: number;
  judgeTimeoutMs?: number;
  now?: () => number;
}
/**
 * A real timebox even if a buggy vendor ignores AbortSignal. Merely aborting
 * a controller and awaiting its promise can hang the *entire* ensemble.
 */
async function within<T>(
  run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outer: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectOnAbort: ((reason: Error) => void) | undefined;
  const timed = new Promise<never>((_, reject) => {
    rejectOnAbort = reject;
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Provider deadline exceeded."));
    }, timeoutMs);
  });
  const onAbort = () => {
    controller.abort();
    rejectOnAbort?.(new DOMException("aborted", "AbortError"));
  };
  if (outer.aborted) onAbort();
  else outer.addEventListener("abort", onAbort, { once: true });
  try {
    if (outer.aborted) throw new DOMException("aborted", "AbortError");
    return await Promise.race([run(controller.signal), timed]);
  } finally {
    if (timeout) clearTimeout(timeout);
    outer.removeEventListener("abort", onAbort);
  }
}

export async function runEnsemble(
  input: EnsembleInput, outer: AbortSignal, deps: EnsembleDeps,
): Promise<EnsembleResult> {
  const now = deps.now ?? (() => Date.now());
  const timing: Partial<Record<EnsembleProvider, number>> = {};
  const timed = async (provider: EnsembleProvider, fn: Translator): Promise<TranslationCandidate> => {
    const start = now();
    const text = await within(signal => fn(input, signal), deps.candidateTimeoutMs ?? 2600, outer);
    timing[provider] = Math.max(0, now() - start);
    return { provider, text, latencyMs: timing[provider] };
  };
  // No sequential wait for a primary translator. Both receive identical STT
  // text once. No text, candidates or provider errors are logged.
  const settled = await Promise.allSettled([
    timed("index", deps.index),
    timed("azure", deps.azure),
  ]);
  if (outer.aborted) throw new DOMException("aborted", "AbortError");
  const candidates = settled.flatMap((part) => part.status === "fulfilled" ? [part.value] : []);
  const selected = chooseTranslation(input.text, candidates);
  if (selected.kind === "accepted") {
    return {
      text: selected.candidate.text, selected: selected.candidate.provider,
      confidence: "medium", adjudication: "agreement",
      reason: selected.reason, timings: timing,
    };
  }
  if (selected.kind === "needs-judge" && deps.judge) {
    try {
      const choice = await within(
        (signal) => deps.judge!(input, selected.candidates, signal),
        deps.judgeTimeoutMs ?? 1300, outer,
      );
      if (outer.aborted) throw new DOMException("aborted", "AbortError");
      const picked = selected.candidates.find(c => c.provider === choice);
      if (picked && checkCandidate(input.text, picked.text).ok) {
        return {
          text: picked.text, selected: picked.provider,
          confidence: "medium", adjudication: "judge",
          reason: "third model selected an existing candidate; no synthesis", timings: timing,
        };
      }
    } catch {
      if (outer.aborted) throw new DOMException("aborted", "AbortError");
    }
  }
  return {
    text: null, confidence: "low", adjudication: "abstain",
    reason: selected.reason + (selected.kind === "needs-judge" ? "; no verified arbiter selection" : ""),
    timings: timing,
  };
}
