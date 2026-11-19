import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "직원 전용 · 실시간 방문 목적 확인",
  description: "iPad와 연결된 창구별 접수 화면",
  robots: { index: false, follow: false, noarchive: true },
};

// Explicit server redirect avoids Next.js 16 hydration on old iPad/Safari.
export default function SecretPage() {
  redirect("/compat/desk.html");
}
