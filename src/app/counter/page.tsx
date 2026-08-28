import type { Metadata } from "next";
import { CounterHostScreen } from "@/features/counter/CounterHostScreen";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `현장 응대 · ${BRAND.name}`,
  description:
    "QR 코드를 보여주면 손님이 자기 휴대폰으로 참여하는 현장 응대 통역. 설치가 필요 없습니다.",
};

export default function CounterPage() {
  return <CounterHostScreen />;
}
