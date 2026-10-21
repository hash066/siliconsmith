import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    // The first brief used /run/<id>; every CLI run URL is /runs/<id>.
    return [
      { source: "/run/:id", destination: "/runs/:id", permanent: false },
      { source: "/run/:id/report", destination: "/runs/:id/report", permanent: false },
    ];
  },
};

export default nextConfig;
