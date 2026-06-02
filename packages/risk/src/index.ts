import type { AgentConfig, PortfolioState, RiskDecision, TradeIntent } from "@agent/core";

export interface RiskInput {
  config: AgentConfig;
  intent: TradeIntent;
  portfolio: PortfolioState;
  killSwitchEnabled: boolean;
  lastTradeAt?: Date;
}

export function evaluateRisk(input: RiskInput): RiskDecision {
  const { config, intent, portfolio, killSwitchEnabled, lastTradeAt } = input;
  const ruleResults: RiskDecision["ruleResults"] = [];

  ruleResults.push({
    rule: "kill_switch",
    passed: !killSwitchEnabled,
    message: killSwitchEnabled ? "Global kill switch is enabled." : "Global kill switch is clear."
  });

  ruleResults.push({
    rule: "product_allowlist",
    passed: config.enabledProducts.includes(intent.productId),
    message: config.enabledProducts.includes(intent.productId) ? "Product is enabled." : `${intent.productId} is not enabled.`
  });

  ruleResults.push({
    rule: "max_trade_notional",
    passed: intent.quoteSizeUsd > 0 && intent.quoteSizeUsd <= config.risk.maxTradeNotionalUsd,
    message: `Intent notional ${intent.quoteSizeUsd} must be > 0 and <= ${config.risk.maxTradeNotionalUsd}.`
  });

  ruleResults.push({
    rule: "daily_loss",
    passed: portfolio.dailyPnlPct > -config.risk.maxDailyLossPct,
    message: `Daily PnL ${portfolio.dailyPnlPct}% must be above -${config.risk.maxDailyLossPct}%.`
  });

  ruleResults.push({
    rule: "total_exposure",
    passed: portfolio.totalExposurePct <= config.risk.maxTotalExposurePct,
    message: `Total exposure ${portfolio.totalExposurePct}% must be <= ${config.risk.maxTotalExposurePct}%.`
  });

  const productPosition = portfolio.positions.find((position) => position.productId === intent.productId);
  const currentProductExposure = productPosition?.exposurePct ?? 0;
  const incrementalExposure = intent.side === "BUY" ? (intent.quoteSizeUsd / portfolio.equityUsd) * 100 : 0;

  ruleResults.push({
    rule: "product_exposure",
    passed: currentProductExposure + incrementalExposure <= config.risk.maxProductExposurePct,
    message: `Projected product exposure ${(currentProductExposure + incrementalExposure).toFixed(2)}% must be <= ${config.risk.maxProductExposurePct}%.`
  });

  if (lastTradeAt) {
    const secondsSinceLastTrade = (Date.now() - lastTradeAt.getTime()) / 1000;
    ruleResults.push({
      rule: "cooldown",
      passed: secondsSinceLastTrade >= config.risk.minSecondsBetweenTrades,
      message: `Seconds since last trade ${Math.floor(secondsSinceLastTrade)} must be >= ${config.risk.minSecondsBetweenTrades}.`
    });
  }

  if (intent.side === "SELL" && !config.risk.allowShorts) {
    const hasPosition = (productPosition?.notionalUsd ?? 0) >= intent.quoteSizeUsd;
    ruleResults.push({
      rule: "no_shorting",
      passed: hasPosition,
      message: hasPosition ? "Sell is covered by an existing position." : "Sell would exceed current position and shorting is disabled."
    });
  }

  const failures = ruleResults.filter((result) => !result.passed);

  return {
    approved: failures.length === 0,
    intent,
    checkedAt: new Date(),
    reasons: failures.map((failure) => failure.message),
    ruleResults
  };
}
