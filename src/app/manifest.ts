import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} (${BRAND.shortName})`,
    short_name: BRAND.shortName,
    description: `${BRAND.tagline} ${BRAND.englishDescriptor}.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#06080b",
    theme_color: "#06080b",
    // The console is designed landscape-first for a phone propped beside an
    // interpreter, but portrait must still work, so orientation is not locked.
    orientation: "any",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
