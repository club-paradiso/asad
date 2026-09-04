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
    if (checking || state === "granted") return;
    setChecking(true);
    const next = await ensureMicrophonePermission();
    setState(next);
    setChecking(false);
  };

  const statusCopy =
    state === "granted"
      ? copy.ready
      : state === "denied"
        ? copy.denied
        : state === "unavailable"
          ? copy.unavailable
          : copy.hint;

  return (
    <div className={cn("rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] p-3", className)}>
      <button
        type="button"
        onClick={() => void prepare()}
        disabled={checking || state === "granted" || state === "unavailable"}
        aria-busy={checking}
        className={cn(
          "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors",
          state === "granted"
            ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
            : "border-[var(--line-strong)] text-[var(--fg)]",
          "disabled:cursor-default disabled:opacity-70",
        )}
      >
        <span aria-hidden>{state === "granted" ? "✓" : "🎙"}</span>
        <span>{checking ? copy.preparing : state === "granted" ? copy.ready : copy.prepare}</span>
      </button>
      <p
        className={cn(
          "mt-2 text-center text-xs leading-relaxed",
          state === "denied" ? "text-[var(--danger)]" : "text-[var(--fg-dim)]",
        )}
        aria-live="polite"
      >
        {statusCopy}
      </p>
    </div>
  );
}
