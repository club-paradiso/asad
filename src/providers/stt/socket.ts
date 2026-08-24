/**
 * Shared WebSocket transport for streaming recognisers.
 *
 * Handles the parts every cloud provider needs and none of them make easy:
 * exponential-backoff reconnection with a cap, buffering the audio produced
 * while the socket is down, and distinguishing a deliberate close from a
 * dropped connection.
 *
 * A dropped socket in the middle of a service is normal. Losing the session
 * because of one is not.
 */
import { BaseSpeechProvider } from "./types";

const MAX_BUFFERED_FRAMES = 200; // ~10s of 50ms frames
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export abstract class SocketSpeechProvider extends BaseSpeechProvider {
  readonly needsAudio = true;

  protected socket: WebSocket | null = null;
  private wantOpen = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: ArrayBuffer[] = [];

  /** URL (including any query string and auth) for the next connection. */
  protected abstract socketUrl(): Promise<{ url: string; protocols?: string[] }>;
  /** Provider-specific message handling; must call emitPartial/emitStable. */
  protected abstract handleMessage(data: unknown): void;
  /** Optional message sent immediately after the socket opens. */
  protected openMessage(): string | null {
    return null;
  }
  /** Optional message sent before a deliberate close. */
  protected closeMessage(): string | null {
    return null;
  }

  async connect(): Promise<void> {
    this.wantOpen = true;
    this.attempt = 0;
    await this.open();
  }

  private async open(): Promise<void> {
    if (!this.wantOpen) return;
    this.emitStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    let target: { url: string; protocols?: string[] };
    try {
      target = await this.socketUrl();
    } catch (error) {
      this.emitError(error);
      this.scheduleReconnect();
      return;
    }

    const socket = new WebSocket(target.url, target.protocols);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      const hello = this.openMessage();
      if (hello) socket.send(hello);
      this.flush();
      this.emitStatus("listening");
    };

    socket.onmessage = (event) => {
      try {
        this.handleMessage(
          typeof event.data === "string" ? JSON.parse(event.data) : event.data,
        );
      } catch (error) {
        // A single unparseable frame must not end the session.
        this.emitError(error);
      }
    };

    socket.onerror = () => {
      this.emitStatus("reconnecting", "socket error");
    };

    socket.onclose = (event) => {
      this.socket = null;
      if (!this.wantOpen) {
        this.emitStatus("closed");
        return;
      }
      this.emitStatus("reconnecting", `closed (${event.code})`);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (!this.wantOpen) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.open(), delay);
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
      return;
    }
    // Keep the most recent audio so a short reconnect does not lose a phrase.
    this.pending.push(chunk);
    if (this.pending.length > MAX_BUFFERED_FRAMES) this.pending.shift();
  }

  private flush() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    for (const chunk of this.pending) this.socket.send(chunk);
    this.pending = [];
  }

  async disconnect(): Promise<void> {
    this.wantOpen = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const farewell = this.closeMessage();
    if (farewell && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(farewell);
    }
    this.socket?.close(1000, "session ended");
    this.socket = null;
    this.pending = [];
    this.emitStatus("closed");
  }
}
