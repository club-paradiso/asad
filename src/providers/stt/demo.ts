/**
 * Demo recogniser.
 *
 * Replays a scripted session as a genuine event stream: growing partials at a
 * speaking rate, then a stable result, then silence. It plugs into the same
 * `SpeechProvider` port as Deepgram or OpenAI, so the engine cannot tell the
 * difference — which is the point. Demo mode is a real end-to-end test, not a
 * mockup.
 */
import type { DemoBeat, DemoScript } from "@/demo/types";
import { BaseSpeechProvider, type SttProviderId } from "./types";

/** Build growing prefixes at word boundaries, the way a recogniser emits. */
export function derivePartials(text: string, steps = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [];
  const out: string[] = [];
  const count = Math.min(steps, words.length - 1);
  for (let i = 1; i <= count; i += 1) {
    const take = Math.max(1, Math.round((words.length * i) / (count + 1)));
    const prefix = words.slice(0, take).join(" ");
    if (prefix && prefix !== out[out.length - 1]) out.push(prefix);
  }
  return out;
}

export interface DemoSpeechOptions {
  script: DemoScript;
  /** Playback rate multiplier; 1 is real time. */
  speed?: number;
  /** Called as each beat begins, so the UI can show what is being demonstrated. */
  onBeat?: (beat: DemoBeat, index: number) => void;
  /** Called once the script runs out. */
  onComplete?: () => void;
  /** Restart from the top instead of stopping. */
  loop?: boolean;
}

export class DemoSpeechProvider extends BaseSpeechProvider {
  readonly id: SttProviderId = "demo";
  readonly needsAudio = false;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private index = 0;

  constructor(private readonly options: DemoSpeechOptions) {
    super();
  }

  async connect(): Promise<void> {
    this.running = true;
    this.index = 0;
    this.emitStatus("connecting");
    // A beat of latency so the console's connecting state is real, not fake.
    this.schedule(() => {
      this.emitStatus("listening");
      this.playBeat(0);
    }, 350);
  }

  sendAudio(): void {
    // The demo recogniser ignores audio by design — no microphone required.
  }

  async disconnect(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emitStatus("closed");
  }

  /** Jump to a beat. Used by the demo transport controls. */
  seek(index: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.playBeat(Math.max(0, Math.min(index, this.options.script.beats.length - 1)));
  }

  private get speed(): number {
    return this.options.speed && this.options.speed > 0 ? this.options.speed : 1;
  }

  private schedule(fn: () => void, ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, Math.max(0, ms / this.speed));
  }

  private playBeat(index: number) {
    if (!this.running) return;
    const { beats } = this.options.script;

    if (index >= beats.length) {
      if (this.options.loop) {
        this.playBeat(0);
        return;
      }
      this.options.onComplete?.();
      this.emitStatus("closed", "demo script complete");
      return;
    }

    this.index = index;
    const beat = beats[index];
    this.options.onBeat?.(beat, index);

    const partials = beat.partials ?? derivePartials(beat.korean);
    const pace = beat.paceMs ?? 300;

    const step = (i: number) => {
      if (!this.running) return;
      if (i < partials.length) {
        this.emitPartial(partials[i]);
        this.schedule(() => step(i + 1), pace);
        return;
      }
      this.emitStable(beat.korean);
      this.schedule(() => this.playBeat(index + 1), beat.holdMs ?? 800);
    };

    step(0);
  }

  get currentIndex(): number {
    return this.index;
  }
}
