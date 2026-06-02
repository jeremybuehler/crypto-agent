import { describe, expect, it, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeAIContextProvider } from "@agent/ai";

const DENYLIST = ["apiKey", "privateKey", "jwt", "accountId", "secret", "token", "password", "credential"];

const validInput = {
  productId: "BTC-USD",
  timeframe: "1m",
  features: { momentumPct: 2.1, volatilityPercentile: 30, spreadBps: 8 },
  portfolioState: { dailyPnlPct: 0, totalExposurePct: 0 },
  riskPolicy: { maxTradeNotionalUsd: 25, maxDailyLossPct: 1 }
};

const validContext = {
  marketRegime: "trend",
  summary: "Bullish trend in BTC-USD.",
  riskNotes: [],
  bullishFactors: ["positive momentum"],
  bearishFactors: [],
  doNotTrade: false,
  doNotTradeReasons: [],
  confidence: 0.7
};

const validToolResponse = {
  content: [{ type: "tool_use", id: "tu_1", name: "report_market_context", input: validContext }],
  stop_reason: "tool_use"
};

function makeProvider(mockCreate: ReturnType<typeof vi.fn>) {
  const fakeClient = { messages: { create: mockCreate } } as unknown as Anthropic;
  return new ClaudeAIContextProvider("sk-test", "claude-sonnet-4-6", fakeClient);
}

describe("ClaudeAIContextProvider", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate = vi.fn();
  });

  it("returns a valid AIContext when Claude responds with a well-formed tool call", async () => {
    mockCreate.mockResolvedValueOnce(validToolResponse);

    const ctx = await makeProvider(mockCreate).generateContext(validInput);

    expect(ctx.doNotTrade).toBe(false);
    expect(ctx.marketRegime).toBe("trend");
    expect(ctx.confidence).toBeGreaterThan(0);
  });

  it("returns doNotTrade=true when schema validation fails", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "report_market_context",
          input: { marketRegime: "INVALID_REGIME", confidence: "not-a-number" }
        }
      ]
    });

    const ctx = await makeProvider(mockCreate).generateContext(validInput);

    expect(ctx.doNotTrade).toBe(true);
    expect(ctx.confidence).toBe(0);
  });

  it("returns doNotTrade=true when the API throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("rate limit exceeded"));

    const ctx = await makeProvider(mockCreate).generateContext(validInput);

    expect(ctx.doNotTrade).toBe(true);
    expect(ctx.riskNotes[0]).toContain("rate limit");
  });

  it("returns doNotTrade=true when no tool_use block is present", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I cannot assess the market right now." }]
    });

    const ctx = await makeProvider(mockCreate).generateContext(validInput);

    expect(ctx.doNotTrade).toBe(true);
  });

  it("never includes denylisted field names in the prompt sent to Claude", async () => {
    mockCreate.mockResolvedValueOnce(validToolResponse);

    await makeProvider(mockCreate).generateContext({
      ...validInput,
      features: { ...validInput.features, apiKey: "should-be-stripped", secret: "also-stripped" }
    });

    const call = mockCreate.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const promptText = JSON.stringify(call).toLowerCase();
    for (const denied of DENYLIST) {
      expect(promptText).not.toContain(`"${denied.toLowerCase()}":`);
    }
  });
});
