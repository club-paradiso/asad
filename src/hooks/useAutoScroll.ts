"use client";

/**
 * Auto-scroll for the English stream.
 *
 * Three rules, all learned from what makes streaming transcripts unusable:
 *
 *  1. Scroll on *stabilised chunks*, never on tokens. Per-token scrolling
 *     makes the text impossible to fixate on.
 *  2. Park the active line around 45% of the viewport, so the interpreter can
 *     see what they just said above it and what is coming below it.
 *  3. The moment the interpreter scrolls by hand, stop following and say so.
 *     Fighting a user for scroll position is unforgivable on stage.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where the active line's centre sits, as a fraction of the reading region.
 *
 * Slightly below the middle: the interpreter gets more of what they have just
 * said above the line, and the space below only has to hold the one or two
 * short anticipated chunks. Sitting it dead centre wastes the lower half.
 */
const ANCHOR = 0.55;

/** Distance from the anchor before a scroll is worth performing at all. */
const DEAD_ZONE_PX = 24;

export function useAutoScroll<T extends HTMLElement>(options: {
  /** Changes whenever the active chunk changes — the only scroll trigger. */
  activeKey: string | number;
  /** False while frozen or after a manual scroll. */
  follow: boolean;
  /** Called when the interpreter scrolls away from the live position. */
  onManualScroll?: () => void;
}) {
  const containerRef = useRef<T | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const programmatic = useRef(false);
  const [atLive, setAtLive] = useState(true);

  const scrollToActive = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    const active = activeRef.current;
    if (!container || !active) return;

    // Measured from rects rather than `offsetTop`: the chunks' offset parent is
    // the positioned <main>, not the scroll container, so offsetTop would be
    // measured from the wrong origin and the anchor would never be hit.
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const activeCentre =
      activeRect.top - containerRect.top + container.scrollTop + activeRect.height / 2;

    const target = activeCentre - container.clientHeight * ANCHOR;
    const clamped = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));
    if (Math.abs(clamped - container.scrollTop) < DEAD_ZONE_PX) return;

    programmatic.current = true;
    container.scrollTo({ top: clamped, behavior });
    // Release the guard after the smooth scroll settles.
    window.setTimeout(() => {
      programmatic.current = false;
    }, behavior === "smooth" ? 420 : 60);
  }, []);

  // Only chunk changes move the view.
  useEffect(() => {
    if (!options.follow) return;
    scrollToActive();
  }, [options.activeKey, options.follow, scrollToActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      if (programmatic.current) return;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const live = distanceFromBottom < container.clientHeight * 0.75;
      setAtLive(live);
      if (!live) options.onManualScroll?.();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
    // `options.onManualScroll` is stable in practice; re-binding on every
    // render would drop scroll events mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Jump back to the live position and resume following. */
  const returnToLive = useCallback(() => {
    setAtLive(true);
    scrollToActive("smooth");
  }, [scrollToActive]);

  return { containerRef, activeRef, atLive, returnToLive, scrollToActive };
}
