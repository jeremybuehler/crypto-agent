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
  // Standalone output is only for the Docker image (infra/Dockerfile) — it's
  // incompatible with `next start`, which is how Railway (Nixpacks) runs this.
  // Opt in with NEXT_OUTPUT_STANDALONE=1 when building the Docker image.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
    ? { output: "standalone", outputFileTracingRoot: resolve(__dirname, "../..") }
    : {})
};

export default nextConfig;
