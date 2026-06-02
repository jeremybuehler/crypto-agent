import Anthropic from "@anthropic-ai/sdk";
import { type AIContext, type AIContextInput, type AIContextProvider } from "./index.js";
export declare class ClaudeAIContextProvider implements AIContextProvider {
    private readonly client;
    private readonly model;
    constructor(apiKey: string, model?: string, client?: Anthropic);
    generateContext(input: AIContextInput): Promise<AIContext>;
}
