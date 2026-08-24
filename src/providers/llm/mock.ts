/**
 * Deterministic local interpreter.
 *
 * Two jobs:
 *
 *  1. **Demo mode.** When the pending Korean matches a scripted beat, return
 *     that beat's authored interpretation. This is what makes demo mode a real
 *     exercise of the pipeline rather than an animation — the engine, the
 *     stabiliser and the chunk store all run for real, only the network is
 *     absent.
 *
 *  2. **The no-key path.** With no LLM configured at all, fall back to
 *     rule-based assistance built from the parts that are genuinely
 *     deterministic: Scripture normalisation, glossary matching, cultural and
 *     wordplay detection, and known rhetorical frames. It is not a translator
 *     and does not pretend to be — it marks anything it cannot support as low
 *     confidence and never invents content.
 */
import type { InterpreterOutput } from "@/types";
import type { DemoBeat, DemoScript } from "@/demo/types";
import { DEMO_SCRIPTS } from "@/demo/sermon-script";
import { detectScriptureReferences } from "@/interpreter/scripture/detect";
import { liveGlossary } from "@/interpreter/glossary/matcher";
import { detectCultural } from "@/interpreter/cultural/detect";
import { frameShortcut } from "@/interpreter/engine/rhetoric";
import type { LlmProvider, LlmProviderId, LlmRequest } from "./types";

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

/** Rule-based assistance for Korean that is not in any script. */
export function deterministicOutput(
  pending: string,
  mode: "sermon" | "general",
): InterpreterOutput {
  const scripture = detectScriptureReferences(pending).map(({ index: _index, ...ref }) => ref);
  const glossary = liveGlossary(pending, mode);
  const culturalNotes = detectCultural(pending);
  const frame = frameShortcut(pending);

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
    // rather than emitting invented English.
    safeChunks.push({
      text: "[no interpretation model configured — Korean transcript only]",
      confidence: "low",
      note: "Set LLM_PROVIDER to enable English assistance",
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
  /** Restrict matching to one script; otherwise every script is searched. */
  scriptId?: string;
  allowAnticipation?: boolean;
}

/** The whole local interpreter, usable from the browser or the server. */
export function interpretLocally(input: MockInterpretInput): InterpreterOutput {
  const scripts: DemoScript[] = input.scriptId
    ? [DEMO_SCRIPTS[input.scriptId]].filter(Boolean)
    : Object.values(DEMO_SCRIPTS);

  for (const script of scripts) {
    const beats = matchBeats(input.pending, script.beats);
    if (beats.length > 0) {
      const output = mergeOutputs(beats.map((b) => b.output));
      if (input.allowAnticipation === false) delete output.anticipatedChunks;
      return output;
    }
  }

  return deterministicOutput(input.pending, input.mode);
}

/**
 * `LlmProvider` adapter, so the mock sits behind the same port as the real
 * vendors and the server route needs no special case.
 */
export class MockLlmProvider implements LlmProvider {
  readonly id: LlmProviderId = "mock";

  async complete(request: LlmRequest): Promise<string> {
    const pending = extractPending(request.user);
    const mode = /DOMAIN: KOREAN CHURCH SERMON/.test(request.system) ? "sermon" : "general";
    const allowAnticipation = !/Do not return anticipatedChunks/.test(request.user);
    return JSON.stringify(interpretLocally({ pending, mode, allowAnticipation }));
  }
}

/** Recover the Korean from the assembled user prompt. */
export function extractPending(user: string): string {
  const match = user.match(/KOREAN TO INTERPRET NOW \(stabilised\):\n([\s\S]*?)(?:\n\n|$)/);
  return match ? match[1].trim() : user.trim();
}
