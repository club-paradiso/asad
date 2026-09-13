/**
 * Deterministic local interpreter.
 *
 * Two jobs:
 *
 *  1. **Demo mode.** When the caller names a script and the pending Korean
 *     matches one of its beats, return that beat's authored interpretation.
 *     This is what makes demo mode a real exercise of the pipeline rather than
 *     an animation — the engine, the stabiliser and the chunk store all run for
 *     real, only the network is absent. Authored English is reachable ONLY
 *     through an explicit `scriptId`; a live session must never be shown it.
 *
 *  2. **The no-key path.** With no LLM configured at all, fall back to
 *     rule-based assistance built from the parts that are genuinely
 *     deterministic: Scripture normalisation, glossary matching, cultural and
 *     wordplay detection, and known rhetorical frames. It is not a translator
 *     and does not pretend to be — it marks anything it cannot support as low
 *     confidence and never invents content.
 */
import type { InterpreterOutput, LanguagePair } from "@/types";
import type { DemoBeat, DemoScript } from "@/demo/types";
import { DEMO_SCRIPTS } from "@/demo/sermon-script";
import {
  canonicalPair,
  DEFAULT_LANGUAGE_PAIR,
  LANGUAGES,
  languageBase,
  languageDisplayName,
  type LanguagePairIds,
} from "@/languages/registry";
import { detectScriptureReferences } from "@/interpreter/scripture/detect";
import { liveGlossary } from "@/interpreter/glossary/matcher";
import { detectCultural } from "@/interpreter/cultural/detect";
import { frameShortcut } from "@/interpreter/engine/rhetoric";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

const normalise = (text: string) => text.replace(/[\s.,!?…·"'"'']+/g, "");

/**
 * Find every scripted beat covered by a piece of pending Korean.
 *
 * The stabiliser may batch two beats into one call, so this matches all of
 * them and merges their outputs in order.
 */
export function matchBeats(pending: string, beats: DemoBeat[]): DemoBeat[] {
  const target = normalise(pending);
  if (!target) return [];
  return beats.filter((beat) => {
    const beatText = normalise(beat.korean);
    if (!beatText) return false;
    if (target.includes(beatText)) return true;
    // A partial flush mid-beat still deserves that beat's interpretation.
    return beatText.includes(target) && target.length >= Math.min(12, beatText.length * 0.6);
  });
}

export function mergeOutputs(outputs: InterpreterOutput[]): InterpreterOutput {
  const merged: InterpreterOutput = { safeChunks: [], confidence: "high" };
  const rank = { high: 0, medium: 1, low: 2 } as const;

  for (const output of outputs) {
    merged.safeChunks.push(...output.safeChunks);
    if (output.anticipatedChunks?.length) {
      // Only the last beat's prediction is still in play.
      merged.anticipatedChunks = output.anticipatedChunks;
    }
    if (output.bibleReferences?.length) {
      merged.bibleReferences = [...(merged.bibleReferences ?? []), ...output.bibleReferences];
    }
    if (output.glossary?.length) {
      merged.glossary = [...(merged.glossary ?? []), ...output.glossary];
    }
    if (output.culturalNotes?.length) {
      merged.culturalNotes = [...(merged.culturalNotes ?? []), ...output.culturalNotes];
    }
    if (output.entities?.length) {
      merged.entities = [...(merged.entities ?? []), ...output.entities];
    }
    if (output.topic) merged.topic = output.topic;
    if (rank[output.confidence] > rank[merged.confidence]) merged.confidence = output.confidence;
  }

  return merged;
}

/**
 * Rule-based assistance for source text that is not in any script.
 *
 * Every detector here — Scripture normalisation, the glossary, cultural and
 * wordplay detection, rhetorical frames — was written for Korean. For any
 * other source they are not run, and the honest placeholder names the
 * language so nobody mistakes a Mandarin transcript for missing English.
 */
