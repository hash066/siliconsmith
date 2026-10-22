import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // /api/agent reads the recorded replays from disk; make sure they ship with the function.
  outputFileTracingIncludes: { "/api/agent": ["./public/replays/**", "./public/library/**"] },
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
  // Local only: with LOCAL_PYTHON_API=http://127.0.0.1:8765 (scripts/serve_api_local.py) the Board and Matter calls go to that server.
  // On Vercel the Python functions in api/ answer these paths themselves (see vercel.json) and this stays empty.
  async rewrites() {
    const t = process.env.LOCAL_PYTHON_API;
    return t
      ? [
          { source: "/api/board/:path*", destination: `${t}/api/board/:path*` },
          { source: "/api/matter/:path*", destination: `${t}/api/matter/:path*` },
        ]
      : [];
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
