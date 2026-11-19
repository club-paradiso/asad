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
  searchParams: Promise<{
    desk?: string | string[];
    display?: string | string[];
    station?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const code = typeof params.desk === "string" ? params.desk.trim().toUpperCase() : "";
  const query = new URLSearchParams();
  if (/^[A-HJ-NP-Z2-9]{10}$/.test(code)) {
    query.set("desk", code);
    if (params.display === "1") {
      query.set("display", "1");
      if (typeof params.station === "string" && /^(?:[1-9]|[12][0-9]|30)$/.test(params.station)) {
        query.set("station", params.station);
      }
    }
  }
  const encoded = query.toString();
  redirect("/compat/kiosk.html" + (encoded ? "?" + encoded : ""));
}
