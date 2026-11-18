"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./secret.module.css";

/**
 * Uses ASAD's existing rate-limited /api/session gate. No staff password is
 * placed in URL parameters, JS bundles, browser storage or client logs.
 */
export function SecretLogin() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ accessKey: key }),
      });
      if (!result.ok) {
        setMessage(
          result.status === 429
            ? "로그인 시도가 제한됐습니다. 잠시 후 다시 시도해 주세요."
            : "접근키를 확인할 수 없습니다.",
        );
        return;
      }
      setKey("");
      router.refresh();
    } catch {
      setMessage("네트워크 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.locked}>
      <p className={styles.tag}>ASAD / STAFF ACCESS</p>
      <h1>직원용 비공개 화면</h1>
      <p>접근키를 확인해야 직원 화면이 열립니다. 이 화면은 메인 메뉴에 표시되지 않습니다.</p>
      <form onSubmit={submit} className={styles.loginForm}>
        <label htmlFor="intake-secret">접근키</label>
        <input
          id="intake-secret"
          type="password"
          autoComplete="current-password"
          minLength={8}
          maxLength={256}
          required
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "확인 중…" : "직원 화면 열기"}
        </button>
      </form>
      {message && <p className={styles.warning} role="alert">{message}</p>}
      <p className={styles.disclaimer}>기관 승인 없이 실제 민원인 정보를 수집하지 마세요.</p>
    </main>
  );
}
