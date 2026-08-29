/**
 * The mark: a question mark whose dot is a check.
 *
 * "정확한지는 모르겠지만, 아무튼 통했다." The glyph has to say both halves at
 * once — the hook is the doubt, the tick underneath is the outcome — so it is
 * drawn rather than typeset. A real "?" from any face puts a round dot there,
 * and swapping that dot for a ✓ is the entire idea; there is no font trick
 * that gets it and no way to guarantee the metrics of one that did.
 *
 * Two-colour by default (ink hook, red tick) because the tick is the payoff
 * and should be the thing that catches. `mono` collapses it to one colour for
 * places where the mark has to survive a single-ink reproduction: a favicon at
 * 16px, an embroidered patch, a fax.
 */
export function Mark({
  size = 24,
  mono = false,
  className,
  title,
}: {
  size?: number | string;
  mono?: boolean;
  className?: string;
  title?: string;
}) {
  const tick = mono ? "currentColor" : "var(--brand-red)";

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {/* The hook. Open at the bottom — it never closes, because the question
          is never actually resolved; only the conversation is. */}
      <path
        d="M9.5 10.6c0-3.5 2.9-6.1 6.6-6.1 3.8 0 6.5 2.4 6.5 5.8 0 2.8-1.5 4.3-3.9 5.9-2 1.3-2.7 2.3-2.7 4.1v.8"
        stroke="currentColor"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      {/* The dot, replaced. Sized and placed on the dot's optical centre so
          the mark still reads as a "?" at 16px, where the tick is barely two
          pixels of angle. */}
      <path
        d="m11.9 27.1 2.7 2.6 5.5-6.2"
        stroke={tick}
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
