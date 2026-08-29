import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SpeechBubbles } from "@/components/brand/SpeechBubbles";

/**
 * Empty, error and success states.
 *
 * These used to be a bordered box with a paragraph in it, which is the one
 * place in a product where a paragraph is guaranteed not to be read. They are
 * also the one place the brand is allowed to be funny: nobody is mid-task on
 * an empty screen, so a shrug costs the user nothing and buys the product a
 * personality.
 *
 * The line the brief draws, and this component enforces by having three tones
 * rather than one: `empty` and `success` may be playful. `error` may not.
 * Somebody is stuck when they read an error, and a joke at that moment reads
 * as the product not taking their problem seriously — so the error tone drops
 * the symbol, states the fact, and gives them something to press.
 */
export function StateBlock({
  tone = "empty",
  title,
  detail,
  action,
  className,
}: {
  tone?: "empty" | "success" | "error";
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  const isError = tone === "error";

  return (
    <div
      /* `status` for the quiet tones, `alert` for the loud one: an empty list
         should not interrupt a screen reader mid-sentence, an error should. */
      role={isError ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center gap-4 px-6 py-12 text-center",
        className,
      )}
    >
      {isError ? (
        <ErrorGlyph />
      ) : (
        <SpeechBubbles
          size={104}
          tone={tone === "success" ? "resolved" : "default"}
          className={cn(
            "text-[var(--fg-dim)]",
            tone === "success" && "mark-resolve",
          )}
        />
      )}

      <div className="flex max-w-sm flex-col gap-1.5">
        <p
          className={cn(
            "text-base font-semibold",
            isError ? "text-[var(--danger)]" : "text-[var(--fg)]",
          )}
        >
          {title}
        </p>
        {detail ? (
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            {detail}
          </p>
        ) : null}
      </div>

      {action}
    </div>
  );
}

/**
 * The error glyph is a shape, not a hue.
 *
 * Red alone fails for the ~8% of men with a red-green deficiency and for
 * anyone reading in sunlight, so an error here is always a triangle AND red
 * AND the word — three signals, any one of which is enough.
 */
function ErrorGlyph() {
  return (
    <svg
      viewBox="0 0 48 48"
      width="48"
      height="48"
      aria-hidden
      fill="none"
      className="text-[var(--danger)]"
    >
      <path
        d="M24 6 45 42H3z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M24 19v9"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="24" cy="35" r="2" fill="currentColor" />
    </svg>
  );
}
