import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings } from "@/types";
import { loadSettings, normaliseSettings, saveSettings } from "./storage";

const KEY = "tong-yuck:settings";

beforeEach(() => {
  window.localStorage.clear();
});

describe("settings migration", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it("maps a legacy Sermon/General record to the unified shape", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        mode: "sermon",
        lag: "safe",
        view: "teleprompter",
        showKorean: false,
        showGlossary: true,
        showScripture: false,
        fontScale: 1.3,
        saveHistory: true,
      }),
    );

    const settings = loadSettings();
    expect(settings).toEqual({
      sourceLanguage: "ko-KR",
      targetLanguage: "en-US",
      // The mode is dropped, never mapped: the Context Engine decides now.
      context: "auto",
      lag: "safe",
      view: "teleprompter",
      showSource: false,
      showGlossary: true,
      showScripture: false,
      fontScale: 1.3,
      saveHistory: true,
      rememberCorrections: true,
    });
    expect("mode" in settings).toBe(false);
    expect("showKorean" in settings).toBe(false);
  });

  it("prefers the new field when both spellings are present", () => {
    expect(normaliseSettings({ showKorean: false, showSource: true }).showSource).toBe(true);
    expect(normaliseSettings({ showKorean: true, showSource: false }).showSource).toBe(false);
  });

  it("always returns canonical language ids", () => {
    const settings = normaliseSettings({ sourceLanguage: "zh-Hant-HK", targetLanguage: "en" });
    expect(settings.sourceLanguage).toBe("zh-TW");
    expect(settings.targetLanguage).toBe("en-US");
  });

  it("never lets both sides be the same language", () => {
    const settings = normaliseSettings({ sourceLanguage: "en-GB", targetLanguage: "en-US" });
    expect(settings.sourceLanguage).toBe("en-US");
    expect(settings.targetLanguage).toBe("ko-KR");
  });

  it("falls back to the default pair for unknown tags", () => {
    const settings = normaliseSettings({ sourceLanguage: "xx-YY", targetLanguage: "tlh" });
    expect(settings.sourceLanguage).toBe("ko-KR");
    expect(settings.targetLanguage).toBe("en-US");
  });

  it("rejects an unknown context rather than storing it", () => {
    expect(normaliseSettings({ context: "sermon" }).context).toBe("sermon");
    expect(normaliseSettings({ context: "karaoke" }).context).toBe("auto");
    expect(normaliseSettings({ context: 3 }).context).toBe("auto");
  });

  it("clamps a wild font scale and ignores garbage", () => {
    expect(normaliseSettings({ fontScale: 40 }).fontScale).toBe(1.9);
    expect(normaliseSettings({ fontScale: "big" }).fontScale).toBe(1);
    expect(normaliseSettings("not an object")).toEqual(defaultSettings());
    expect(normaliseSettings(null)).toEqual(defaultSettings());
  });

  it("keeps the storage key and writes the new shape back", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mode: "general", showKorean: true }));
    const loaded = loadSettings();
    expect(saveSettings(loaded)).toBe(true);
    const written = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(written).toEqual(loaded);
    expect(written.mode).toBeUndefined();
    expect(written.showKorean).toBeUndefined();
  });
});