export function deterministicOutput(
  pending: string,
  mode: "sermon" | "general",
  pair: Partial<LanguagePairIds> | undefined = DEFAULT_LANGUAGE_PAIR,
): InterpreterOutput {
  const canonical = canonicalPair(pair);
  const sourceName = languageDisplayName(canonical.source);
  const targetName = languageDisplayName(canonical.target);
  const korean = languageBase(canonical.source) === "ko";

  const scripture = korean
    ? detectScriptureReferences(pending).map(({ index: _index, ...ref }) => ref)
    : [];
  const glossary = korean ? liveGlossary(pending, mode) : [];
  const culturalNotes = korean ? detectCultural(pending) : [];
  const frame = korean ? frameShortcut(pending) : null;

  const safeChunks: InterpreterOutput["safeChunks"] = [];

  if (frame) {
    safeChunks.push({ text: `${frame}...`, confidence: "high" });
  }

  for (const ref of scripture) {
    safeChunks.push({ text: `${ref.display}.`, confidence: ref.confidence });
  }

  for (const note of culturalNotes) {
    if (note.suggestion) {
      safeChunks.push({
        text: note.suggestion,
        confidence: "medium",
        adapted: true,
        note: note.note,
      });
    }
  }

  if (safeChunks.length === 0) {
    // Nothing here can be rendered honestly without a translation model. Say so
    // rather than emitting invented target-language text.
    safeChunks.push({
      text: `[no interpretation model configured — ${sourceName} transcript only]`,
      confidence: "low",
      note: `Set LLM_PROVIDER to enable ${targetName} assistance`,
    });
  }

  return {
    safeChunks,
    bibleReferences: scripture.length ? scripture : undefined,
    glossary: glossary.length ? glossary : undefined,
    culturalNotes: culturalNotes.length ? culturalNotes : undefined,
    confidence: frame || scripture.length ? "medium" : "low",
  };
}

export interface MockInterpretInput {
  pending: string;
  mode: "sermon" | "general";
  /**
   * The demo script to match against. Omitting it disables scripted beats
   * entirely — that is what every live caller does, and it is load-bearing.
   */
  scriptId?: string;
  allowAnticipation?: boolean;
  /** Session languages. Defaults to Korean → English, the pair the detectors were written for. */
  pair?: LanguagePair | Partial<LanguagePairIds>;
}

/** The whole local interpreter, usable from the browser or the server. */
export function interpretLocally(input: MockInterpretInput): InterpreterOutput {
  // Scripted beats belong to demo mode and nowhere else. Searching every
  // script whenever no `scriptId` was supplied made the demo sermon the answer
  // of first resort on the two paths that never pass one: the browser's
  // provider-failure fallback and the server's no-key floor. A real preacher
  // reaching "우리가 오늘 함께 살펴볼 말씀은" was then told, on stage, that the
  // passage was 1 Peter 2:9 — a Scripture reference nobody had spoken. An
  // unmatched script is now simply no script.
  const scripts: DemoScript[] = input.scriptId
    ? [DEMO_SCRIPTS[input.scriptId]].filter(Boolean)
    : [];

  for (const script of scripts) {
    const beats = matchBeats(input.pending, script.beats);
    if (beats.length > 0) {
      const output = mergeOutputs(beats.map((b) => b.output));
      if (input.allowAnticipation === false) delete output.anticipatedChunks;
      return output;
    }
  }

  return deterministicOutput(input.pending, input.mode, input.pair);
}

/**
 * `LlmProvider` adapter, so the local interpreter sits behind the same port as
 * the real vendors and the router needs no special case for it.
 *
 * This is the floor the whole system falls back to: it always answers, it never
 * costs anything, and it never sends a byte anywhere.
 */
export class LocalLlmProvider implements LlmProvider {
  readonly id = "local" as const;
  readonly model = "deterministic";

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const pending = extractPending(request.user);
    const mode = /^DOMAIN: .*SERMON/m.test(request.system) ? "sermon" : "general";
    const allowAnticipation = !/Do not return anticipatedChunks/.test(request.user);
    const pair = extractPair(request.system);
    return {
      text: JSON.stringify(interpretLocally({ pending, mode, allowAnticipation, pair })),
      model: "deterministic",
      latencyMs: Date.now() - started,
    };
  }
}

/** Phase 1 name, kept so existing imports and tests keep working. */
export { LocalLlmProvider as MockLlmProvider };

/** Recover the pending source text from the assembled user prompt, whatever the language heading. */
export function extractPending(user: string): string {
  const match = user.match(/^[^\n]+ TO INTERPRET NOW \(stabilised\):\n([\s\S]*?)(?:\n\n|$)/m);
  return match ? match[1].trim() : user.trim();
}

const ID_BY_DISPLAY_NAME = new Map(LANGUAGES.map((language) => [language.name.en, language.id]));

/**
 * Recover the language pair from the system prompt's first line. Both the full
 * ("working Korean into English") and the compact ("working Korean → English")
 * contracts name it there; anything else is the default pair.
 */
export function extractPair(system: string): LanguagePairIds {
  const match = system.match(/interpreter working (.+?) (?:into|→) (.+?)\./);
  if (!match) return DEFAULT_LANGUAGE_PAIR;
  const source = ID_BY_DISPLAY_NAME.get(match[1]);
  const target = ID_BY_DISPLAY_NAME.get(match[2]);
  return source && target ? { source, target } : DEFAULT_LANGUAGE_PAIR;
}
