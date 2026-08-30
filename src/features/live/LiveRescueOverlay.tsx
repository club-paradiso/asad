"use client";

import type { PrepSheet } from "@/types";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { RescueControl } from "./RescueControl";
import { useRescueCue } from "./useRescueCue";

export function LiveRescueOverlay({
  snapshot,
  prep,
  startedAt,
}: {
  snapshot: EngineSnapshot;
  prep: PrepSheet;
  startedAt: number | null;
}) {
  const rescue = useRescueCue({
    enabled: true,
    snapshot,
    mode: "sermon",
    prep,
    startedAt,
  });

  return (
    <div className="absolute bottom-3 right-3 z-10 max-w-[min(90vw,32rem)]">
      <RescueControl
        state={rescue.state}
        onTrigger={() => void rescue.trigger()}
        onClear={rescue.clear}
      />
    </div>
  );
}
