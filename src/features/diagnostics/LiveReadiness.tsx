"use client";

import { useCallback, useMemo, useState } from "react";
import { StatusDot } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { InputCheck, type InputCheckResult } from "./InputCheck";
import { diagnoseLive, summariseLiveDiagnosis, type LiveDiagnosisInput } from "./live-diagnosis";

/**
 * The eight situations a booth can be in, told apart in one place.
 *
 * Server-side facts come down in the diagnostics payload; the browser-side
 * ones come from the input check below. `diagnoseLive` turns both into an
 * ordered list a volunteer can act on, worst first.
 */
export function LiveReadiness({
  stt,
  llm,
  slo,
}: Pick<LiveDiagnosisInput, "stt" | "llm" | "slo">) {
  const [inputCheck, setInputCheck] = useState<InputCheckResult | null>(null);
  const onResult = useCallback((result: InputCheckResult) => setInputCheck(result), []);

  const problems = useMemo(
    () =>
      diagnoseLive({
        permission: inputCheck?.permission,
        deviceCount: inputCheck?.deviceCount,
        selectedLabel: inputCheck?.selectedLabel,
        health: inputCheck?.health,
        stt,
        llm,
        slo,
      }),
    [inputCheck, stt, llm, slo],
  );
  const summary = summariseLiveDiagnosis(problems);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <StatusDot state={summary.level === "ready" ? "live" : summary.level === "warning" ? "degraded" : "error"} />
        <p
          className={cn(
            "text-sm font-medium",
            summary.level === "blocked" && "text-[var(--danger)]",
            summary.level === "warning" && "text-[var(--warn)]",
          )}
        >
          {summary.headline}
        </p>
        {!inputCheck?.health && (
          <span className="text-xs text-[var(--fg-dim)]">· input not yet level-checked</span>
        )}
      </div>

      <InputCheck onResult={onResult} />

      {problems.length > 0 && (
        <ol className="flex flex-col gap-2">
          {problems.map((problem) => (
            <li
              key={problem.kind}
              data-problem={problem.kind}
              className={cn(
                "rounded-md border px-3.5 py-3 text-sm leading-relaxed",
                problem.severity === "blocked"
                  ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)]"
                  : "border-[color-mix(in_srgb,var(--warn)_45%,transparent)]",
              )}
            >
              <p className={cn("font-semibold", problem.severity === "blocked" ? "text-[var(--danger)]" : "text-[var(--warn)]")}>
                {problem.title}
              </p>
              <p className="mt-0.5 text-[var(--fg-muted)]">{problem.detail}</p>
              <p className="mt-1 text-[var(--fg)]">
                <span className="text-[var(--fg-dim)]">Fix: </span>
                {problem.fix}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
