/**
 * Browser-native speech recognition.
 *
 * No key, no server, no audio leaves the browser API boundary. This is the
 * zero-configuration live path and the graceful fallback when a cloud provider
 * is unreachable.
 */
import { languageDisplayName } from "@/languages/registry";
import {
  BaseSpeechProvider,
  type StableTranscriptMeta,
  type SttProviderId,
  type SttProviderOptions,
} from "./types";
import { webSpeechLanguage } from "./language";
import { speechFailureMessage } from "./failure";
import { joinBrowserResultParts, pickSpeechAlternative } from "./transcript";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const BENIGN_ERRORS = new Set(["no-speech", "aborted"]);
const PERMANENT_ERRORS = new Set(["not-allowed", "language-not-supported", "language-unavailable"]);
const RECOVERY_ATTEMPTS = 4;
const RECOVERY_BACKOFF_MS = [400, 1200, 3000, 6000];
/**
 * Safari/WebKit can keep returning useful interim text without ever flipping
 * SpeechRecognitionResult.isFinal. If the text has stopped changing for this
 * long, treat the current hypothesis as stable enough for live interpretation.
 * A later final result is de-duplicated by result index.
 */
const INTERIM_STABLE_AFTER_MS = 1100;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface RankedAlternative {
  transcript: string;
  /** Browser confidence, or undefined when the browser did not report a finite one. */
  confidence: number | undefined;
}

/** A result's alternatives, best first: by confidence, then by browser order. */
function rankAlternatives(result: SpeechRecognitionResultLike): RankedAlternative[] {
  const alternatives: Array<RankedAlternative & { index: number }> = [];
  for (let i = 0; i < result.length; i += 1) {
    const alternative = result[i];
    if (!alternative?.transcript) continue;
    alternatives.push({
      transcript: alternative.transcript,
      confidence:
        typeof alternative.confidence === "number" && Number.isFinite(alternative.confidence)
          ? alternative.confidence
          : undefined,
      index: i,
    });
  }
  alternatives.sort((a, b) => {
    const confidenceOrder = (b.confidence ?? -1) - (a.confidence ?? -1);
    return confidenceOrder !== 0 ? confidenceOrder : a.index - b.index;
  });
  return alternatives.map(({ transcript, confidence }) => ({ transcript, confidence }));
}

/** The hypothesis chosen for a result, with what the browser said about it. */
interface ChosenHypothesis {
  text: string;
  meta: StableTranscriptMeta | undefined;
}

function chooseHypothesis(
  result: SpeechRecognitionResultLike,
  language: string | undefined,
): ChosenHypothesis | null {
  const ranked = rankAlternatives(result);
  const text = pickSpeechAlternative(
    ranked.map((alternative) => alternative.transcript),
    language,
  );
  if (!text) return null;
  const chosen = ranked.find((alternative) => alternative.transcript.trim() === text);
  const others = ranked
    .filter((alternative) => alternative !== chosen)
    .map((alternative) => alternative.transcript.trim())
    .filter((candidate) => candidate && candidate !== text);
  const meta: StableTranscriptMeta = {};
  if (chosen?.confidence !== undefined) meta.confidence = chosen.confidence;
  if (others.length) meta.alternatives = [...new Set(others)];
  return { text, meta: Object.keys(meta).length ? meta : undefined };
}

function stableDelta(previous: string | undefined, next: string): string {
  const before = previous?.trim() ?? "";
  const after = next.trim();
  if (!after || after === before) return "";
  if (!before) return after;
  if (after.startsWith(before)) return after.slice(before.length).trim();

  // The recogniser revised wording it had already handed over. WebKit does this
  // routinely: a hypothesis promoted by the interim timer above is finalised a
  // second later with a different ending. Returning the whole sentence here
  // re-sent text the engine had already turned into English, so the same
  // thought was interpreted and rendered twice.
  //
  // What was emitted cannot be unsaid, so emit only what is genuinely new —
  // everything past the longest common prefix, backed up to a word boundary so
  // a word is never cut in half.
  let shared = 0;
  while (shared < before.length && shared < after.length && before[shared] === after[shared]) {
    shared += 1;
  }
  if (shared === 0) return after;
  const boundary = after.lastIndexOf(" ", shared);
  return after.slice(boundary > 0 ? boundary : shared).trim();
}

export class WebSpeechProvider extends BaseSpeechProvider {
  readonly id: SttProviderId = "webspeech";
  readonly needsAudio = false;

  private recognition: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private interimCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryUsed = 0;

  constructor(private readonly options: SttProviderOptions = {}) {
    super();
  }

  static isSupported(): boolean {
    return getConstructor() !== null;
  }

