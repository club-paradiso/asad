"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ensureMicrophonePermission,
  getMicrophonePermissionState,
  type MicrophonePermissionState,
} from "@/providers/stt";
import { cn } from "@/lib/cn";
import { voiceReadinessStringsFor } from "./voice-readiness-strings";

export function VoiceReadinessButton({
  lang,
  className,
}: {
  lang: string;
  className?: string;
}) {
  const copy = useMemo(() => voiceReadinessStringsFor(lang), [lang]);
  const [state, setState] = useState<MicrophonePermissionState>("prompt");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    void getMicrophonePermissionState().then((next) => {
      if (cancelled) return;
      setState(next);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const prepare = async () => {
    if (checking || state !== "prompt") return;
    setChecking(true);
    const next = await ensureMicrophonePermission();
    setState(next);
    setChecking(false);
  };

  if (!checking && (state === "denied" || state === "unavailable")) {
    return (
      <div
        className={cn(
          "rounded-xl border bg-[var(--bg-raised)] px-3 py-3 text-center text-xs leading-relaxed",
          state === "denied"
            ? "border-[color-mix(in_srgb,var(--danger)_45%,var(--line))] text-[var(--danger)]"
            : "border-[var(--line)] text-[var(--fg-dim)]",
          className,
        )}
        role={state === "denied" ? "status" : undefined}
      >
        {state === "denied" ? copy.denied : copy.unavailable}
      </div>
    );
  }

  const ready = state === "granted";
  return (
    <div className={cn("rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] p-3", className)}>
      <button
        type="button"
        onClick={() => void prepare()}
        disabled={checking || ready}
        aria-busy={checking}
        className={cn(
          "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors",
          ready
            ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
            : "border-[var(--line-strong)] text-[var(--fg)]",
          "disabled:cursor-default disabled:opacity-70",
        )}
      >
        <span aria-hidden>{ready ? "✓" : "🎙"}</span>
        <span>{checking ? copy.preparing : ready ? copy.ready : copy.prepare}</span>
      </button>
      <p className="mt-2 text-center text-xs leading-relaxed text-[var(--fg-dim)]" aria-live="polite">
        {ready ? copy.ready : copy.hint}
      </p>
    </div>
  );
}
