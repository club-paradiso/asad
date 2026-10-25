/**
 * Microphone capture → 16 kHz mono PCM16.
 *
 * Streaming recognisers want small, frequent frames of linear PCM. This
 * resamples whatever the device gives us (48 kHz on most hardware) and emits
 * ~50 ms frames.
 *
 * Deliberately not uploading files: a 45-minute service is ~80 MB of WAV, and
 * batch upload cannot produce partials at all.
 *
 * The architecture takes a `MediaStream`, not a device id, so a church mixer
 * over USB audio or a WebRTC feed drops in later without touching this file.
 */
export const TARGET_SAMPLE_RATE = 16000;

/** PCM16 bytes in a short Counter utterance. Kept in memory only. */
export const MAX_COUNTER_UTTERANCE_BYTES = TARGET_SAMPLE_RATE * 2 * 24;

/** ~50 ms of 16 kHz mono audio. */
const FRAME_SAMPLES = 800;

const WORKLET_SOURCE = `
class TongYuckCapture extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('tong-yuck-capture', TongYuckCapture);
`;

/** Level of one emitted 16 kHz frame. Numbers only — never audio. */
export interface FrameLevel {
  /** Root mean square of the frame, 0..1. */
  rms: number;
  /** Largest absolute sample in the frame, 0..1 (≥ ~0.985 is clipping). */
  peak: number;
  /** Browser clock when the frame was emitted. */
  at: number;
}

export interface MicrophoneCaptureOptions {
  onFrame: (pcm16: ArrayBuffer) => void;
  onError?: (error: Error) => void;
  /** Called when a live audio track ends unexpectedly after capture starts. */
  onEnded?: () => void;
  /**
   * Called once per emitted frame (~20×/s) with that frame's level. Cheap —
   * computed from samples the capture already holds — and it is what lets the
   * console say "no signal" or "clipping" about the input it is actually
   * sending to the recogniser, rather than about a second, separate stream.
   */
  onLevel?: (level: FrameLevel) => void;
  /** Supply an existing stream (mixer, WebRTC) instead of opening a mic. */
  stream?: MediaStream;
  deviceId?: string;
  /**
   * Ask the browser for its noise suppressor. Off by default: a mixer feed is
   * already clean, and suppression tuned for a laptop in a café removes the
   * quiet consonants Korean recognition depends on.
   */
  noiseSuppression?: boolean;
}

/** What the capture can say about the track it opened. Labels, never audio. */
export interface CaptureTrackInfo {
  label: string;
  deviceId?: string;
  sampleRate?: number;
  channelCount?: number;
}

/**
 * Constraints for a raw-audio STT capture.
 *
 * An operator-selected booth input is a requirement, not a preference. Using a
 * bare `deviceId` string is only an "ideal" constraint and allows the browser
 * to silently choose another microphone. `exact` makes a missing/disconnected
 * mixer fail visibly instead of accidentally listening to the laptop mic.
 */
export function captureAudioConstraints(
  deviceId?: string,
  options: { noiseSuppression?: boolean } = {},
): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: options.noiseSuppression === true,
    autoGainControl: true,
  };
}

/**
 * Observe a capture stream for an unexpected track end.
 *
 * Returns an idempotent cleanup function. Cleanup is intentionally called
 * before ASAD stops tracks itself, so a normal session teardown cannot be
 * mistaken for a mixer disconnect.
 */
export function observeAudioInputEnd(stream: MediaStream, onEnded: () => void): () => void {
  const tracks = stream.getAudioTracks();
  let active = true;
  let reported = false;

  const handleEnded = () => {
    if (!active || reported) return;
    reported = true;
    onEnded();
  };

  for (const track of tracks) track.addEventListener("ended", handleEnded);

  return () => {
    if (!active) return;
    active = false;
    for (const track of tracks) track.removeEventListener("ended", handleEnded);
  };
}

