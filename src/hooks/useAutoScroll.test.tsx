import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoScroll } from "./useAutoScroll";

/**
 * The one thing about auto-scroll that is worth a test rather than a comment:
 * it must honour the reader's motion preference. The stylesheet already does,
 * for every CSS animation on the console — but `scrollTo({behavior})` is a
 * JavaScript option and it wins over `scroll-behavior` in a media query, so
 * this path was ignoring the preference about eleven times a minute.
 */
function mountWithMotionPreference(reduce: boolean) {
  const scrollTo = vi.fn();

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;

  const { result, rerender } = renderHook(
    ({ activeKey }: { activeKey: string }) => useAutoScroll<HTMLDivElement>({ activeKey, follow: true }),
    { initialProps: { activeKey: "c1" } },
  );

  const container = {
    scrollTop: 0,
    scrollHeight: 4000,
    clientHeight: 600,
    scrollTo,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ top: 0, height: 600 }) as DOMRect,
  } as unknown as HTMLDivElement;
  const active = {
    getBoundingClientRect: () => ({ top: 2400, height: 60 }) as DOMRect,
  } as unknown as HTMLElement;

  act(() => {
    result.current.containerRef.current = container;
    result.current.activeRef.current = active;
  });

  return { result, rerender, scrollTo };
}

describe("auto-scroll and the reader's motion preference", () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    vi.restoreAllMocks();
  });

  it("animates by default", () => {
    const { result, scrollTo } = mountWithMotionPreference(false);
    act(() => result.current.returnToLive());
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("jumps instead when reduced motion is requested", () => {
    const { result, scrollTo } = mountWithMotionPreference(true);
    act(() => result.current.returnToLive());
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("still moves to the live position either way", () => {
    for (const reduce of [false, true]) {
      const { result, scrollTo } = mountWithMotionPreference(reduce);
      act(() => result.current.returnToLive());
      const [{ top }] = scrollTo.mock.calls[0] as [{ top: number }];
      // The anchor parks the active line below the middle of the region, and
      // it is clamped inside the scrollable range whatever the behaviour.
      expect(top).toBeGreaterThan(0);
      expect(top).toBeLessThanOrEqual(4000 - 600);
    }
  });
});
