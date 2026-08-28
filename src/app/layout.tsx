import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import "./public-ui.css";
import { ServiceWorker } from "@/components/ServiceWorker";
import { BRAND, BRAND_TITLE } from "@/lib/brand";

/**
 * Two faces, self-hosted.
 *
 * `next/font` downloads these at BUILD time and serves them from this origin,
 * which is the point: a booth on church wifi cannot afford a blocking request
 * to fonts.gstatic.com ninety seconds before a service, and the service worker
 * can only cache what this origin serves.
 *
 * Latin only, deliberately. Hangul stays on the system stack below — Apple SD
 * Gothic Neo and Pretendard are better Korean faces than anything worth
 * shipping a megabyte for, and the original metrics tuning was done against
 * them.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--ff-display",
  display: "swap",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--ff-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tong-yuck.vercel.app"),
  title: BRAND_TITLE,
  description: BRAND.description,
  applicationName: BRAND.shortName,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: BRAND_TITLE,
    description: BRAND.description,
    url: "/",
    siteName: BRAND.name,
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: BRAND_TITLE,
    description: BRAND.description,
  },
  appleWebApp: {
    capable: true,
    title: BRAND.shortName,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  // The console is a fixed-viewport application. Pinch-zoom on a live console
  // loses the interpreter their layout mid-sentence, and the font-scale
  // control does the job properly instead.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#06080b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-[100dvh] antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