  async connect(): Promise<void> {
    const Ctor = getConstructor();
    if (!Ctor) throw new Error("This browser has no built-in speech recognition.");

    // The registry decides which tag the browser gets, and whether it gets one
    // at all. A language with no browser tag (Uyghur) must not be sent as its
    // nearest neighbour: the recogniser would return confident text in the
    // wrong language, which is worse than an honest refusal here.
    const lang = webSpeechLanguage(this.options.language);
    if (!lang) {
      throw new Error(
        `Browser speech recognition cannot transcribe ${languageDisplayName(this.options.language ?? "")}.`,
      );
    }

    this.wantRunning = true;
    this.recoveryUsed = 0;
    this.emitStatus("connecting");

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    this.recognition = recognition;

    await new Promise<void>((resolve, reject) => {
      let connected = false;
      let settled = false;
      let hasResult = false;
      const interimByIndex = new Map<number, ChosenHypothesis>();
      const committedByIndex = new Map<number, string>();

      const clearInterimCommit = () => {
        if (this.interimCommitTimer) clearTimeout(this.interimCommitTimer);
        this.interimCommitTimer = null;
      };

      const commit = (index: number, hypothesis: ChosenHypothesis) => {
        const delta = stableDelta(committedByIndex.get(index), hypothesis.text);
        if (delta) this.emitStable(delta, hypothesis.meta);
        committedByIndex.set(index, hypothesis.text.trim());
      };

      const commitInterim = () => {
        clearInterimCommit();
        for (const [index, hypothesis] of [...interimByIndex.entries()].sort((a, b) => a[0] - b[0])) {
          commit(index, hypothesis);
        }
      };

      const scheduleInterimCommit = () => {
        clearInterimCommit();
        if (interimByIndex.size === 0) return;
        this.interimCommitTimer = setTimeout(commitInterim, INTERIM_STABLE_AFTER_MS);
      };

      recognition.onstart = () => {
        connected = true;
        this.recoveryUsed = 0;
        interimByIndex.clear();
        committedByIndex.clear();
        clearInterimCommit();
        this.emitStatus("listening");
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      recognition.onresult = (event) => {
        const interim: string[] = [];
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          // `resultIndex` is the lowest index that changed in this event, so a
          // FINAL result below it was settled earlier and has already been
          // emitted — the old code computed it anyway and then discarded it.
          //
          // The list only ever grows within a recognition session, so that made
          // the per-event cost proportional to how long the service had been
          // running: ranking + `pickSpeechAlternative` score every alternative
          // character by character, on the same thread that renders the
          // English the interpreter is reading. Forty minutes in, every
          // recogniser event re-ranked forty minutes of settled transcript.
          if (result.isFinal && i < event.resultIndex) continue;
          const hypothesis = chooseHypothesis(result, this.options.language);
          if (!hypothesis) continue;
          hasResult = true;
          if (result.isFinal) {
            interimByIndex.delete(i);
            commit(i, hypothesis);
          } else {
            interimByIndex.set(i, hypothesis);
            interim.push(hypothesis.text);
          }
        }
        const partial = joinBrowserResultParts(interim, this.options.language);
        if (partial) this.emitPartial(partial);
        scheduleInterimCommit();
      };

      recognition.onerror = (event) => {
        const code = event.error ?? "unknown";
        if (BENIGN_ERRORS.has(code)) return;

        // Anything not known to be permanent is worth retrying.
        //
        // This used to be an allow-list of three codes, and a code outside it
        // fell through every branch below: no error was raised, no restart was
        // scheduled, and the status stayed on "reconnecting" — so an unfamiliar
        // failure left the console claiming it was coming back while nothing
        // was listening and nothing was going to try. Browsers do not agree on
        // this vocabulary and it grows; an unknown code is a reason to retry,
        // not a reason to do nothing.
        const recoverable = !PERMANENT_ERRORS.has(code);
        const budgetLeft = recoverable && this.recoveryUsed < RECOVERY_ATTEMPTS;
        const fatal = PERMANENT_ERRORS.has(code) || (recoverable && !budgetLeft);
        // The message goes straight to the console's error bar, so it is
        // written for the interpreter rather than for the log. The raw code
        // travels alongside it, for /diagnostics and nothing else.
        const error: Error & { code?: string } = new Error(
          speechFailureMessage(code, fatal && recoverable),
        );
        error.code = code;

        if (fatal) this.wantRunning = false;
        if (!fatal) this.recoveryUsed += 1;
        else this.emitError(error);

        this.emitStatus(fatal ? "error" : "reconnecting", code);
        if (!fatal && recoverable) {
          this.scheduleRestart(recognition, RECOVERY_BACKOFF_MS[this.recoveryUsed - 1] ?? 6000);
        }
        if (fatal && !connected && !settled) {
          settled = true;
          this.wantRunning = false;
          reject(error);
        }
      };

      recognition.onend = () => {
        // WebKit sometimes never marks its last hypothesis final. Preserve the
        // words we actually heard before cycling the recogniser, otherwise the
        // engine sees only partial text and never dispatches /api/interpret.
        commitInterim();
        if (!this.wantRunning) {
          this.emitStatus("closed");
          return;
        }
        if (this.options.utterance && !hasResult) {
          this.wantRunning = false;
          this.emitStatus("closed");
          return;
        }
        this.emitStatus("reconnecting");
        this.scheduleRestart(recognition, this.options.utterance ? 180 : 350);
      };

      try {
        recognition.start();
      } catch (error) {
        this.wantRunning = false;
        settled = true;
        reject(error);
      }
    });
  }

  private scheduleRestart(recognition: SpeechRecognitionLike, delayMs: number): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (!this.wantRunning || this.recognition !== recognition) return;
      try {
        recognition.start();
      } catch {
        // Already starting; the pending start event remains authoritative.
      }
    }, delayMs);
  }

  sendAudio(): void {}

  async disconnect(): Promise<void> {
    this.wantRunning = false;
    this.recoveryUsed = 0;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.interimCommitTimer) clearTimeout(this.interimCommitTimer);
    this.restartTimer = null;
    this.interimCommitTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition?.stop();
    } catch {
      recognition?.abort();
    }
    this.emitStatus("closed");
  }
}
