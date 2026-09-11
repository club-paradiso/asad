import { describe, expect, it } from "vitest";
import {
  createTurn,
  enqueueContextual,
  MAX_COALESCED_CHARS,
  MAX_COALESCED_TURNS,
  settleProvisional,
  unitText,
  unitTurnIds,
  type LogicalTurn,
} from "./turns";

const turn = (id: number, text = `turn ${id}`): LogicalTurn =>
  createTurn({
    id,
    text,
    stableAt: id * 1000,
    boundary: "sentence",
    continuesPrevious: false,
    provisional: "pending",
  });

describe("provisional settlement", () => {
  it("settles a lane-off turn immediately", async () => {
    const off = createTurn({ id: 1, text: "x", stableAt: 0, boundary: "quiet", continuesPrevious: false, provisional: "off" });
    await expect(off.provisionalSettled).resolves.toBe("off");
  });

  it("settles exactly when the state is assigned", async () => {
    const pending = turn(1);
    let settled: string | null = null;
    void pending.provisionalSettled.then((state) => {
      settled = state;
    });
    await Promise.resolve();
    expect(settled).toBeNull();
    settleProvisional(pending, "applied");
    await expect(pending.provisionalSettled).resolves.toBe("applied");
    expect(pending.provisional).toBe("applied");
  });
});

describe("coalesced contextual unit", () => {
  it("starts a unit from one turn", () => {
    const { unit, dropped } = enqueueContextual(null, turn(1));
    expect(unitTurnIds(unit)).toEqual([1]);
    expect(dropped).toEqual([]);
  });

  it("appends in order and joins the Korean with a space", () => {
    let unit = enqueueContextual(null, turn(1, "하나")).unit;
    unit = enqueueContextual(unit, turn(2, "둘")).unit;
    expect(unitText(unit)).toBe("하나 둘");
  });

  it("drops the oldest turn past the turn bound", () => {
    let unit = null as ReturnType<typeof enqueueContextual>["unit"] | null;
    const droppedAll: number[] = [];
    for (let id = 1; id <= MAX_COALESCED_TURNS + 3; id += 1) {
      const result = enqueueContextual(unit, turn(id));
      unit = result.unit;
      droppedAll.push(...result.dropped.map((t) => t.id));
    }
    expect(unit!.turns).toHaveLength(MAX_COALESCED_TURNS);
    expect(droppedAll).toEqual([1, 2, 3]);
    expect(unitTurnIds(unit!)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("drops the oldest turn past the character bound but never the last one", () => {
    const long = "가".repeat(MAX_COALESCED_CHARS - 10);
    let unit = enqueueContextual(null, turn(1, long)).unit;
    const result = enqueueContextual(unit, turn(2, "나".repeat(100)));
    unit = result.unit;
    expect(result.dropped.map((t) => t.id)).toEqual([1]);
    expect(unitTurnIds(unit)).toEqual([2]);

    const huge = enqueueContextual(null, turn(3, "다".repeat(MAX_COALESCED_CHARS + 500)));
    expect(huge.dropped).toEqual([]);
    expect(unitTurnIds(huge.unit)).toEqual([3]);
  });
});
