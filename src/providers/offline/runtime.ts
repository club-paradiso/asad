"use client";

import models from "./models.json";

export type LocalModel = keyof typeof models;
type Status = "unavailable" | "downloading" | "loading" | "ready";
interface ModelState {
  status: Status;
  progress?: number;
  error?: string;
  device?: string;
  setupMs?: number;
  samples: number[];
  lastSuccess?: string;
}
interface OfflineState {
  translation: ModelState;
  speech: ModelState;
  shell: boolean;
  speechRoute?: string;
  translationRoute?: string;
}
interface Reply {
  id: number;
  error?: string;
  ratio?: number;
  loading?: boolean;
  ok?: boolean;
  result?: string;
  device?: string;
  setupMs?: number;
  ms?: number;
}
type Pending = { receive: (reply: Reply) => void; fail: (error: Error) => void };

const RUNTIME = "/offline-v2/";
const ASSETS = ["inference.js", "transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm", "ko-check.wav"];
const SHELL_CACHE = "asad-offline-shell-v2";
const MARKER = "/offline-v2/shell-ready";
const empty = (): ModelState => ({ status: "unavailable", samples: [] });
const INITIAL: OfflineState = { translation: empty(), speech: empty(), shell: false };
const WORD = /[a-z]{2,}/i;
const SPEECH_SAMPLE_TEXT = /공평|확실히/;
export const isEnglishTranslation = (source: string, text: string) =>
  !!text.trim() && source.trim() !== text.trim() && WORD.test(text) &&
  (text.match(/[a-z]/gi)?.length ?? 0) > (text.match(/[가-힣]/g)?.length ?? 0);

export const localModelInfo = (kind: LocalModel) => ({
  ...models[kind],
  bytes: models[kind].files.reduce((sum, file) => sum + file.bytes, 0),
});
const modelCacheName = (kind: LocalModel) => `asad-model-v1-${models[kind].revision}`;
export const isKoEn = (source: string, target: string) =>
  /^ko(?:-|$)/i.test(source) && /^en(?:-|$)/i.test(target);

class LocalRuntime {
  private state = INITIAL;
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<() => void>();
  private preparation: Promise<void> | null = null;
  private generation = 0;
  private useCount = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  snapshot = () => this.state;
  serverSnapshot = () => INITIAL;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  };

  private publish(state: OfflineState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private patch(kind: LocalModel, state: Partial<ModelState>) {
    this.publish({ ...this.state, [kind]: { ...this.state[kind], ...state } });
  }

  setRoute(route: "speechRoute" | "translationRoute", provider: string | undefined) {
    if (this.state[route] !== provider) this.publish({ ...this.state, [route]: provider });
  }

  retain() {
    this.useCount++;
    clearTimeout(this.idleTimer);
    return () => {
      this.useCount = Math.max(0, this.useCount - 1);
      this.scheduleRelease();
    };
  }

  private scheduleRelease() {
    clearTimeout(this.idleTimer);
    if (this.useCount === 0) {
      this.idleTimer = setTimeout(() => this.resetWorker("Local runtime is idle."), 30_000);
    }
  }

  private resetWorker(message: string) {
    this.worker?.terminate();
    this.worker = null;
    for (const call of this.pending.values()) call.fail(new Error(message));
  }

  private request(kind: LocalModel, action: "download" | "run", input?: string | Float32Array,
    signal?: AbortSignal, progress?: (ratio: number) => void): Promise<Reply> {
    if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    if (this.pending.size >= 3) return Promise.reject(new Error("Local inference is busy. Try again."));
    this.worker ??= new Worker(RUNTIME + "inference.js", { type: "module", name: "asad-local-inference" });
    const worker = this.worker;
    worker.onmessage = ({ data }: MessageEvent<Reply>) => this.pending.get(data.id)?.receive(data);
    worker.onerror = () => {
      if (this.worker === worker) this.resetWorker("Local inference could not start. Check browser support or device memory.");
    };
    return new Promise<Reply>((resolve, reject) => {
      const id = ++this.nextId;
      const cleanup = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
      };
      // ONNX cannot interrupt a running graph. Reject its result immediately
      // while keeping its slot counted until the graph settles or times out.
      const abort = () => reject(new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(() => {
        this.resetWorker(action === "download"
          ? "Model download timed out. Retry to resume verified files."
          : "Local inference timed out. The worker was restarted to free memory.");
      }, action === "download" ? 300_000 : 25_000);
      const fail = (error: Error) => { cleanup(); reject(error); };
      this.pending.set(id, {
        receive: (reply) => {
          if (reply.ratio !== undefined) { progress?.(reply.ratio); return; }
          if (reply.loading === false) return;
          if (reply.error) { fail(new Error(reply.error)); return; }
          cleanup();
          resolve(reply);
        },
        fail,
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        worker.postMessage({ id, kind, action, input, spec: models[kind] },
          input instanceof Float32Array ? [input.buffer] : []);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Could not submit local inference."));
      }
    });
  }

  async run(kind: LocalModel, input: string | Float32Array, signal?: AbortSignal) {
    try {
      const reply = await this.request(kind, "run", input, signal);
      return { text: reply.result?.trim() ?? "", reply };
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        const message = error instanceof Error ? error.message : "Local inference failed.";
        // Busy work can be dropped without marking a verified model as missing.
        if (!message.startsWith("Local inference is busy")) {
          this.patch(kind, { status: "unavailable", error: message });
        }
      }
      throw error;
    }
  }

  record(kind: LocalModel, reply: Reply) {
    this.patch(kind, {
      status: "ready", error: undefined, device: reply.device, setupMs: reply.setupMs,
      samples: [...this.state[kind].samples.slice(-127), reply.ms ?? 0],
      lastSuccess: models[kind].repo,
    });
  }

  prepare(kinds: LocalModel[], download: boolean): Promise<void> {
    if (this.preparation) {
      const existing = this.preparation;
      return download ? existing.then(() => this.prepare(kinds, true)) : existing;
    }
    clearTimeout(this.idleTimer);
    const generation = this.generation;
    const current = () => generation === this.generation;
    const restore = async () => {
      if (!globalThis.caches || !globalThis.Worker || !globalThis.WebAssembly || !globalThis.crypto?.subtle) {
        if (download) throw new Error("This browser needs secure Cache Storage, Web Workers and WebAssembly for local models.");
        return;
      }
      try {
        if (download) {
          await prepareShell();
          await navigator.storage?.persist?.().catch(() => false);
        }
        const shell = await shellReady();
        if (current()) this.publish({ ...this.state, shell });
        if (!shell && download && process.env.NODE_ENV === "production") {
          throw new Error("The offline app shell could not be verified. Reload ASAD and retry.");
        }
        for (const kind of kinds) {
          if (!current()) return;
          if (!download && !(await caches.has(modelCacheName(kind)))) continue;
          if (download) {
            const exists = await caches.has(modelCacheName(kind));
            const storage = await navigator.storage?.estimate?.().catch(() => undefined);
            if (!exists && storage?.quota && storage.quota - (storage.usage ?? 0) < localModelInfo(kind).bytes) {
              throw new Error("This browser has insufficient storage for the local model.");
            }
            this.patch(kind, { status: "downloading", error: undefined, progress: 0 });
            await this.request(kind, "download", undefined, undefined,
              (progress) => { if (current()) this.patch(kind, { progress }); });
          }
          this.patch(kind, { status: "loading", error: undefined });
          const sample = kind === "translation" ? "오늘 날씨가 좋습니다." : await speechFixture();
          const { text, reply } = await this.run(kind, sample);
          if (!current()) return;
          if (typeof sample === "string" ? !isEnglishTranslation(sample, text) : !SPEECH_SAMPLE_TEXT.test(text)) {
            throw new Error("The local model did not pass its inference check.");
          }
          this.record(kind, reply);
        }
      } catch (error) {
        if (current()) {
          const failed = kinds.find((kind) => ["loading", "downloading"].includes(this.state[kind].status))
            ?? kinds.find((kind) => this.state[kind].status !== "ready") ?? kinds[0];
          if (failed) this.patch(failed, { status: "unavailable", error: error instanceof Error ? error.message : "Local setup failed." });
        }
      }
    };
    this.preparation = restore().finally(() => {
      this.preparation = null;
      this.scheduleRelease();
    });
    return this.preparation;
  }

  async clear() {
    if (this.useCount) throw new Error("End the live session before deleting models.");
    this.generation++;
    this.resetWorker("Local models were removed.");
    await this.preparation;
    await Promise.all((await caches.keys()).filter((name) => name.startsWith("asad-model-v1-")).map((name) => caches.delete(name)));
    this.publish({ ...INITIAL, shell: this.state.shell });
  }
}

