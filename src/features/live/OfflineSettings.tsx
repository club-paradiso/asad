"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/primitives";
import { localModelInfo, localRuntime, type LocalModel } from "@/providers/offline/runtime";
import type { SessionSettings } from "@/types";

const MODELS = ["translation", "speech"] as const;
const MB = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const LABELS = {
  unavailable: "Unavailable",
  downloading: "Downloading",
  loading: "Loading",
  ready: "Verified",
};

export function useOfflineRuntime() {
  return useSyncExternalStore(localRuntime.subscribe, localRuntime.snapshot, localRuntime.serverSnapshot);
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

export function OfflineSettings({ settings, onChange, active = false, diagnostics = false }: {
  settings?: SessionSettings;
  onChange?: (settings: SessionSettings) => void;
  active?: boolean;
  diagnostics?: boolean;
}) {
  const state = useOfflineRuntime();
  const online = useOnline();
  const [usage, setUsage] = useState<number>();
  const [actionError, setActionError] = useState<string>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (diagnostics) void localRuntime.prepare([...MODELS], false);
  }, [diagnostics]);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((estimate) => setUsage(estimate.usage)).catch(() => {});
  }, [state.translation.status, state.speech.status]);

  const ready = state.shell && MODELS.every((kind) => state[kind].status === "ready");
  const busy = working || MODELS.some((kind) => ["loading", "downloading"].includes(state[kind].status));
  const size = MODELS.reduce((sum, kind) => sum + localModelInfo(kind).bytes, 0);
  const patch = (next: Partial<SessionSettings>) => { if (settings) onChange?.({ ...settings, ...next }); };
  const run = (work: () => Promise<void>) => {
    setActionError(undefined);
    setWorking(true);
    void work().catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : "Local model operation failed.");
    }).finally(() => setWorking(false));
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Offline interpretation">
      <h3 className="font-semibold">Offline interpretation</h3>
      <p role="status" className="text-sm">
        {ready ? "Offline Ready" : busy ? "Preparing local models…" : "Offline models require preparation"}
      </p>
      {settings && <fieldset disabled={active} className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          Translation Engine
          <select aria-label="Translation Engine" value={settings.translationEngine}
            onChange={(event) => patch({ translationEngine: event.target.value as SessionSettings["translationEngine"] })}>
            <option value="auto">Auto</option><option value="cloud">Cloud</option>
            <option value="local" disabled={state.translation.status !== "ready"}>Local</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Speech Recognition
          <select aria-label="Speech Recognition" value={settings.speechEngine}
            onChange={(event) => patch({ speechEngine: event.target.value as SessionSettings["speechEngine"] })}>
            <option value="auto">Auto</option><option value="browser">Browser</option>
            <option value="local" disabled={state.speech.status !== "ready"}>Local</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.offlineMode} disabled={!ready && !settings.offlineMode}
            onChange={(event) => patch({ offlineMode: event.target.checked })} />
          Offline Mode
        </label>
      </fieldset>}
      <p className="text-xs text-[var(--fg-muted)]">
        Korean → English. Local speech produces text after short audio segments.
        Local translation has limited context and may misread names or numbers.
        {active ? " End the session to change engines or manage models." : ""}
      </p>
      {MODELS.map((kind) => <ModelStatus key={kind} kind={kind} state={state[kind]} diagnostics={diagnostics} />)}
      <p className="text-xs text-[var(--fg-muted)]">
        Model files {MB(size)} · runtime about 22 MB{usage === undefined ? "" : ` · site storage ${MB(usage)}`}
      </p>
      {diagnostics && <p className="text-xs">
        Browser {typeof navigator === "undefined" ? "—" : navigator.userAgent} · WebGPU {
          typeof navigator !== "undefined" && "gpu" in navigator ? "available to probe" : "unavailable"
        } · WASM {typeof WebAssembly === "undefined" ? "unavailable" : "supported"} · shell {state.shell ? "verified" : "unverified"}
        <br />Speech route {state.speechRoute ?? "—"} · Translation route {state.translationRoute ?? "—"}
      </p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!online || active || busy}
          onClick={() => run(() => localRuntime.prepare(["translation"], true))}>Download translation model</Button>
        <Button size="sm" disabled={!online || active || busy}
          onClick={() => run(() => localRuntime.prepare([...MODELS], true))}>Download Offline Models</Button>
        <Button size="sm" disabled={active || busy || typeof caches === "undefined"}
          onClick={() => run(() => localRuntime.clear())}>Delete Cached Models</Button>
      </div>
      <p className="text-xs text-[var(--fg-muted)]">Advanced model unavailable pending device validation.</p>
      {actionError && <p role="alert">{actionError}</p>}
    </section>
  );
}

function ModelStatus({ kind, state, diagnostics }: {
  kind: LocalModel;
  state: ReturnType<typeof localRuntime.snapshot>[LocalModel];
  diagnostics: boolean;
}) {
  const { repo, bytes, revision } = localModelInfo(kind);
  const times = [...state.samples].sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  const average = times.reduce((sum, ms) => sum + ms, 0) / times.length;
  return (
    <div className="text-xs">
      <p>{repo} ({revision.slice(0, 8)}) · {MB(bytes)} · {LABELS[state.status]}
        {state.status === "downloading" && ` ${Math.round((state.progress ?? 0) * 100)}%`}
      </p>
      {diagnostics && state.lastSuccess && <p>
        Last successful model {state.lastSuccess} · {state.device} · setup {Math.round(state.setupMs ?? 0)} ms ·
        average {Math.round(average)} ms · p95 {Math.round(p95)} ms · inference used local assets
      </p>}
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}