export class MicrophoneCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffer: number[] = [];
  private workletUrl: string | null = null;
  private detachEndObserver: (() => void) | null = null;
  private resampler: Resampler | null = null;

  constructor(private readonly options: MicrophoneCaptureOptions) {}

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      (typeof AudioContext !== "undefined" ||
        typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !==
          "undefined")
    );
  }

  async start(): Promise<void> {
    if (this.context) return;

    this.stream =
      this.options.stream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: captureAudioConstraints(this.options.deviceId, {
          noiseSuppression: this.options.noiseSuppression,
        }),
      }));
    this.ownsStream = !this.options.stream;

    if (this.stream.getAudioTracks().length === 0) {
      throw new Error("The selected audio input has no live audio track.");
    }

    this.detachEndObserver = observeAudioInputEnd(this.stream, () => this.options.onEnded?.());

    const Ctor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctor();
    // iOS suspends new contexts until a user gesture resumes them.
    if (this.context.state === "suspended") await this.context.resume();
    this.resampler = new Resampler(this.context.sampleRate, TARGET_SAMPLE_RATE);

    const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
    this.workletUrl = URL.createObjectURL(blob);
    await this.context.audioWorklet.addModule(this.workletUrl);

    this.node = new AudioWorkletNode(this.context, "tong-yuck-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      try {
        this.ingest(event.data);
      } catch (error) {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
  }

  /** The track being captured, for the console to name. Null before start. */
  trackInfo(): CaptureTrackInfo | null {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return null;
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    return {
      label: track.label,
      deviceId: settings.deviceId,
      sampleRate: settings.sampleRate,
      channelCount: settings.channelCount,
    };
  }

  private ingest(samples: Float32Array) {
    if (!this.context || !this.resampler) return;
    const resampled = this.resampler.process(samples);
    for (let i = 0; i < resampled.length; i += 1) this.buffer.push(resampled[i]);

    while (this.buffer.length >= FRAME_SAMPLES) {
      const frame = this.buffer.splice(0, FRAME_SAMPLES);
      if (this.options.onLevel) this.options.onLevel(frameLevel(frame, Date.now()));
      this.options.onFrame(floatToPcm16(frame));
    }
  }

  async stop(): Promise<void> {
    // Remove `ended` listeners before stopping owned tracks. Otherwise a normal
    // user-initiated End session could look exactly like a hardware failure.
    this.detachEndObserver?.();
    this.detachEndObserver = null;
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    if (this.ownsStream) this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed") await this.context.close();
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.workletUrl = null;
    this.resampler = null;
    this.buffer = [];
  }
}

/** RMS and peak of one frame. */
export function frameLevel(frame: ArrayLike<number>, at: number): FrameLevel {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const sample = frame[i];
    sum += sample * sample;
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > peak) peak = magnitude;
  }
  return { rms: frame.length ? Math.sqrt(sum / frame.length) : 0, peak, at };
}

/**
 * Number of taps in the anti-alias filter. Odd, so the filter has an integer
 * group delay (23 samples ≈ 0.5 ms at 48 kHz). At this length a Hamming-
 * windowed sinc reaches its ~53 dB stopband about 3.4 kHz above the cutoff,
 * which puts everything that would fold into the speech band below the
 * recogniser's noise floor. Each 128-sample render quantum costs ~6k
 * multiply-adds, which is nothing next to the recogniser.
 */
const RESAMPLER_TAPS = 47;

/** Hamming-windowed sinc low-pass. `cutoff` is in cycles per input sample. */
export function designLowPass(cutoff: number, taps: number): Float32Array {
  const h = new Float32Array(taps);
  const middle = (taps - 1) / 2;
  let sum = 0;
  for (let j = 0; j < taps; j += 1) {
    const n = j - middle;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * j) / (taps - 1));
    h[j] = sinc * window;
    sum += h[j];
  }
  for (let j = 0; j < taps; j += 1) h[j] /= sum;
  return h;
}

/**
 * Stateful decimating resampler: anti-alias filter, then linear interpolation
 * at a fractional read position that is CARRIED ACROSS CALLS.
 *
 * The previous resampler was stateless and did neither, and both omissions
 * were audible to a recogniser if not to a person:
 *
 *  - Each AudioWorklet quantum is 128 samples. At 48 kHz → 16 kHz that is
 *    42.67 output samples, and a per-call `floor` emitted 42. The stream
 *    labelled 16,000 Hz actually carried 15,750 samples per second, so every
 *    vowel reached the recogniser 1.6% shorter and 1.6% higher in pitch. At
 *    44.1 kHz the error was 0.95%.
 *  - Nothing removed content above 8 kHz before decimating, so a 12 kHz
 *    component arrived at the recogniser as a 4 kHz one at full level.
 *
 * Neither is a catastrophe for speech, which is why it went unnoticed; both
 * are free to fix, and a booth feed from a mixer carries more high-frequency
 * content than a laptop microphone does.
 */
