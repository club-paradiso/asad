import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "방문 목적 사전 안내 · 제주출입국·외국인청 (시범)",
  description: "직원 창구에 연결하여 방문 목적을 선택합니다.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ desk?: string | string[] }>;
}) {
  const params = await searchParams;
  const code = typeof params.desk === "string" ? params.desk.trim().toUpperCase() : "";
  const param = /^[A-HJ-NP-Z2-9]{10}$/.test(code)
    ? "?desk=" + encodeURIComponent(code)
    : "";
  redirect("/compat/kiosk.html" + param);
}
