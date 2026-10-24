/**
 * Input health: is the audio the recogniser receives actually audio?
 *
 * The capture path already knows the level of every frame it sends. This
 * module turns that stream of numbers into the two things an interpreter can
 * act on mid-service — "nothing is reaching this input" and "this input is
 * distorting" — and nothing else. It never holds audio and never sees text.
 *
 * Deliberately outside React and clock-injected, like the engine: the rules
 * are worth testing without a browser, and the thresholds are product
 * decisions rather than DSP.
 */
import { classifyInputLevel, type InputLevelState } from "./audio-level";

export type InputHealthState =
  /** No frames yet, or a source whose level ASAD cannot observe. */
  | "unknown"
  | "ok"
  /** Silent for longer than a speaker's longest ordinary pause. */
  | "silent"
  /** Enough clipped frames in the last few seconds to distort recognition. */
  | "clipping";

export type InputHealthSource =
  /** Nothing is capturing. */
  | "none"
  /** ASAD opened the device itself and measures every frame. */
  | "raw"
  /** The browser's own recogniser owns the microphone; levels are not visible. */
  | "browser-managed";

export interface InputHealth {
  source: InputHealthSource;
  state: InputHealthState;
  level: InputLevelState;
  /** How long since the input last carried an audible frame. */
  silentForMs: number;
  /** Clipped frames inside the clipping window. */
  clippedFramesRecently: number;
}

/**
 * How long an input may be silent before the console says so.
 *
 * A preacher pauses; a congregation prays in silence; a reading ends. Twelve
 * seconds is longer than any of those in ordinary worship and far shorter than
 * the time it takes to notice that the English stopped because the Korean did.
 */
export const SILENCE_WARNING_MS = 12_000;
/** Clipped frames are counted over this trailing window. */
export const CLIP_WINDOW_MS = 3_000;
/** Clipped frames inside the window before the input is called clipping. */
export const CLIP_FRAMES_FOR_WARNING = 5;
/** Peak at or above this, out of 1, counts as a clipped frame. */
export const CLIP_PEAK = 0.985;

export const NO_INPUT_HEALTH: InputHealth = {
  source: "none",
  state: "unknown",
  level: "silent",
  silentForMs: 0,
  clippedFramesRecently: 0,
};

export const BROWSER_MANAGED_INPUT_HEALTH: InputHealth = {
  ...NO_INPUT_HEALTH,
  source: "browser-managed",
};

export interface FrameObservation {
  rms: number;
  peak: number;
  /** Clock of the frame; defaults to the monitor's clock. */
  at?: number;
}

export class InputHealthMonitor {
  private startedAt: number | null = null;
  private lastAudibleAt: number | null = null;
  private level: InputLevelState = "silent";
  private clipTimes: number[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Begin a capture. Previous observations are forgotten. */
  start(at: number = this.now()): void {
    this.startedAt = at;
    this.lastAudibleAt = null;
    this.level = "silent";
    this.clipTimes = [];
  }

  /** Capture ended. The next snapshot reports no input. */
  reset(): void {
    this.startedAt = null;
    this.lastAudibleAt = null;
    this.level = "silent";
    this.clipTimes = [];
  }

  observe(frame: FrameObservation): void {
    const at = frame.at ?? this.now();
    if (this.startedAt === null) this.startedAt = at;
    const reading = classifyInputLevel(frame.rms);
    this.level = reading.state;
    if (reading.state !== "silent") this.lastAudibleAt = at;
    if (frame.peak >= CLIP_PEAK) this.clipTimes.push(at);
    const horizon = at - CLIP_WINDOW_MS;
    if (this.clipTimes.length && this.clipTimes[0] < horizon) {
      this.clipTimes = this.clipTimes.filter((time) => time >= horizon);
    }
  }

  snapshot(at: number = this.now()): InputHealth {
    if (this.startedAt === null) return NO_INPUT_HEALTH;
    const since = this.lastAudibleAt ?? this.startedAt;
    const silentForMs = Math.max(0, at - since);
    const horizon = at - CLIP_WINDOW_MS;
    const clippedFramesRecently = this.clipTimes.filter((time) => time >= horizon).length;
    const state: InputHealthState =
      clippedFramesRecently >= CLIP_FRAMES_FOR_WARNING
        ? "clipping"
        : silentForMs >= SILENCE_WARNING_MS
          ? "silent"
          : "ok";
    return { source: "raw", state, level: this.level, silentForMs, clippedFramesRecently };
  }
}

/**
 * Whether two readings would render identically. `silentForMs` and the clip
 * count change on every frame; the console only re-renders when the state or
 * the coarse level does.
 */
export function sameInputHealth(a: InputHealth, b: InputHealth): boolean {
  return a.source === b.source && a.state === b.state && a.level === b.level;
}
