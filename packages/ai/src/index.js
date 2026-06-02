import { z } from "zod";
export const AIContextSchema = z.object({
    marketRegime: z.enum(["trend", "range", "high_volatility", "illiquid", "unknown"]),
    summary: z.string(),
    riskNotes: z.array(z.string()),
    bullishFactors: z.array(z.string()),
    bearishFactors: z.array(z.string()),
    doNotTrade: z.boolean(),
    doNotTradeReasons: z.array(z.string()),
    confidence: z.number().min(0).max(1)
});
export { ClaudeAIContextProvider } from "./claude-provider.js";
export class ConservativeStubAIContextProvider {
    async generateContext(input) {
        const volatility = Number(input.features.volatilityPercentile ?? 100);
        const spreadBps = Number(input.features.spreadBps ?? 999);
        const doNotTrade = volatility > 85 || spreadBps > 20;
        return {
            marketRegime: doNotTrade ? "high_volatility" : "unknown",
            summary: "Stub context provider: no external LLM configured. Defaulting to conservative market interpretation.",
            riskNotes: doNotTrade ? ["Volatility or spread is above conservative threshold."] : ["No LLM provider configured."],
            bullishFactors: [],
            bearishFactors: [],
            doNotTrade,
            doNotTradeReasons: doNotTrade ? ["Conservative stub blocked trading due to market conditions."] : [],
            confidence: 0.25
        };
    }
}
