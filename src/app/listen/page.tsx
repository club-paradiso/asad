import type { Metadata } from "next";
import { EarbudScreen } from "@/features/earbud/EarbudScreen";

export const metadata: Metadata = {
  title: "이어폰 실시간 통역 · ASAD",
  description: "상대방의 외국어 발화를 한국어 자막과 이어폰 음성으로 확인하는 실험적 통역 모드",
};

export default function ListenPage() {
  return <EarbudScreen />;
}
