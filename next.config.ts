import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    // Serve framework-free, ES5-compatible screens to every browser.
    // The same-origin Next.js API and capability checks remain unchanged.
    return {
      beforeFiles: [
        { source: "/intake", destination: "/compat/kiosk.html" },
        { source: "/secret", destination: "/compat/desk.html" },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/compat/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/intake",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/secret",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;