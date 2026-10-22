import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // /api/agent reads the recorded replays from disk; make sure they ship with the function.
  outputFileTracingIncludes: { "/api/agent": ["./public/replays/**"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    // The first brief used /run/<id>; every CLI run URL is /runs/<id>.
    return [
      { source: "/run/:id", destination: "/runs/:id", permanent: false },
      { source: "/run/:id/report", destination: "/runs/:id/report", permanent: false },
    ];
  },
};

export default nextConfig;
