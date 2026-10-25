"use client";

/**
 * An End button that asks once.
 *
 * Ending a counter conversation deletes it for both people, and the button
 * sits next to the controls a staff member taps all day on a device they are
 * not looking at. A first tap arms the button and shows what a second one
 * will do, in the reader's own language; the arming lapses on its own so a
 * stray tap costs nothing but a glance.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export const END_CONFIRM_WINDOW_MS = 4000;

export function ConfirmEndButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  armedClassName,
  icon,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  armedClassName?: string;
  icon?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), END_CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
      }}
      aria-label={armed ? confirmLabel : label}
      aria-pressed={armed}
      className={cn(className, armed && armedClassName)}
    >
      {!armed && icon}
      <span>{armed ? confirmLabel : label}</span>
    </button>
  );
}
