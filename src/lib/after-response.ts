import "server-only";
import { after } from "next/server";

/**
 * Run bookkeeping once the response has been sent.
 *
 * The Learning Vault write used to sit between persisting a Counter message
 * and answering the sender, which charged every immigration-desk turn one
 * extra Redis round trip of visible latency for a write nobody was waiting on.
 * Next's `after()` keeps the function alive for the task on Vercel; outside a
 * request scope (unit tests, scripts) the task simply runs detached. Either
 * way a failure is logged, never thrown into the response path.
 */
export function afterResponse(task: () => Promise<unknown>, label: string): void {
  const run = () =>
    task().catch(() => {
      console.warn(`${label} failed after the response was sent.`);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
