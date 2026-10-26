/**
 * Web Audio ends of the Remote Microphone server relay.
 *
 * Capture (phone): the microphone stream → 16 kHz → µ-law frames.
 * Playout (computer): µ-law frames → a live MediaStream that ASAD's existing
 * capture pipeline consumes exactly like the WebRTC track.
 *
 * Both need an AudioContext that was created or resumed during a tap or
 * click: iOS Safari and macOS Safari keep a context suspended otherwise. So
 * each side "prepares" its context from a user gesture (the phone's Start
 * button, the computer's Pair/Approve buttons) long before the relay may be
 * needed, and only connects nodes when it is.
 *
 * ScriptProcessorNode is deprecated but available in every browser that can
 * run this page, needs no separate module file, and the work per callback is
 * a few thousand multiply-adds.
 */
import { RELAY_FRAME_BYTES, RELAY_SAMPLE_RATE } from "./protocol";
import { Downsampler, FrameAccumulator, encodeMulaw } from "./relay-codec";

export interface RelayCapture {
  /** Begin emitting µ-law frames from this stream. Replaces any earlier stream. */
  start(stream: MediaStream, onFrame: (frame: Uint8Array) => void): void;
  /** Stop emitting; the context stays ready for another start. */
  stop(): void;
  /** Release the context. */
  close(): void;
}

export interface RelayPlayoutSink {
  readonly stream: MediaStream;
  /** Queue decoded samples at RELAY_SAMPLE_RATE. */
  push(samples: Float32Array): void;
  /** Audio queued ahead of the playout clock, ms. */
  bufferedMs(): number;
  close(): void;
}

export interface RelayPlayout {
  /** A fresh sink with its own track. */
  open(): RelayPlayoutSink | null;
  close(): void;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function relayAudioSupported(): boolean {
  return audioContextCtor() !== null;
}

/** Create from a user gesture. Returns null where Web Audio is missing. */
export function createBrowserRelayCapture(): RelayCapture | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  void context.resume().catch(() => {});

  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silent: GainNode | null = null;

  const stop = () => {
    if (processor) processor.onaudioprocess = null;
    for (const node of [source, processor, silent]) {
      try {
        node?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    source = null;
    processor = null;
    silent = null;
  };

  return {
    start(stream, onFrame) {
      stop();
      if (context.state === "suspended") void context.resume().catch(() => {});
      const downsampler = new Downsampler(context.sampleRate, RELAY_SAMPLE_RATE);
      const frames = new FrameAccumulator(RELAY_FRAME_BYTES);
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      // A processor only runs while connected to the destination; a zero gain
      // keeps the phone's speaker silent.
      silent = context.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        frames.push(downsampler.process(input), (frame) => onFrame(encodeMulaw(frame)));
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
    },
    stop,
    close() {
      stop();
      void context.close().catch(() => {});
    },
  };
}

/** Target playout delay. Covers poll spacing and request jitter. */
const PLAYOUT_LEAD_S = 0.35;
/**
 * Frames arrive in bursts (two in one read is common), and a queue that grew
 * never shrinks at 1× speed. Above the target, play 8 % fast to catch up —
 * inaudible to a recogniser, and nothing is dropped.
 */
const PLAYOUT_CATCH_UP_ABOVE_S = PLAYOUT_LEAD_S + 0.25;
const PLAYOUT_CATCH_UP_RATE = 1.08;
/** Beyond this much queued audio, drop the frame: stale speech is worse than a gap. */
const PLAYOUT_MAX_S = 2;

/** Create from a user gesture. Returns null where Web Audio is missing. */
export function createBrowserRelayPlayout(): RelayPlayout | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  void context.resume().catch(() => {});

  return {
    open() {
      if (context.state === "closed") return null;
      if (context.state === "suspended") void context.resume().catch(() => {});
      const destination = context.createMediaStreamDestination();
      let nextTime = 0;
      let closed = false;
      return {
        stream: destination.stream,
        push(samples) {
          if (closed || samples.length === 0) return;
          const now = context.currentTime;
          if (nextTime < now) nextTime = now + PLAYOUT_LEAD_S;
          const queued = nextTime - now;
          if (queued > PLAYOUT_MAX_S) return;
          const rate = queued > PLAYOUT_CATCH_UP_ABOVE_S ? PLAYOUT_CATCH_UP_RATE : 1;
          const buffer = context.createBuffer(1, samples.length, RELAY_SAMPLE_RATE);
          buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.playbackRate.value = rate;
          node.connect(destination);
          node.start(nextTime);
          node.onended = () => {
            try {
              node.disconnect();
            } catch {
              // Already disconnected.
            }
          };
          nextTime += buffer.duration / rate;
        },
        bufferedMs() {
          return Math.max(0, Math.round((nextTime - context.currentTime) * 1000));
        },
        close() {
          closed = true;
          try {
            destination.disconnect();
          } catch {
            // Already disconnected.
          }
        },
      };
    },
    close() {
      void context.close().catch(() => {});
    },
  };
}
