import { beforeEach, describe, expect, it } from "vitest";
import { COUNTER_PREFERENCES_STORAGE_KEY, counterPreferencesStore } from "./preferences";

describe("Counter safe preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    counterPreferencesStore.set({ configured: false, hostLang: "ko-KR", deskLabel: "" });
  });

  it("persists only staff UI preferences", () => {
    counterPreferencesStore.set({ configured: true, hostLang: "ko-KR", deskLabel: "접수 창구 2" });
    expect(Object.keys(window.localStorage)).toEqual([COUNTER_PREFERENCES_STORAGE_KEY]);
    const stored = window.localStorage.getItem(COUNTER_PREFERENCES_STORAGE_KEY) ?? "";
    expect(JSON.parse(stored)).toEqual({ configured: true, hostLang: "ko-KR", deskLabel: "접수 창구 2" });
    expect(stored).not.toMatch(/transcript|translation|messages|audio|room|code|visitor/i);
  });

  it("bounds the optional desk label before writing", () => {
    counterPreferencesStore.set({ configured: true, hostLang: "en-US", deskLabel: "x".repeat(100) });
    const stored = JSON.parse(window.localStorage.getItem(COUNTER_PREFERENCES_STORAGE_KEY) ?? "{}") as { deskLabel?: string };
    expect(stored.deskLabel).toHaveLength(60);
  });
});
