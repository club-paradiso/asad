"use client";

import Link from "next/link";
import { BoothPreflight } from "./BoothPreflight";
import { useBoothAudioInput } from "./useBoothAudioInput";

/** Dedicated hardware check that can be opened before the live console. */
export function BoothPreflightScreen() {
  const audioInput = useBoothAudioInput(true);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            ASAD Sermon Mode
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Booth preflight</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--fg-muted)]">
            Verify the Korean program feed before the service. This page does not run speech recognition or interpretation and never sends the test audio to a cloud provider.
          </p>
        </div>
        <Link
          href="/live"
          className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
        >
          Back to live
        </Link>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-4">
        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-dim)]">
            Input device
          </span>
          <select
            aria-label="Booth preflight audio input"
            value={audioInput.deviceId}
            onChange={(event) => audioInput.setDeviceId(event.target.value)}
            disabled={!audioInput.supported}
            className="min-h-11 w-full rounded-md border border-[var(--line-strong)] bg-[var(--bg-overlay)] px-3 text-sm text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] disabled:opacity-50"
          >
            <option value="">System default</option>
            {audioInput.devices
              .filter((device) => device.deviceId !== "default")
              .map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
          </select>
        </label>
        <p className="mt-2 text-xs leading-relaxed text-[var(--fg-muted)]">
          Prefer a direct mixer AUX/MATRIX or USB audio-interface feed. Room microphones are a fallback, not the booth design target. Your selected input is remembered only in this browser.
        </p>
      </section>

      <BoothPreflight
        key={audioInput.deviceId || "system-default"}
        inputLabel={audioInput.selectedLabel}
        deviceId={audioInput.deviceId || undefined}
        onPermissionGranted={() => void audioInput.refresh()}
      />

      <section className="rounded-lg border border-[var(--line)] px-4 py-4 text-sm leading-relaxed text-[var(--fg-muted)]">
        <h2 className="font-semibold text-[var(--fg)]">What this test should prove</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>The selected input carries the Korean pulpit/program feed.</li>
          <li>Normal speech produces a stable, usable meter reading.</li>
          <li>The interpreter&apos;s English microphone is absent from the ASAD input.</li>
          <li>No congregation-facing translation path depends on ASAD itself.</li>
        </ul>
      </section>
    </main>
  );
}
