import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true
  },
  resolve: {
    alias: {
      "@agent/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@agent/ai": new URL("./packages/ai/src/index.ts", import.meta.url).pathname,
      "@agent/coinbase": new URL("./packages/coinbase/src/index.ts", import.meta.url).pathname,
      "@agent/market-data": new URL("./packages/market-data/src/index.ts", import.meta.url).pathname,
      "@agent/strategy": new URL("./packages/strategy/src/index.ts", import.meta.url).pathname,
      "@agent/risk": new URL("./packages/risk/src/index.ts", import.meta.url).pathname,
      "@agent/execution": new URL("./packages/execution/src/index.ts", import.meta.url).pathname,
      "@agent/persistence": new URL("./packages/persistence/src/index.ts", import.meta.url).pathname,
      "@agent/backtest": new URL("./packages/backtest/src/index.ts", import.meta.url).pathname
    }
  }
});
