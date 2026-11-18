import type { Metadata } from "next";
import { cookies } from "next/headers";
import { appEnv } from "@/lib/env";
import { ACCESS_COOKIE, secretsMatch } from "@/lib/guard";
import { SecretLogin } from "./SecretLogin";
import { SecretDesk } from "./SecretDesk";
import styles from "./secret.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "직원 전용 · 방문 목적 확인",
  description: "ASAD 내부의 비공개 직원용 시범 화면",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function SecretPage() {
  // APP_ACCESS_KEY is optional for ASAD generally, but NEVER for this page.
  // Missing or invalid configuration fails closed, with no staff dashboard.
  const configured = appEnv().access.key;
  if (!configured) {
    return (
      <main className={styles.locked}>
        <h1>비공개 직원 화면이 비활성화되어 있습니다.</h1>
        <p>운영자만 접근할 수 있도록 서버에 APP_ACCESS_KEY를 설정해야 합니다.</p>
        <p>접근키가 없는 배포에서는 직원 화면이 표시되지 않습니다.</p>
      </main>
    );
  }

  const jar = await cookies();
  const supplied = jar.get(ACCESS_COOKIE)?.value;
  const authenticated = !!supplied && secretsMatch(supplied, configured);

  return authenticated ? <SecretDesk /> : <SecretLogin />;
}
