import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normaliseCode } from "@/counter/codes";
import { CounterGuestScreen } from "@/features/counter/CounterGuestScreen";

/**
 * The address behind the QR code. Deliberately short — `/c/AC34` — because QR
 * density is what decides whether a code scans across a counter in bad light.
 */
export const metadata: Metadata = {
  title: "tong-yuck",
  description: "Talk to the staff member in your own language.",
  // A join link is a private conversation; it should not be indexed.
  robots: { index: false, follow: false },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalised = normaliseCode(decodeURIComponent(code));
  // A malformed code is a 404, not an error screen: the session it names could
  // never have existed.
  if (!normalised) notFound();

  return <CounterGuestScreen code={normalised} />;
}
