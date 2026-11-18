import type { Metadata } from "next";
import { SecretDesk } from "./SecretDesk";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "직원 전용 · 실시간 방문 목적 확인",
  description: "iPad와 연결된 창구별 실시간 접수 화면",
  robots: { index: false, follow: false, noarchive: true },
};

export default function SecretPage() {
  // No APP_ACCESS_KEY prompt. A random 256-bit capability scopes access to
  // each desk's own queue. This is session isolation, not staff identity.
  return <SecretDesk />;
}
