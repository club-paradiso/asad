import { BaseSpeechProvider } from "@/providers/stt/types";
import { localRuntime } from "./runtime";

const RATE = 16_000;
const MAXIMUM = 7 * RATE;
const MINIMUM = RATE * 0.35;
const PAUSE = RATE * 0.55;
const VOICE_RMS = 0.012;

/** Chunked Korean ASR on the existing AudioWorklet's 16 kHz little-endian PCM. */
export class LocalSpeechProvider extends BaseSpeechProvider {
  readonly id = "offline" as const;
  readonly needsAudio = true;
  private buffer = new Float32Array(MAXIMUM);
  private count = 0;
  private voiced = 0;
  private silence = 0;
  private running: Promise<void> | null = null;
  private queued: Float32Array | null = null;
  private lifetime: AbortController | null = null;

  async connect() {
    if (localRuntime.snapshot().speech.status !== "ready") {
      await localRuntime.prepare(["speech"], false);
    }
    if (localRuntime.snapshot().speech.status !== "ready") {
      throw new DOMException("Prepare and verify the Korean speech model in Settings first.", "NotSupportedError");
    }
    this.lifetime = new AbortController();
    this.emitStatus("listening");
  }

  sendAudio(frame: ArrayBuffer) {
    if (!this.lifetime || frame.byteLength < 2) return;
    const pcm = new DataView(frame);
    const samples = Math.floor(pcm.byteLength / 2);
    let power = 0;
    for (let index = 0; index < samples; index++) {
      const value = pcm.getInt16(index * 2, true) / 32768;
      power += value * value;
    }
    const voice = Math.sqrt(power / samples) >= VOICE_RMS;
    if (!voice && !this.count) return;
    for (let index = 0; index < samples; index++) {
      this.buffer[this.count++] = pcm.getInt16(index * 2, true) / 32768;
      if (voice) this.voiced++;
      if (this.count === MAXIMUM) this.seal();
      if (!voice && !this.count) break;
    }
    if (voice) this.silence = 0;
    else this.silence += samples;
    if (this.silence >= PAUSE) this.seal();
  }

  private seal() {
    const useful = this.voiced >= MINIMUM;
    const samples = useful ? this.buffer.slice(0, this.count) : null;
    this.count = 0;
    this.voiced = 0;
    this.silence = 0;
    if (!samples) return;
    if (this.running) {
      if (this.queued) this.emitError(new Error("Local speech recognition is behind. A queued audio segment was dropped."));
      this.queued = samples;
    } else {
      this.transcribe(samples);
    }
  }

  private transcribe(samples: Float32Array) {
    const lifetime = this.lifetime;
    if (!lifetime) return;
    this.running = localRuntime.run("speech", samples, lifetime.signal).then(({ text, reply }) => {
      if (lifetime.signal.aborted) return;
      localRuntime.record("speech", reply);
      if (text) this.emitStable(text);
    }).catch((error) => {
      if (lifetime.signal.aborted) return;
      this.emitError(error);
      if (localRuntime.snapshot().speech.status !== "ready") this.emitStatus("error", "unsupported");
    }).finally(() => {
      if (lifetime !== this.lifetime) return;
      this.running = null;
      const queued = this.queued;
      this.queued = null;
      if (queued) this.transcribe(queued);
    });
  }

  async disconnect() {
    this.lifetime?.abort();
    this.lifetime = null;
    this.running = null;
    this.queued = null;
    this.count = 0;
    this.voiced = 0;
    this.silence = 0;
    this.emitStatus("closed");
  }
}
