"use client";

/**
 * Global keyboard shortcuts for the live console.
 *
 * Bindings are ignored while a text field has focus — the prep sheet and the
 * correction box both live in the same app, and an interpreter typing a name
 * must not toggle the teleprompter.
 */
import { useEffect } from "react";

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
};

export function useHotkeys(map: HotkeyMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;

      const key = event.key === " " ? "space" : event.key.toLowerCase();
      const handler = map[key];
      if (!handler) return;

      event.preventDefault();
      handler(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map, enabled]);
}
