import { cn } from "@/lib/cn";

/**
 * The symbol: two bubbles that do not match, and a check where they overlap.
 *
 *   A: 어쩌구저쩌구      a long, careful, over-explained sentence
 *   B: ㅇㅇ              two letters
 *   ✓ : the overlap
 *
 * The proportions carry the argument, so they are fixed rather than
 * responsive: A is wide and full of lines, B is small and nearly empty, and
 * they still resolve. Communication ≠ equal effort, or matched grammar, or a
 * correct translation. It is only the overlap.
 *
 * The lines inside A are drawn as strokes rather than set as text on purpose —
 * a real Korean string here would be read aloud by a screen reader, would need
 * translating, and would make the symbol a sentence instead of a picture.
 * `label` carries the meaning for assistive tech instead.
 */
export function SpeechBubbles({
  size = 96,
  tone = "default",
  label,
  className,
}: {
  size?: number;
  /** `resolved` fills the check — used only where the outcome is a success. */
  tone?: "default" | "resolved";
  label?: string;
  className?: string;
}) {
  const resolved = tone === "resolved";

  return (
    <svg
      viewBox="0 0 120 84"
      width={size}
      height={(size * 84) / 120}
      className={cn("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
    >
      {/* Bubble A — the one that says too much. */}
      <path
        d="M6 12a6 6 0 0 1 6-6h58a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H30l-12 10V46h-6a6 6 0 0 1-6-6z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path
        d="M18 18h46M18 26h46M18 34h28"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.32"
      />

      {/* Bubble B — the one that says almost nothing, and is not wrong. */}
      <path
        d="M62 40a6 6 0 0 1 6-6h40a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6h-6v10l-12-10H68a6 6 0 0 1-6-6z"
        fill="var(--bg)"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path
        d="M76 50h6M90 50h6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.32"
      />

      {/* The overlap. Sits on the seam of the two bubbles, in brand red, and
          is the only saturated thing in the symbol — the eye should land on
          the agreement, not on either speaker. */}
      {resolved ? (
        <circle cx="66" cy="42" r="13" fill="var(--brand-red)" />
      ) : null}
      <path
        d="m59.5 42.5 4.5 4.5 9-10"
        stroke={resolved ? "var(--bg)" : "var(--brand-red)"}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
