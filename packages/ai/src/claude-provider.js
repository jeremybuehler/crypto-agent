import Anthropic from "@anthropic-ai/sdk";
import { AIContextSchema } from "./index.js";
const DENYLIST = ["apiKey", "privateKey", "jwt", "accountId", "secret", "token", "password", "credential"];
const MARKET_CONTEXT_TOOL = {
    name: "report_market_context",
    description: "Report your structured market context assessment.",
    input_schema: {
        type: "object",
        properties: {
            marketRegime: {
                type: "string",
                enum: ["trend", "range", "high_volatility", "illiquid", "unknown"],
                description: "Current market regime classification."
            },
            summary: { type: "string", description: "One or two sentence summary of current market conditions." },
            riskNotes: { type: "array", items: { type: "string" }, description: "Notable risk factors to flag for the operator." },
            bullishFactors: { type: "array", items: { type: "string" } },
            bearishFactors: { type: "array", items: { type: "string" } },
            doNotTrade: { type: "boolean", description: "True if conditions are unsafe or unclear for trading." },
            doNotTradeReasons: { type: "array", items: { type: "string" } },
            confidence: { type: "number", description: "Confidence in this assessment, 0 to 1." }
        },
        required: ["marketRegime", "summary", "riskNotes", "bullishFactors", "bearishFactors", "doNotTrade", "doNotTradeReasons", "confidence"]
    }
};
function buildPrompt(input) {
    const safeFeatures = Object.fromEntries(Object.entries(input.features).filter(([key]) => !DENYLIST.some((d) => key.toLowerCase().includes(d))));
    const safePortfolio = Object.fromEntries(Object.entries(input.portfolioState).filter(([key]) => !DENYLIST.some((d) => key.toLowerCase().includes(d))));
    const safePolicy = Object.fromEntries(Object.entries(input.riskPolicy).filter(([key]) => !DENYLIST.some((d) => key.toLowerCase().includes(d))));
    return [
        `You are a conservative crypto trading context agent. Assess whether conditions are safe to trade.`,
        ``,
        `Product: ${input.productId}  Timeframe: ${input.timeframe}`,
        ``,
        `Market features:`,
        JSON.stringify(safeFeatures, null, 2),
        ``,
        `Portfolio state:`,
        JSON.stringify(safePortfolio, null, 2),
        ``,
        `Risk policy limits:`,
        JSON.stringify(safePolicy, null, 2),
        ``,
        `Call report_market_context with your structured assessment. When in doubt, set doNotTrade=true.`
    ].join("\n");
}
function conservativeFallback(reason) {
    return {
        marketRegime: "unknown",
        summary: `Context provider error: ${reason}. Defaulting to do-not-trade.`,
        riskNotes: [reason],
        bullishFactors: [],
        bearishFactors: [],
        doNotTrade: true,
        doNotTradeReasons: [`Context provider failed: ${reason}`],
        confidence: 0
    };
}
export class ClaudeAIContextProvider {
    client;
    model;
    constructor(apiKey, model = "claude-sonnet-4-6", client) {
        this.client = client ?? new Anthropic({ apiKey });
        this.model = model;
    }
    async generateContext(input) {
        let response;
        try {
            response = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024,
                tools: [MARKET_CONTEXT_TOOL],
                tool_choice: { type: "tool", name: "report_market_context" },
                messages: [{ role: "user", content: buildPrompt(input) }]
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return conservativeFallback(`API error: ${message}`);
        }
        const toolBlock = response.content.find((b) => b.type === "tool_use");
        if (!toolBlock) {
            return conservativeFallback("No tool_use block in response");
        }
        const parsed = AIContextSchema.safeParse(toolBlock.input);
        if (!parsed.success) {
            return conservativeFallback(`Schema validation failed: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
        }
        return parsed.data;
    }
}
