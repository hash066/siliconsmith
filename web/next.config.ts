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
  // Board checks and Matter simulation are served by the separate Python project (see scripts/package-api-host.mjs):
  // in a Next.js project Vercel's Next builder ignores root-level api/*.py. Proxying keeps the browser same-origin.
  // LOCAL_PYTHON_API (scripts/serve_api_local.py) overrides the target for local runs.
  async rewrites() {
    const target = process.env.LOCAL_PYTHON_API ?? "https://siliconsmith-api.vercel.app";
    return [
      { source: "/api/board/:path*", destination: `${target}/api/board/:path*` },
      { source: "/api/matter/:path*", destination: `${target}/api/matter/:path*` },
      // Live Silicon pipeline (Token Factory Sandboxes) is a streaming POST served by the same Python host.
      { source: "/api/silicon/:path*", destination: `${target}/api/silicon/:path*` },
    ];
  },
  async redirects() {
    // The first brief used /run/<id>; every CLI run URL is /runs/<id>.
    return [
      { source: "/how", destination: "/#how", permanent: false },
      { source: "/try", destination: "/app", permanent: false },
      { source: "/run/:id", destination: "/runs/:id", permanent: false },
      { source: "/run/:id/report", destination: "/runs/:id/report", permanent: false },
    ];
  },
};

export default nextConfig;
