import type { Metadata } from "next";
import { StartScreen } from "@/features/live/StartScreen";
import { BRAND } from "@/lib/brand";

const title = `라이브 통역 · ${BRAND.name}`;

export const metadata: Metadata = {
  title,
  description: BRAND.liveDescription,
  openGraph: {
    title,
    description: BRAND.liveDescription,
    url: "/live",
    siteName: BRAND.name,
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title,
    description: BRAND.liveDescription,
  },
};

export default function LivePage() {
  return <StartScreen />;
}
