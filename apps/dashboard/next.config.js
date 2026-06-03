import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../.."),
  async rewrites() {
    const apiUrl = process.env.AGENT_API_URL ?? "http://localhost:3000";
    return [
      { source: "/api/:path*", destination: `${apiUrl}/:path*` }
    ];
  }
};

export default nextConfig;
