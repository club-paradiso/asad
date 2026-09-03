import { cn } from "@/lib/cn";
import { BRAND } from "@/lib/brand";
import { Mark } from "./Mark";

/**
 * The wordmark.
 *
 *   아무튼서로알아들었으면        ← quiet, narrow, hedging
 *   된거아닌가요?                 ← loud, wide, shrugging
 *
 * The line break is the design. The name is fifteen unspaced Hangul syllables,
 * and the old header set it as one run with `break-all`, so on a phone it
 * rendered as "…된거아닌가" / "요" — the brand's single biggest asset arriving
 * looking like a layout bug. Splitting it at the clause boundary fixes the
 * wrap AND stages the joke: the setup reads small, the punchline reads big.
 *
 * `full` is the marketing lockup. `compact` is for anywhere the name is a
 * label rather than a statement — a header on a working screen, where a
 * two-line logo would out-shout the task.
 */
export function Wordmark({
  variant = "full",
  className,
}: {
  variant?: "full" | "compact";
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5", className)}
        title={BRAND.name}
      >
        <Mark size={16} />
        <span className="brand-wordmark whitespace-nowrap text-[0.9375rem] tracking-[-0.03em]">
          {BRAND.shortName}
        </span>
      </span>
    );
  }

  return (
    /* One accessible name for the whole lockup: a screen reader should hear
       the service's name, not two fragments and a punctuation mark. */
    <span
      className={cn("flex flex-col", className)}
      role="img"
      aria-label={BRAND.name}
    >
      <span
        aria-hidden
        className="brand-wordmark brand-wordmark-lead text-[0.92em]"
      >
        {BRAND.nameLead}
      </span>
      <span aria-hidden className="brand-wordmark flex items-end gap-[0.06em]">
        {BRAND.nameTail}
        <Mark
          size="0.92em"
          className="mb-[0.06em] shrink-0 translate-y-[0.02em]"
        />
      </span>
    </span>
  );
}