export const localRuntime = new LocalRuntime();

async function speechFixture() {
  const cache = await caches.open(SHELL_CACHE);
  const path = RUNTIME + "ko-check.wav";
  // Read the fixture from the published shell during restore. A development
  // build has no service worker and may serve it directly during preparation.
  const response = await cache.match(path) ?? (process.env.NODE_ENV !== "production" ? await fetch(path) : undefined);
  if (!response?.ok) throw new Error("The Korean speech verification sample is missing.");
  const wav = new DataView(await response.arrayBuffer());
  // The checked-in fixture is canonical mono 16kHz PCM with a 44-byte header.
  const samples = new Float32Array((wav.byteLength - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = wav.getInt16(44 + 2 * i, true) / 32768;
  return samples;
}

async function shellReady() {
  if (!(await caches.has(SHELL_CACHE))) return false;
  const cache = await caches.open(SHELL_CACHE);
  const marker = await cache.match(MARKER);
  if (!marker) return false;
  const manifest = await marker.json() as string[];
  if (!manifest.includes("/live") || ASSETS.some((file) => !manifest.includes(RUNTIME + file))) return false;
  return (await Promise.all(manifest.map((path) => cache.match(path)))).every(Boolean);
}

async function prepareShell() {
  if (typeof navigator.serviceWorker === "undefined" || process.env.NODE_ENV !== "production") return;
  const worker = navigator.serviceWorker.controller;
  if (!worker) throw new Error("ASAD is installing offline support. Reload this page and retry.");
  const paths = [
    ...ASSETS.map((file) => RUNTIME + file),
    ...Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]"))
      .map((node) => node instanceof HTMLScriptElement ? node.src : node.href)
      .concat(performance.getEntriesByType("resource").map((entry) => entry.name))
      .map((url) => new URL(url, location.href))
      .filter((url) => url.origin === location.origin && url.pathname.startsWith("/_next/static/"))
      .map((url) => url.pathname),
  ];
  const channel = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Preparing the offline app shell timed out."));
    }, 60_000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      if (data?.ok) resolve();
      else reject(new Error("Could not cache the offline app shell. Reload and retry."));
    };
    worker.postMessage({ type: "ASAD_PREPARE_SHELL", paths: [...new Set(paths)] }, [channel.port2]);
  });
}
