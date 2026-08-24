import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: "tong-yuck — interpreter copilot",
  description:
    "A real-time AI copilot for human interpreters. Korean → English, built around the temporal and cognitive realities of simultaneous interpretation.",
  applicationName: "tong-yuck",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "tong-yuck",
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
    <html lang="en">
      <body className="min-h-[100dvh] antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
