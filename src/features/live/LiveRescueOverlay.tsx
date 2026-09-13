"use client";

import type { PrepSheet } from "@/types";
import type { EngineSnapshot } from "@/interpreter/engine/session";
import { RescueControl } from "./RescueControl";
import { useRescueCue } from "./useRescueCue";

export function LiveRescueOverlay({
  snapshot,
  prep,
  startedAt,
  sourceLanguage,
  targetLanguage,
}: {
  snapshot: EngineSnapshot;
  prep: PrepSheet;
  startedAt: number | null;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const rescue = useRescueCue({
    enabled: true,
    snapshot,
    // The session's own resolved context, not a hardcoded "sermon". Rescue is
    // only offered in a worship context, but it now says so by reading the
    // resolver rather than by asserting it.
    context: snapshot.context.resolved,
    sourceLanguage,
    targetLanguage,
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
