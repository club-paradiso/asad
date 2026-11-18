import type { Metadata } from "next";
import { VisitorIntake } from "./VisitorIntake";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "방문 목적 사전 안내 · 제주출입국·외국인청 (시범)",
  description: "언어와 방문 목적을 선택해 직원용 창구 화면으로 전달합니다.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ desk?: string | string[] }>;
}) {
  const params = await searchParams;
  const code = typeof params.desk === "string" ? params.desk.trim().toUpperCase() : "";
  return <VisitorIntake initialCode={/^[A-HJ-NP-Z2-9]{10}$/.test(code) ? code : ""} />;
}
