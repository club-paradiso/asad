"use client";

import { Mark } from "@/components/brand/Mark";
import { findLanguage } from "@/counter/languages";
import { sessionEndCopy } from "./session-end-copy";

export function CounterEndedScreen({ lang }: { lang?: string | null }) {
  const language = findLanguage(lang ?? "")?.code ?? "en-US";
  const copy = sessionEndCopy(language);
  const rtl = findLanguage(language)?.rtl ?? false;

  return (
    <main
      className="grid min-h-[100dvh] place-items-center bg-[var(--bg)] px-5 py-8"
      dir={rtl ? "rtl" : undefined}
      lang={language}
    >
      <section className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--bg-raised)] p-7 text-center shadow-sm sm:p-9">
        <div className="mx-auto grid size-16 place-items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,var(--line))] bg-[var(--accent-dim)] text-3xl text-[var(--accent)]" aria-hidden>
          ✓
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-[var(--fg)]">{copy.endedTitle}</h1>
        <p className="mt-3 text-base leading-relaxed text-[var(--fg-muted)]">{copy.endedDetail}</p>
        <div className="mt-7 flex justify-center opacity-75">
          <Mark size={26} title="ASAD" />
        </div>
      </section>
    </main>
  );
}
