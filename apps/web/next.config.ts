import "@test-evals/env/web";
import type { NextConfig } from "next";
import { env } from "@test-evals/env/web";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  async rewrites() {
    const api = env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");
    return [
      // Keep Better Auth same-origin to the web app on Render. This avoids
      // third-party cookie issues between *.onrender.com subdomains.
      {
        source: "/api/auth/:path*",
        destination: `${api}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
