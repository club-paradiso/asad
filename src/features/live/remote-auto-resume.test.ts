import { describe, expect, it } from "vitest";
import { shouldAutoResumeRemote } from "./StartScreen";
import { REMOTE_MIC_DISCONNECTED, REMOTE_MIC_NOT_CONNECTED, REMOTE_MIC_NEEDS_RAW_STT } from "./useLiveSession";

describe("remote microphone auto-resume", () => {
  it("applies only to interruptions caused by the phone going away", () => {
    expect(shouldAutoResumeRemote(REMOTE_MIC_NOT_CONNECTED)).toBe(true);
    expect(shouldAutoResumeRemote(REMOTE_MIC_DISCONNECTED)).toBe(true);
  });

  it("never resumes a recogniser or configuration failure", () => {
    expect(shouldAutoResumeRemote(undefined)).toBe(false);
    expect(shouldAutoResumeRemote(REMOTE_MIC_NEEDS_RAW_STT)).toBe(false);
    expect(shouldAutoResumeRemote("Speech recognition stopped unexpectedly.")).toBe(false);
  });
});
