import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `/api/*` is handled by the server-side proxy route
 * (src/app/api/[...path]/route.ts) which injects the operator token. We do not
 * rewrite directly to the API, because that would require the unauthenticated
 * request to carry the secret in the browser.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Emit a self-contained server bundle for Docker (`.next/standalone`), traced
  // from the monorepo root so pnpm-workspace deps are included.
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../..")
};

export default nextConfig;
