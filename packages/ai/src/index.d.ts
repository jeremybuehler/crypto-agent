import { z } from "zod";
export declare const AIContextSchema: z.ZodObject<{
    marketRegime: z.ZodEnum<["trend", "range", "high_volatility", "illiquid", "unknown"]>;
    summary: z.ZodString;
    riskNotes: z.ZodArray<z.ZodString, "many">;
    bullishFactors: z.ZodArray<z.ZodString, "many">;
    bearishFactors: z.ZodArray<z.ZodString, "many">;
    doNotTrade: z.ZodBoolean;
    doNotTradeReasons: z.ZodArray<z.ZodString, "many">;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    marketRegime: "unknown" | "trend" | "range" | "high_volatility" | "illiquid";
    summary: string;
    riskNotes: string[];
    bullishFactors: string[];
    bearishFactors: string[];
    doNotTrade: boolean;
    doNotTradeReasons: string[];
    confidence: number;
}, {
    marketRegime: "unknown" | "trend" | "range" | "high_volatility" | "illiquid";
    summary: string;
    riskNotes: string[];
    bullishFactors: string[];
    bearishFactors: string[];
    doNotTrade: boolean;
    doNotTradeReasons: string[];
    confidence: number;
}>;
export type AIContext = z.infer<typeof AIContextSchema>;
export interface AIContextInput {
    productId: string;
    timeframe: string;
    features: Record<string, number | string | boolean>;
    portfolioState: Record<string, number | string | boolean>;
    riskPolicy: Record<string, number | string | boolean>;
}
export interface AIContextProvider {
    generateContext(input: AIContextInput): Promise<AIContext>;
}
export { ClaudeAIContextProvider } from "./claude-provider.js";
export declare class ConservativeStubAIContextProvider implements AIContextProvider {
    generateContext(input: AIContextInput): Promise<AIContext>;
}
