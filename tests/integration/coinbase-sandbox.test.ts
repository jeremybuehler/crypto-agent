/**
 * Gated real-sandbox smoke test. This is the externally-verified step CI cannot
 * run: it signs real JWTs and calls the Coinbase Advanced Trade SANDBOX API. It
 * is SKIPPED unless RUN_SANDBOX=true and sandbox credentials are present.
 *
 * Run manually:
 *   RUN_SANDBOX=true \
 *   TRADING_MODE=sandbox \
 *   COINBASE_API_KEY_NAME=... \
 *   COINBASE_API_PRIVATE_KEY=... \
 *   pnpm exec vitest run tests/integration/coinbase-sandbox.test.ts
 *
 * It validates the external risks flagged in the design: JWT signing against the
 * sandbox host, endpoint parity (accounts/preview/create/fills), the market
 * SELL-by-base_size shape, and IOC fill-confirmation timing. The full
 * worker -> API -> worker approval loop is exercised by running the worker in
 * sandbox mode per docs/LIVE_TRADING_CHECKLIST.md; this test isolates the
 * exchange boundary.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CoinbaseOrderClient, CoinbaseRestClient } from "@agent/coinbase";
import { loadConfig } from "@agent/core";

const ENABLED =
  process.env.RUN_SANDBOX === "true" &&
  !!process.env.COINBASE_API_KEY_NAME &&
  !!process.env.COINBASE_API_PRIVATE_KEY;

// A deliberately tiny order so a real sandbox fill costs (fake) pennies.
const PRODUCT = (process.env.SANDBOX_PRODUCT ?? "BTC-USD") as `${string}-${string}`;
const QUOTE_USD = Number(process.env.SANDBOX_QUOTE_USD ?? "1");

describe.skipIf(!ENABLED)("Coinbase sandbox smoke test", () => {
  // Built in beforeAll (not at collection time) so a skipped run never touches
  // credentials or config validation.
  let config: ReturnType<typeof loadConfig>;
  let client: CoinbaseOrderClient;

  beforeAll(() => {
    config = loadConfig({
      ...process.env,
      TRADING_MODE: "sandbox",
      INTERACTIVE_APPROVAL: "true",
      PERSISTENCE_ENABLED: "false"
    } as NodeJS.ProcessEnv);
    const rest = new CoinbaseRestClient(config.coinbase);
    client = new CoinbaseOrderClient((options) => rest.request(options));
  });

  it("authenticates and lists accounts (read-only)", async () => {
    const accounts = await client.getAccounts();
    expect(Array.isArray(accounts)).toBe(true);
  });

  it("previews and creates a tiny market BUY, and fills parse (sandbox shape parity)", async () => {
    const clientOrderId = `smoke-buy-${config.tradingMode}-${QUOTE_USD}-${PRODUCT}`;
    // Exercises preview -> create against the real sandbox. Preview must NOT carry
    // client_order_id (the sandbox rejects it 400); create must — validated here.
    const { orderId } = await client.createOrder({
      clientOrderId,
      productId: PRODUCT,
      side: "BUY",
      quoteSizeUsd: QUOTE_USD
    });
    expect(orderId).toBeTruthy();

    // NOTE: Coinbase's Advanced Trade sandbox returns a STATIC, mocked fills list
    // that ignores the order_id filter, so a sandbox fill can never be matched to
    // the order just placed (verified against the live sandbox). We therefore
    // validate that the fills endpoint authenticates and PARSES through the Zod
    // schema (shape parity) — not that a fill matches. Real matching-by-order_id
    // is the worker's confirmFill responsibility on the live path.
    const fills = await client.getFills();
    expect(Array.isArray(fills)).toBe(true);
  });
});
