import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Preview sandbox builder: /b/{port}/* -> backend Go (yang meneruskan
    // ke container Vite). Host-relative, jadi iframe jalan dari host mana pun.
    return [
      {
        source: "/b/:port/:path*",
        destination: `${process.env.BUILDER_API_URL ?? "http://localhost:8081"}/b/:port/:path*`,
      },
      {
        source: "/b/:port",
        destination: `${process.env.BUILDER_API_URL ?? "http://localhost:8081"}/b/:port/`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/lab/experiments/ui-ux/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/lab/experiments/ui-ux",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/vendor/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
