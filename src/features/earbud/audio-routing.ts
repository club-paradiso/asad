/** Best-effort WebKit audio-session hints. These never select AirPods or certify a route. */
export type SessionAudioMode = "playback" | "play-and-record" | "auto";
type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: SessionAudioMode; state?: string };
};
export function setAudioSessionMode(mode: SessionAudioMode): boolean {
  if (typeof navigator === "undefined") return false;
  const session = (navigator as NavigatorWithAudioSession).audioSession;
  if (!session) return false;
  try {
    session.type = mode;
    return session.type === mode;
  } catch {
    return false;
  }
}
export function getAudioSessionState(): string {
  if (typeof navigator === "undefined") return "server";
  const session = (navigator as NavigatorWithAudioSession).audioSession;
  return session ? `${session.type} / ${session.state ?? "unknown"}` : "unsupported";
}

/** WAV header for a short 24 kHz, mono, 16-bit PCM response. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 24_000): Uint8Array {
  if (!pcm.length || pcm.length % 2) throw new Error("Invalid PCM16 audio.");
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const str = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  };
  str(0, "RIFF"); view.setUint32(4, pcm.length + 36, true); str(8, "WAVE");
  str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** A distinct media-element test, independent from Web Speech voice synthesis. */
export function testToneWav(): Blob {
  const rate = 24_000, frames = 24_000;
  const pcm = new Uint8Array(frames * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < frames; i++) {
    const envelope = Math.min(1, i / 200) * Math.min(1, (frames - i) / 350);
    const frequency = i < frames / 2 ? 650 : 900;
    const gate = (i > frames * 0.42 && i < frames * 0.52) ? 0 : 1;
    const sample = Math.round(12000 * gate * envelope * Math.sin(2 * Math.PI * frequency * i / rate));
    view.setInt16(i * 2, sample, true);
  }
  const wav = pcm16ToWav(pcm);
  const bytes = new ArrayBuffer(wav.byteLength);
  new Uint8Array(bytes).set(wav);
  return new Blob([bytes], { type: "audio/wav" });
}
