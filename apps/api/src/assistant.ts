/**
 * Educational assistant wiring: the read-only tool executor over the operator
 * repository, and the /assistant/ask route. The executor is the authority
 * boundary — it exposes only repository reads, so no assistant code path can
 * reach ops controls, proposal decisions, or execution.
 */
import {
  AssistantAskSchema,
  createAssistant,
  type AssistantToolExecutor,
  type AssistantAnswer
} from "@agent/ai";
import type { AgentConfig } from "@agent/core";
import { computeRealizedMetrics, type OperatorRepository } from "@agent/persistence";

const REPORT_CARD_FILLS = 20;

export function buildAssistantTools(repo: OperatorRepository, config: AgentConfig): AssistantToolExecutor {
  return {
    async explainTrade(correlationId: string): Promise<Record<string, unknown>> {
      const story = await repo.getTradeStory(correlationId);
      return story as unknown as Record<string, unknown>;
    },

    async buildReportCard(): Promise<Record<string, unknown>> {
      const fills = await repo.listRecentFills(REPORT_CARD_FILLS);
      const metrics = computeRealizedMetrics(fills);
      return {
        ...metrics,
        recentFills: fills.map((fill) => ({
          productId: fill.productId,
          side: fill.side,
          quoteSizeUsd: fill.quoteSizeUsd,
          price: fill.price,
          feeUsd: fill.feeUsd,
          filledAt: fill.filledAt,
          reasonCode: fill.reasonCode,
          rationale: fill.rationale
        })),
        note: "Realized metrics use average-cost basis over the recent fills shown."
      };
    },

    async getPortfolioState(): Promise<Record<string, unknown>> {
      const portfolio = await repo.getLatestPortfolio();
      return {
        tradingMode: config.tradingMode,
        enabledProducts: config.enabledProducts,
        riskLimits: config.risk,
        portfolio: portfolio ?? { note: "No portfolio snapshot yet — the worker has not reported." }
      };
    }
  };
}

export interface AssistantDeps {
  repo: OperatorRepository;
  config: AgentConfig;
}

export function createAssistantForApi({ repo, config }: AssistantDeps) {
  const tools = buildAssistantTools(repo, config);
  return createAssistant(config.anthropicApiKey, tools);
}

export type { AssistantAnswer };
export { AssistantAskSchema };
