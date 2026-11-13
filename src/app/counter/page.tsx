import type { Metadata } from "next";
import { CounterHostScreen } from "@/features/counter/CounterHostScreen";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `실시간 대화 통역 · ${BRAND.name}`,
  description:
    "직원과 방문자가 각자의 언어로 대화할 수 있는 실시간 대화 통역. QR코드로 참여하며 앱 설치가 필요 없습니다.",
};

export default function CounterPage() {
  return <CounterHostScreen />;
}
