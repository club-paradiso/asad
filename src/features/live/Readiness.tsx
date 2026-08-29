"use client";

/**
 * "지금 시작해도 되나?" — answered in four lines.
 *
 * The launcher used to answer this with a single amber block reading
 * `Set GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY`. That is a
 * deployment instruction addressed to a person who is not in the room: the
 * interpreter opening this ninety seconds before a service cannot set an
 * environment variable, cannot redeploy, and is now looking at the loudest
 * element on their screen telling them something is wrong.
 *
 * So every line here says what the interpreter will EXPERIENCE, and the
 * variable names live on /diagnostics where the person who can act on them
 * looks.
 *
 * Status is never carried by colour alone: each row has a word as well as a
 * dot, because a colour-blind interpreter in a dark booth is exactly the
 * reader this product has.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ReadinessLevel = "ready" | "limited" | "blocked";

export interface ReadinessRow {
  label: string;
  /** What this will actually do, in the interpreter's terms. */
  value: string;
  level: ReadinessLevel;
  /** One extra sentence, when the plain value is not enough. */
  detail?: string;
}

const LEVEL_WORD: Record<ReadinessLevel, string> = {
  ready: "준비됨",
  limited: "제한 있음",
  blocked: "사용 불가",
};

const LEVEL_COLOUR: Record<ReadinessLevel, string> = {
  ready: "var(--ok)",
  limited: "var(--warn)",
  blocked: "var(--danger)",
};

export function Readiness({
  rows,
  demo = false,
  action,
}: {
  rows: ReadinessRow[];
  /**
   * Whether this is a demo session.
   *
   * Demo is a MODE, not a degradation. Reporting it as a limitation painted
   * three amber rows across a launcher that was working exactly as designed,
   * which teaches an interpreter that amber means nothing — and amber has to
   * keep meaning something, because during a service it is how they find out
   * the model has dropped to rule-based output.
   *
   * It is still named unmissably: demo and live must be impossible to
   * confuse, and that is achieved by saying which one this is, not by
   * colouring a working demo as broken.
   */
  demo?: boolean;
  action?: ReactNode;
}) {
  // The headline is the worst row: an interpreter scanning this needs one
  // verdict, not four they have to combine themselves.
  const worst: ReadinessLevel = rows.some((r) => r.level === "blocked")
    ? "blocked"
    : rows.some((r) => r.level === "limited")
      ? "limited"
      : "ready";

  return (
    <section
      aria-label="세션 준비 상태"
      className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] lg:h-full lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] px-5 py-4 lg:px-8 lg:py-5">
        <span
          aria-hidden
          className="size-2.5 rounded-full"
          style={{ background: LEVEL_COLOUR[worst] }}
        />
        <h2 className="text-base font-semibold tracking-tight">
          {worst === "ready"
            ? "시작할 수 있어요"
            : worst === "limited"
              ? "시작은 되는데, 제한이 있어요"
              : "아직 시작할 수 없어요"}
        </h2>
        {demo && (
          <span className="ml-auto rounded-sm border border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-[var(--accent)]">
            데모 · 실제 세션 아님
          </span>
        )}
      </header>

      <dl className="divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 lg:block lg:px-8 lg:py-7"
          >
            <dt className="brand-caption w-32 shrink-0 lg:mb-2 lg:w-auto">
              {row.label}
            </dt>
            <dd className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  "text-sm leading-relaxed lg:text-base",
                  row.level === "ready" ? "text-[var(--fg)]" : "font-medium",
                )}
                style={
                  row.level === "ready" ? undefined : { color: LEVEL_COLOUR[row.level] }
                }
              >
                {row.value}
              </span>
              {/* The word, not just the dot. */}
              <span className="sr-only">{LEVEL_WORD[row.level]}</span>
              {/* Detail explains a PROBLEM. A ready row that also carries a
                  paragraph is four lines of reassurance nobody asked for, and
                  on a phone it was what pushed Start below the fold. */}
              {row.detail && row.level !== "ready" && (
                <span className="mt-1 w-full text-xs leading-relaxed text-[var(--fg-muted)] lg:text-sm">
                  {row.detail}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {action && <div className="border-t border-[var(--line)] px-4 py-2.5">{action}</div>}
    </section>
  );
}
