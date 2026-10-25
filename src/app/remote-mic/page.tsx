import type { Metadata, Viewport } from "next";
import { RemoteMicSenderScreen } from "@/features/remote-mic/RemoteMicSenderScreen";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `원격 마이크 · ${BRAND.name}`,
  description: "Use an iPhone as a wireless microphone for ASAD on a MacBook.",
  // A pairing page is a credential holder; keep it out of every index.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RemoteMicPage() {
  return <RemoteMicSenderScreen />;
}
