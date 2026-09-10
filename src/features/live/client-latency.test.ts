import { describe, expect, it } from "vitest";
import { ClientLatencyQueue } from "./client-latency";

describe("ClientLatencyQueue", () => {
  it("stores timing only and acknowledges a piggybacked batch", () => {
    const queue = new ClientLatencyQueue("test");
    queue.add("stable_to_safe", 1234.4, "openrouter", "model-x");
    queue.add("stable_to_render", 1301.8, "openrouter", "model-x");
    const batch = queue.batch();
    expect(batch).toHaveLength(2);
    expect(batch[0]).toEqual({ id: "test-1", stage: "stable_to_safe", ms: 1234, provider: "openrouter", model: "model-x" });
    expect(JSON.stringify(batch)).not.toContain("transcript");
    queue.acknowledge([batch[0].id]);
    expect(queue.batch()).toHaveLength(1);
  });

  it("bounds an offline queue and rejects impossible durations", () => {
    const queue = new ClientLatencyQueue("bounded");
    expect(queue.add("stable_to_safe", -1)).toBeNull();
    for (let i = 0; i < 30; i += 1) queue.add("stable_to_render", i);
    expect(queue.size).toBe(24);
  });
});
