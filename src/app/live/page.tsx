import type { Metadata } from "next";
import { StartScreen } from "@/features/live/StartScreen";

export const metadata: Metadata = {
  title: "라이브 통역 · tong-yuck",
  description:
    "Korean → English live interpretation console. Readiness, audio source and lag are settled here, before the first word.",
};

export default function LivePage() {
  return <StartScreen />;
}
