import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGuestResume,
  clearHostResume,
  readGuestResume,
  readHostResume,
  writeGuestResume,
  writeHostResume,
} from "./resume";

describe("counter session resume", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("keeps a visitor's capability for this tab and this code only", () => {
    writeGuestResume("AC34", { token: "t1", lang: "vi-VN" });
    expect(readGuestResume("AC34")).toMatchObject({ token: "t1", lang: "vi-VN" });
    expect(readGuestResume("BD57")).toBeNull();
    // Nothing about the conversation itself is stored.
    expect(window.sessionStorage.getItem("asad:counter:guest:v1:AC34")).not.toMatch(/message|text/);
    clearGuestResume("AC34");
    expect(readGuestResume("AC34")).toBeNull();
  });

  it("forgets a record older than the server's idle lifetime", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T09:00:00Z"));
    writeHostResume({ code: "AC34", token: "h1" });
    vi.setSystemTime(new Date("2026-10-25T13:00:01Z"));
    expect(readHostResume()).toBeNull();
    expect(window.sessionStorage.getItem("asad:counter:host:v1")).toBeNull();
  });

  it("ignores a malformed record rather than resuming on it", () => {
    window.sessionStorage.setItem("asad:counter:host:v1", JSON.stringify({ at: Date.now() }));
    expect(readHostResume()).toBeNull();
    writeHostResume({ code: "AC34", token: "h1" });
    expect(readHostResume()).toMatchObject({ code: "AC34", token: "h1" });
    clearHostResume();
    expect(readHostResume()).toBeNull();
  });
});
