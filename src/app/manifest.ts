import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} (${BRAND.shortName})`,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Ink, not the console's near-black. The first screen a launched PWA
    // shows is the paper launcher, and the splash/chrome should belong to the
    // brand rather than to the one surface that happens to run dark.
    background_color: "#12100e",
    theme_color: "#12100e",
    // The console is designed landscape-first for a phone propped beside an
    // interpreter, but portrait must still work, so orientation is not locked.
    orientation: "any",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      // Square brand icon on a light ground, for listing surfaces that show
      // the icon against their own chrome rather than a home screen.
      { src: "/icons/brand-600.png", sizes: "600x600", type: "image/png", purpose: "any" },
    ],
  };
}
