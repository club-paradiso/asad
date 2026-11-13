import type { Metadata } from "next";
import { CounterHostScreen } from "@/features/counter/CounterHostScreen";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `1:1 대화 통역 · ${BRAND.name}`,
  description:
    "직원이 QR 코드를 보여주면 방문객이 자기 휴대폰으로 참여합니다. 서로 다른 언어로 말하거나 입력하며 대화를 번역해 확인하세요.",
};

export default function CounterPage() {
  return <CounterHostScreen />;
}
