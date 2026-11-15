import { describe, expect, it, vi } from "vitest";
import { LocalSpeechProvider } from "./speech";
import { localRuntime } from "./runtime";

vi.mock("./runtime", () => ({
  localRuntime: {
    snapshot: () => ({ speech: { status: "ready" } }),
    run: vi.fn(async () => ({ text: "회의는 취소하지 않았습니다.", reply: {} })),
    record: vi.fn(),
  },
}));

const frame = (value: number) => {
  const bytes = new ArrayBuffer(640);
  const view = new DataView(bytes);
  for (let i = 0; i < 320; i++) view.setInt16(i * 2, value, true);
  return bytes;
};

describe("chunked local speech", () => {
  it("ignores silence and seals voiced input after a pause", async () => {
    const provider = new LocalSpeechProvider();
    const stable = vi.fn();
    provider.onStable(stable);
    await provider.connect();
    const silence = frame(0);
    const voice = frame(3200);
    for (let i = 0; i < 100; i++) provider.sendAudio(silence);
    expect(localRuntime.run).not.toHaveBeenCalled();
    for (let i = 0; i < 25; i++) provider.sendAudio(voice);
    for (let i = 0; i < 28; i++) provider.sendAudio(silence);
    await vi.waitFor(() => expect(stable).toHaveBeenCalledExactlyOnceWith("회의는 취소하지 않았습니다."));
    for (let i = 0; i < 100; i++) provider.sendAudio(silence);
    expect(localRuntime.run).toHaveBeenCalledTimes(1);
    await provider.disconnect();
  });
});
