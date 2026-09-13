import { describe, expect, it } from "vitest";
import { speechFailureKind, speechFailureMessage } from "./failure";

describe("what a recogniser failure means for the session", () => {
  it("keys on the code, not on the human sentence above it", () => {
    // The regression this exists to stop: "Microphone access was refused"
    // contains the word "microphone" and not the word "permission", so
    // classifying the message treated a denied microphone as a lost device —
    // and offered the interpreter advice about reconnecting their interface.
    expect(speechFailureKind("not-allowed")).toBe("permission");
    expect(speechFailureMessage("not-allowed")).toMatch(/Microphone access was refused/);
  });

  it("separates the four things a person can do something different about", () => {
    expect(speechFailureKind("service-not-allowed")).toBe("permission");
    expect(speechFailureKind("audio-capture")).toBe("device");
    expect(speechFailureKind("language-not-supported")).toBe("unsupported");
    expect(speechFailureKind("language-unavailable")).toBe("unsupported");
    expect(speechFailureKind("network")).toBe("transport");
  });

  it("treats an unknown code as recoverable rather than fatal", () => {
    // Browsers do not agree on this vocabulary and it grows. Guessing
    // "unrecoverable" costs a session; guessing "retry" costs a few seconds.
    expect(speechFailureKind("a-code-from-a-future-browser")).toBe("transport");
    expect(speechFailureKind(undefined)).toBe("transport");
    expect(speechFailureKind("")).toBe("transport");
  });
});
