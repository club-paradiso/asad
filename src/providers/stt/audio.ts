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

export interface MicrophoneCaptureOptions {
  onFrame: (pcm16: ArrayBuffer) => void;
  onError?: (error: Error) => void;
  /** Called when a live audio track ends unexpectedly after capture starts. */
  onEnded?: () => void;
  /** Supply an existing stream (mixer, WebRTC) instead of opening a mic. */
  stream?: MediaStream;
  deviceId?: string;
}

/**
 * Constraints for a raw-audio STT capture.
 *
 * An operator-selected booth input is a requirement, not a preference. Using a
 * bare `deviceId` string is only an "ideal" constraint and allows the browser
 * to silently choose another microphone. `exact` makes a missing/disconnected
 * mixer fail visibly instead of accidentally listening to the laptop mic.
 */
export function captureAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
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
        audio: captureAudioConstraints(this.options.deviceId),
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

  private ingest(samples: Float32Array) {
    if (!this.context) return;
    const resampled = downsample(samples, this.context.sampleRate, TARGET_SAMPLE_RATE);
    for (const sample of resampled) this.buffer.push(sample);

    while (this.buffer.length >= FRAME_SAMPLES) {
      const frame = this.buffer.splice(0, FRAME_SAMPLES);
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
    this.buffer = [];
  }
}

/** Linear-interpolation resample. Adequate for speech; cheap enough for live. */
export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    const weight = position - index;
    output[i] = input[index] * (1 - weight) + input[next] * weight;
  }
  return output;
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
