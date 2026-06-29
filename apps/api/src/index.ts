import { loadConfig } from "@agent/core";
import { buildServer } from "./server.js";

const config = loadConfig();
const app = await buildServer(config);

if (import.meta.url === `file://${process.argv[1]}`) {
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

export { app };