export class Resampler {
  private readonly ratio: number;
  private readonly taps: Float32Array | null;
  /** The most recent `taps` input samples, oldest first. */
  private readonly history: Float32Array;
  /** Next output read position, in input samples relative to the next block. */
  private phase = 0;
  private work = new Float32Array(0);
  private filtered = new Float32Array(0);

  constructor(
    readonly fromRate: number,
    readonly toRate: number,
  ) {
    this.ratio = fromRate / toRate;
    if (!(fromRate > toRate)) {
      // Same rate, or a device slower than the recogniser wants. Pass through
      // unchanged, exactly as before: no browser hands AudioWorklet less than
      // 16 kHz, and upsampling would add nothing the recogniser can use.
      this.taps = null;
      this.history = new Float32Array(0);
      return;
    }
    this.taps = designLowPass((0.45 * toRate) / fromRate, RESAMPLER_TAPS);
    this.history = new Float32Array(RESAMPLER_TAPS);
  }

  process(input: Float32Array): Float32Array {
    const taps = this.taps;
    if (!taps) return input;
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    const T = taps.length;

    // work = [history | input], so sample k of this block (k may be as low as
    // -T) is work[T + k]. The filter is causal; its half-length delay is
    // constant and therefore invisible to the recogniser.
    if (this.work.length < T + n) this.work = new Float32Array(T + n);
    const work = this.work;
    work.set(this.history, 0);
    work.set(input, T);

    // filtered[i + 1] is the low-passed value at input index i, for
    // i = -1 … n-1. Index -1 is needed when the carried phase is negative.
    if (this.filtered.length < n + 1) this.filtered = new Float32Array(n + 1);
    const y = this.filtered;
    for (let i = -1; i < n; i += 1) {
      let acc = 0;
      const base = T + i;
      for (let j = 0; j < T; j += 1) acc += taps[j] * work[base - j];
      y[i + 1] = acc;
    }

    let pos = this.phase;
    const count = pos <= n - 1 ? Math.floor((n - 1 - pos) / this.ratio) + 1 : 0;
    const out = new Float32Array(count);
    for (let k = 0; k < count; k += 1) {
      const base = Math.floor(pos);
      const weight = pos - base;
      const a = y[base + 1];
      const b = weight > 0 ? y[base + 2] : a;
      out[k] = a + (b - a) * weight;
      pos += this.ratio;
    }
    this.phase = pos - n;

    if (n >= T) this.history.set(input.subarray(n - T));
    else {
      this.history.copyWithin(0, n);
      this.history.set(input, T - n);
    }
    return out;
  }
}

/**
 * One-shot resample of a whole buffer. Kept for callers that hold complete
 * audio rather than a stream; live capture uses a persistent `Resampler` so
 * the read phase and filter state survive from one render quantum to the next.
 */
export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  return new Resampler(fromRate, toRate).process(input);
}

/** Float [-1,1] → little-endian signed 16-bit PCM. */
export function floatToPcm16(samples: ArrayLike<number>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/**
 * Wrap the microphone's already-resampled PCM16 bytes in a minimal WAV file.
 * No audio is persisted: callers hold this only for the one request to an
 * optional batch recogniser.
 */
export function pcm16ToWav(pcm16: ArrayBuffer, sampleRate = TARGET_SAMPLE_RATE): ArrayBuffer {
  const wav = new ArrayBuffer(44 + pcm16.byteLength);
  const view = new DataView(wav);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm16.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm16.byteLength, true);
  new Uint8Array(wav, 44).set(new Uint8Array(pcm16));
  return wav;
}

/** One bounded, ephemeral PCM16 buffer for a Counter fallback request. */
export class Pcm16UtteranceBuffer {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  append(frame: ArrayBuffer): boolean {
    if (this.length + frame.byteLength > MAX_COUNTER_UTTERANCE_BYTES) return false;
    this.chunks.push(new Uint8Array(frame.slice(0)));
    this.length += frame.byteLength;
    return true;
  }

  get byteLength() {
    return this.length;
  }

  toArrayBuffer(): ArrayBuffer {
    const joined = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return joined.buffer;
  }

  clear() {
    this.chunks.length = 0;
    this.length = 0;
  }
}
