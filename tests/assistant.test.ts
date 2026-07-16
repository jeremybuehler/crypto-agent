/**
 * Educational assistant: glossary canon, the deterministic no-key fallback,
 * and the Claude tool loop (with a fake Anthropic client) — including the
 * read-only tool-belt boundary and input validation.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeAssistant,
  DeterministicAssistant,
  createAssistant,
  lookupTerm,
  listGlossaryTerms,
  type AssistantToolExecutor,
  type Learner
} from "@agent/ai";

const HUNTER: Learner = { id: "hunter", name: "Hunter", level: "beginner" };
const JEREMY: Learner = { id: "jeremy", name: "Jeremy", level: "advanced" };
const TRADE_ID = "8dcaff21-8ac3-4dd9-bffa-be95cb6c6b34";

function fakeTools(): AssistantToolExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async explainTrade(correlationId: string) {
      calls.push(`explainTrade:${correlationId}`);
      return { proposal: { id: correlationId, status: "executed" }, fill: { price: 100.7 } };
    },
    async buildReportCard() {
      calls.push("buildReportCard");
      return { totalTrades: 4, realizedPnl: -2.67 };
    },
    async getPortfolioState() {
      calls.push("getPortfolioState");
      return { tradingMode: "sandbox", portfolio: { equityUsd: 1000 } };
    }
  };
}

describe("glossary", () => {
  it("every entry has definition, why-it-matters, and a reference link", () => {
    for (const term of listGlossaryTerms()) {
      const entry = lookupTerm(term);
      expect(entry, term).not.toBeNull();
      expect(entry!.definition.length).toBeGreaterThan(20);
      expect(entry!.whyItMatters.length).toBeGreaterThan(20);
      expect(entry!.reference).toMatch(/^https:\/\//);
    }
  });

  it("resolves case, whitespace, and aliases", () => {
    expect(lookupTerm("  MACD ")?.term).toBe("MACD");
    expect(lookupTerm("ema")?.term).toContain("EMA");
    expect(lookupTerm("bps")?.term).toContain("basis points");
    expect(lookupTerm("PnL")?.term).toContain("PnL");
    expect(lookupTerm("no-such-term-xyz")).toBeNull();
  });
});

describe("DeterministicAssistant (no-key fallback)", () => {
  it("serves the trade story when a correlation id is present", async () => {
    const tools = fakeTools();
    const result = await new DeterministicAssistant(tools).ask({
      question: "why did this trade happen?",
      learner: HUNTER,
      correlationId: TRADE_ID
    });
    expect(result.fallback).toBe(true);
    expect(result.toolsUsed).toContain("explain_trade");
    expect(result.answer).toContain(TRADE_ID);
    expect(tools.calls).toContain(`explainTrade:${TRADE_ID}`);
  });

  it("serves a glossary entry for a term question", async () => {
    const result = await new DeterministicAssistant(fakeTools()).ask({
      question: "slippage",
      learner: HUNTER
    });
    expect(result.toolsUsed).toContain("define_term");
    expect(result.answer).toContain("price you expected");
  });

  it("serves portfolio + report card for a generic question, with enable-AI hint", async () => {
    const result = await new DeterministicAssistant(fakeTools()).ask({
      question: "how are we doing?",
      learner: JEREMY
    });
    expect(result.toolsUsed).toEqual(expect.arrayContaining(["get_portfolio_state", "build_report_card"]));
    expect(result.answer).toContain("ANTHROPIC_API_KEY");
  });
});

describe("ClaudeAssistant tool loop", () => {
  function textResponse(text: string) {
    return { stop_reason: "end_turn", content: [{ type: "text", text }] };
  }

  function toolUseResponse(name: string, input: Record<string, unknown>, id = "toolu_1") {
    return { stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] };
  }

  it("runs the tool loop: fetches the story then answers grounded", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("explain_trade", { correlationId: TRADE_ID }))
      .mockResolvedValueOnce(textResponse("The trade executed at $100.70 because the trend confirmed."));
    const client = { messages: { create } } as never;
    const tools = fakeTools();

    const assistant = new ClaudeAssistant("test-key", tools, "claude-opus-4-8", client);
    const result = await assistant.ask({ question: "explain", learner: HUNTER, correlationId: TRADE_ID });

    expect(result.fallback).toBe(false);
    expect(result.toolsUsed).toEqual(["explain_trade"]);
    expect(result.answer).toContain("$100.70");
    // The second request must carry the tool result back.
    const secondCall = create.mock.calls[1]![0];
    const toolResultTurn = secondCall.messages.at(-1);
    expect(toolResultTurn.role).toBe("user");
    expect(toolResultTurn.content[0].type).toBe("tool_result");
    expect(toolResultTurn.content[0].content).toContain("executed");
  });

  it("adapts the system prompt to the learner", async () => {
    const create = vi.fn().mockResolvedValue(textResponse("hi"));
    const client = { messages: { create } } as never;
    const assistant = new ClaudeAssistant("test-key", fakeTools(), "claude-opus-4-8", client);

    await assistant.ask({ question: "what is a candle?", learner: HUNTER });
    expect(create.mock.calls[0]![0].system).toContain("Hunter is a beginner");

    await assistant.ask({ question: "what is a candle?", learner: JEREMY });
    expect(create.mock.calls[1]![0].system).toContain("Jeremy is technical");
  });

  it("rejects invalid tool input with an is_error result instead of executing", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("explain_trade", { correlationId: "not-a-uuid" }))
      .mockResolvedValueOnce(textResponse("I could not fetch that trade."));
    const client = { messages: { create } } as never;
    const tools = fakeTools();

    const assistant = new ClaudeAssistant("test-key", tools, "claude-opus-4-8", client);
    await assistant.ask({ question: "explain", learner: HUNTER });

    expect(tools.calls).toEqual([]); // executor never reached
    const toolResultTurn = create.mock.calls[1]![0].messages.at(-1);
    expect(toolResultTurn.content[0].is_error).toBe(true);
  });

  it("answers define_term locally from the canonical glossary", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("define_term", { term: "MACD" }))
      .mockResolvedValueOnce(textResponse("MACD is..."));
    const client = { messages: { create } } as never;

    const assistant = new ClaudeAssistant("test-key", fakeTools(), "claude-opus-4-8", client);
    await assistant.ask({ question: "what is macd?", learner: HUNTER });

    const toolResultTurn = create.mock.calls[1]![0].messages.at(-1);
    expect(toolResultTurn.content[0].content).toContain("Moving Average Convergence Divergence");
  });

  it("falls back to deterministic data when the API errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("model overloaded"));
    const client = { messages: { create } } as never;
    const tools = fakeTools();

    const assistant = new ClaudeAssistant("test-key", tools, "claude-opus-4-8", client);
    const result = await assistant.ask({ question: "how are we doing?", learner: JEREMY });

    expect(result.fallback).toBe(true);
    expect(result.answer).toContain("model overloaded");
    expect(result.answer).toContain("tradingMode");
  });
});

describe("createAssistant", () => {
  it("chooses the deterministic assistant without a key and Claude with one", () => {
    expect(createAssistant(undefined, fakeTools())).toBeInstanceOf(DeterministicAssistant);
    expect(createAssistant("sk-ant-test", fakeTools())).toBeInstanceOf(ClaudeAssistant);
  });
});
